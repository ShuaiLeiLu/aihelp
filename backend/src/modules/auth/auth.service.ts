import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Response } from 'express'
import { randomUUID } from 'crypto'
import { signSession } from '../../common/signed-session'
import { PrismaService } from '../prisma/prisma.service'

const USER_COOKIE = 'chatty_session'
const USER_SESSION_TTL_SECONDS = 14 * 24 * 60 * 60

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async createUserSession(userId: string, res: Response, meta: { ip: string; userAgent: string }) {
    void meta
    const expiresAt = new Date(Date.now() + USER_SESSION_TTL_SECONDS * 1000)
    const token = signSession({
      typ: 'user',
      sub: userId,
      exp: Math.floor(expiresAt.getTime() / 1000),
      nonce: randomUUID()
    }, this.sessionSecret())
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
    res.cookie(USER_COOKIE, token, this.cookieOptions(expiresAt))
    return { expiresAt }
  }

  async logout(token: string | undefined, res: Response) {
    void token
    res.clearCookie(USER_COOKIE, { path: '/' })
    return { ok: true }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.status !== 'active') throw new UnauthorizedException('unauthorized')
    return { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, status: user.status }
  }

  private cookieOptions(expiresAt: Date) {
    const isProd = this.config.get<string>('NODE_ENV') === 'production'
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      path: '/',
      expires: expiresAt
    }
  }

  private sessionSecret() {
    const secret = this.config.get<string>('USER_SESSION_SECRET') || this.config.get<string>('COOKIE_SECRET')
    if (!secret) throw new UnauthorizedException('session_secret_not_configured')
    return secret
  }
}
