import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'crypto'
import { Request, Response } from 'express'
import { getClientIp, getUserAgent, randomToken } from '../../common/http'
import { AdminService } from '../admin/admin.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from './auth.service'

type StatePayload = {
  next: string
  popup: boolean
  nonce: string
  exp: number
}

type TokenResponse = {
  access_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type CasdoorProfile = {
  sub?: string
  id?: string
  name?: string
  displayName?: string
  preferred_username?: string
  email?: string
  avatar?: string
  picture?: string
  isAdmin?: boolean
  isForbidden?: boolean
  roles?: unknown
  groups?: unknown
  permissions?: unknown
}

const STATE_VERSION = 1

@Injectable()
export class CasdoorOauthService {
  private readonly logger = new Logger(CasdoorOauthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly admin: AdminService
  ) {}

  isEnabled() {
    return !!(this.clientId() && this.clientSecret() && this.redirectUri() && this.endpoint())
  }

  isRequired() {
    return this.config.get<string>('CASDOOR_AUTH_REQUIRED') === 'true'
  }

  buildAuthorizeUrl(opts: { next?: string; popup?: boolean }) {
    if (!this.isEnabled()) throw new BadRequestException('casdoor_not_configured')
    const ttl = Number(this.config.get<string>('CASDOOR_STATE_TTL_SECONDS') || 600)
    const payload: StatePayload = {
      next: this.normalizeNext(opts.next),
      popup: !!opts.popup,
      nonce: randomToken(12),
      exp: Math.floor(Date.now() / 1000) + ttl
    }
    const state = this.signState(payload)
    const url = new URL('/login/oauth/authorize', this.endpoint())
    url.searchParams.set('client_id', this.clientId())
    url.searchParams.set('redirect_uri', this.redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid profile email')
    url.searchParams.set('state', state)
    return { url: url.toString(), state, expiresIn: ttl }
  }

  async handleCallback(args: { code: string; state: string; req: Request; res: Response }) {
    if (!this.isEnabled()) throw new BadRequestException('casdoor_not_configured')
    const parsed = this.verifyState(args.state)
    if (!parsed) throw new UnauthorizedException('invalid_or_expired_state')

    const token = await this.exchangeCode(args.code)
    if (!token.access_token) throw new UnauthorizedException('casdoor_token_missing')
    const profile = await this.fetchUserInfo(token.access_token)
    const subject = String(profile.sub || profile.id || '').trim()
    if (!subject) throw new UnauthorizedException('casdoor_subject_missing')
    if (profile.isForbidden) throw new UnauthorizedException('account_disabled')

    const next = parsed.next
    const meta = { ip: getClientIp(args.req), userAgent: getUserAgent(args.req) }
    const adminRole = this.casdoorAdminRole(profile)
    if (adminRole && next.startsWith('/admin')) {
      const admin = await this.admin.loginCasdoorAdmin(
        {
          subject,
          username: this.casdoorUsername(profile, subject),
          email: this.casdoorEmail(profile, subject),
          role: adminRole
        },
        args.res,
        meta
      )
      return { ok: true as const, type: 'admin' as const, popup: parsed.popup, next, admin }
    }

    const user = await this.resolveOrCreateUser(profile, subject)
    await this.auth.createUserSession(user.id, args.res, meta)
    return {
      ok: true as const,
      type: 'user' as const,
      popup: parsed.popup,
      next,
      user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl }
    }
  }

  buildPopupCallbackHtml(ok: boolean, message?: string) {
    const payload = JSON.stringify({ type: 'chatty:casdoor_oauth', ok, message: message || '' })
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>统一登录回调</title>
<style>html,body{margin:0;background:#050614;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;height:100%;display:flex;align-items:center;justify-content:center}.box{padding:24px;text-align:center}</style>
</head><body><div class="box"><h1 style="font-size:18px;margin:0 0 8px">${ok ? '登录成功' : '登录失败'}</h1><p style="font-size:13px;color:#94a3b8;margin:0">${ok ? '正在关闭窗口...' : (message || '请重试')}</p></div>
<script>(function(){try{if(window.opener){window.opener.postMessage(${payload},"*");}}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},800);})();</script>
</body></html>`
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const url = new URL('/api/login/oauth/access_token', this.endpoint())
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      code,
      redirect_uri: this.redirectUri()
    })
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000)
    })
    const data = (await res.json()) as TokenResponse
    if (!res.ok || data.error || !data.access_token) {
      this.logger.warn(`token exchange failed: ${data.error || res.status} ${data.error_description || ''}`)
      throw new UnauthorizedException('casdoor_code_invalid')
    }
    return data
  }

  private async fetchUserInfo(accessToken: string): Promise<CasdoorProfile> {
    const url = new URL('/api/userinfo', this.endpoint())
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000)
    })
    const data = (await res.json()) as CasdoorProfile
    if (!res.ok) throw new UnauthorizedException('casdoor_userinfo_failed')
    return data
  }

  private async resolveOrCreateUser(profile: CasdoorProfile, subject: string) {
    const email = this.normalizeEmail(profile.email)
    const displayName = this.displayName(profile, subject)
    const avatarUrl = String(profile.avatar || profile.picture || '')
    return this.prisma.$transaction(async (tx) => {
      const exact = await tx.user.findUnique({ where: { casdoorSubject: subject } })
      if (exact) {
        await this.maybeRefreshProfile(tx, exact.id, displayName, avatarUrl, email)
        await tx.user.update({ where: { id: exact.id }, data: { lastLoginAt: new Date() } })
        return exact
      }

      const emailUser = email ? await tx.user.findUnique({ where: { email } }) : null
      const user =
        emailUser
          ? await tx.user.update({
              where: { id: emailUser.id },
              data: { casdoorSubject: subject }
            })
          :
        (await tx.user.create({
          data: {
            email,
            casdoorSubject: subject,
            displayName,
            avatarUrl
          }
        }))

      await tx.pointAccount.upsert({
        where: { userId: user.id },
        create: { userId: user.id, balance: BigInt(0) },
        update: {}
      })
      await this.maybeRefreshProfile(tx, user.id, displayName, avatarUrl, email)
      return user
    })
  }

  private async maybeRefreshProfile(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
    displayName: string,
    avatarUrl: string,
    email: string | null
  ) {
    const existing = await tx.user.findUnique({ where: { id: userId } })
    if (!existing) return
    const patch: Record<string, unknown> = {}
    if ((!existing.displayName || existing.displayName === 'Casdoor 用户') && displayName) patch.displayName = displayName
    if (!existing.avatarUrl && avatarUrl) patch.avatarUrl = avatarUrl
    if (!existing.email && email) {
      const taken = await tx.user.findUnique({ where: { email } })
      if (!taken || taken.id === userId) {
        patch.email = email
      }
    }
    if (Object.keys(patch).length > 0) await tx.user.update({ where: { id: userId }, data: patch })
  }

  private casdoorAdminRole(profile: CasdoorProfile): 'admin' | 'owner' | null {
    if (!this.matchesAdmin(profile)) return null
    return this.matchesAny(profile, this.ownerMatchers()) ? 'owner' : 'admin'
  }

  private matchesAdmin(profile: CasdoorProfile) {
    return profile.isAdmin === true || this.matchesAny(profile, this.adminMatchers())
  }

  private matchesAny(profile: CasdoorProfile, matchers: string[]) {
    if (!matchers.length) return false
    const values = new Set(this.profileValues(profile).map((v) => v.toLowerCase()))
    return matchers.some((m) => values.has(m.toLowerCase()))
  }

  private profileValues(profile: CasdoorProfile) {
    const raw = [
      profile.sub,
      profile.id,
      profile.email,
      ...this.arrayValues(profile.roles),
      ...this.arrayValues(profile.groups),
      ...this.arrayValues(profile.permissions)
    ]
    return raw.map((v) => String(v || '').trim()).filter(Boolean)
  }

  private arrayValues(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        return String(obj.name || obj.displayName || obj.id || '')
      }
      return ''
    }).filter(Boolean)
  }

  private signState(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify({ v: STATE_VERSION, ...payload })).toString('base64url')
    const sig = createHmac('sha256', this.stateSecret()).update(body).digest('base64url')
    return `${body}.${sig}`
  }

  private verifyState(state: string): StatePayload | null {
    if (!state.includes('.')) return null
    const [body, sig] = state.split('.', 2)
    const expected = Buffer.from(createHmac('sha256', this.stateSecret()).update(body).digest('base64url'))
    const actual = Buffer.from(sig)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
      if (data?.v !== STATE_VERSION) return null
      if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null
      return {
        next: this.normalizeNext(data.next),
        popup: !!data.popup,
        nonce: String(data.nonce || ''),
        exp: data.exp
      }
    } catch {
      return null
    }
  }

  private normalizeNext(next: string | undefined | null): string {
    const raw = String(next || '')
    if (/[\u0000-\u001f\u007f]/.test(raw) || raw.includes('\\') || /%5c/i.test(raw)) return '/'
    const v = raw.trim() || '/'
    if (!v.startsWith('/') || v.startsWith('//')) return '/'
    return v
  }

  private normalizeEmail(email: unknown) {
    const v = String(email || '').trim().toLowerCase()
    return v.includes('@') ? v.slice(0, 254) : null
  }

  private displayName(profile: CasdoorProfile, subject: string) {
    return String(profile.displayName || profile.name || profile.preferred_username || profile.email || subject || 'Casdoor 用户').slice(0, 64)
  }

  private casdoorUsername(profile: CasdoorProfile, subject: string) {
    return String(profile.name || profile.preferred_username || profile.email || `casdoor_${subject}`).replace(/[^a-zA-Z0-9_.@-]/g, '_').slice(0, 64)
  }

  private casdoorEmail(profile: CasdoorProfile, subject: string) {
    return this.normalizeEmail(profile.email) || `${subject}@casdoor.local`
  }

  private endpoint() {
    return (this.config.get<string>('CASDOOR_ENDPOINT') || this.config.get<string>('CASDOOR_ISSUER') || '').replace(/\/+$/, '')
  }

  private clientId() {
    return this.config.get<string>('CASDOOR_CLIENT_ID') || ''
  }

  private clientSecret() {
    return this.config.get<string>('CASDOOR_CLIENT_SECRET') || ''
  }

  private redirectUri() {
    return this.config.get<string>('CASDOOR_REDIRECT_URI') || ''
  }

  private stateSecret() {
    const secret = this.config.get<string>('CASDOOR_STATE_SECRET') || this.config.get<string>('COOKIE_SECRET')
    if (!secret) throw new BadRequestException('state_secret_not_configured')
    return secret
  }

  private adminMatchers() {
    return this.csv('CASDOOR_ADMIN_MATCHERS')
  }

  private ownerMatchers() {
    return this.csv('CASDOOR_OWNER_MATCHERS')
  }

  private csv(key: string) {
    return String(this.config.get<string>(key) || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }
}
