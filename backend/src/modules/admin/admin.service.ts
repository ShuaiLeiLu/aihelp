import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LlmRequestStatus, PointLedgerType, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { Response } from 'express'
import { toPublicBigInt } from '../../common/http'
import { signSession } from '../../common/signed-session'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'

const ADMIN_COOKIE = 'chatty_admin_session'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const ADMIN_SESSION_TTL_MS = 12 * HOUR_MS

const ADMIN_USER_SELECT = {
  id: true,
  displayName: true,
  avatarUrl: true,
  email: true,
  casdoorSubject: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true
} as const

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly config: ConfigService
  ) {}

  async loginCasdoorAdmin(
    input: { subject: string; username: string; email: string; role: 'admin' | 'owner' },
    res: Response,
    meta: { ip: string; userAgent: string }
  ) {
    const username = input.username || `casdoor_${input.subject}`
    const email = input.email.toLowerCase()
    const existing = await this.prisma.adminUser.findFirst({
      where: { OR: [{ casdoorSubject: input.subject }, { username }, { email }] }
    })
    if (existing?.status === 'disabled') throw new UnauthorizedException('admin_disabled')
    const admin = existing
      ? await this.prisma.adminUser.update({
          where: { id: existing.id },
          data: {
            username: existing.username,
            email: existing.email || email,
            casdoorSubject: existing.casdoorSubject || input.subject,
            role: input.role,
            status: 'active'
          }
        })
      : await this.prisma.adminUser.create({
          data: {
            username,
            email,
            casdoorSubject: input.subject,
            role: input.role,
            status: 'active'
          }
        })
    return this.createAdminSession(admin, res, meta)
  }

  private async createAdminSession(
    admin: { id: string; username: string; role: string },
    res: Response,
    meta: { ip: string; userAgent: string }
  ) {
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS)
    const token = signSession({
      typ: 'admin',
      sub: admin.id,
      exp: Math.floor(expiresAt.getTime() / 1000),
      nonce: randomUUID()
    }, this.adminSessionSecret())
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })
    res.cookie(ADMIN_COOKIE, token, this.cookieOptions(expiresAt))
    await this.audit(admin.id, 'admin_login', 'admin_user', admin.id, null, { ip: meta.ip })
    return { id: admin.id, username: admin.username, role: admin.role, expiresAt }
  }

  async logout(token: string | undefined, res: Response) {
    void token
    res.clearCookie(ADMIN_COOKIE, { path: '/' })
    return { ok: true }
  }

  me(adminId: string) {
    return this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, username: true, email: true, role: true, status: true }
    })
  }

  async dashboard() {
    const since = new Date(Date.now() - 7 * DAY_MS)
    const [
      users,
      activeUsers,
      newUsers7d,
      requests,
      completedRequests,
      failedRequests,
      requests7d,
      imageTasks,
      imageTasks7d,
      conversations,
      pointLedger,
      usageLedger,
      adLedger,
      storageUsage
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.llmRequest.count(),
      this.prisma.llmRequest.count({ where: { status: 'completed' } }),
      this.prisma.llmRequest.count({ where: { status: 'failed' } }),
      this.prisma.llmRequest.count({ where: { createdAt: { gte: since } } }),
      this.prisma.imageTask.count(),
      this.prisma.imageTask.count({ where: { createdAt: { gte: since } } }),
      this.prisma.conversation.count({ where: { status: 'active' } }),
      this.prisma.pointLedger.aggregate({ _sum: { deltaPoints: true } }),
      this.prisma.pointLedger.aggregate({ where: { type: 'model_usage' }, _sum: { deltaPoints: true } }),
      this.prisma.pointLedger.aggregate({ where: { type: 'ad_reward' }, _sum: { deltaPoints: true } })
      ,
      this.prisma.storageUsage.aggregate({ _sum: { bytesTotal: true, imagesCount: true } })
    ])
    return {
      users,
      activeUsers,
      newUsers7d,
      llmRequests: requests,
      completedRequests,
      failedRequests,
      requests7d,
      imageTasks,
      imageTasks7d,
      conversations,
      totalPointDelta: toPublicBigInt(pointLedger._sum.deltaPoints || 0),
      modelUsagePoints: toPublicBigInt(usageLedger._sum.deltaPoints || 0),
      adRewardPoints: toPublicBigInt(adLedger._sum.deltaPoints || 0),
      storageBytes: toPublicBigInt(storageUsage._sum.bytesTotal || 0),
      storedImages: storageUsage._sum.imagesCount || 0
    }
  }

  listUsers(query: { q?: string; status?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)))
    const where: Prisma.UserWhereInput = {}
    if (query.status === 'active' || query.status === 'disabled') where.status = query.status
    if (query.q) {
      where.OR = [
        { displayName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { casdoorSubject: { contains: query.q, mode: 'insensitive' } }
      ]
    }
    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: ADMIN_USER_SELECT
    })
  }

  async updateUserStatus(adminId: string, userId: string, status: 'active' | 'disabled') {
    const before = await this.prisma.user.findUnique({ where: { id: userId } })
    const user = await this.prisma.user.update({ where: { id: userId }, data: { status } })
    await this.audit(adminId, `user_${status}`, 'user', userId, before, user)
    return user
  }

  async deleteUser(adminId: string, userId: string) {
    const before = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!before) throw new BadRequestException('user_not_found')

    await this.prisma.$transaction(async (tx) => {
      await tx.imageTask.deleteMany({ where: { userId } })
      await tx.user.delete({ where: { id: userId } })
    })
    await this.audit(adminId, 'user_delete', 'user', userId, before, null)
    return { ok: true, id: userId }
  }

  async adjustPoints(adminId: string, userId: string, input: { points?: string | number; remark?: string }) {
    const points = BigInt(input.points || 0)
    if (points === BigInt(0)) throw new BadRequestException('points_required')
    const MAX_POINTS_PER_ADJUSTMENT = BigInt('1000000000000000')
    const magnitude = points < BigInt(0) ? -points : points
    if (magnitude > MAX_POINTS_PER_ADJUSTMENT) throw new BadRequestException('points_too_large')
    const result = await this.points.addPoints({
      userId,
      points,
      type: 'manual_adjustment',
      relatedId: adminId,
      remark: input.remark || ''
    })
    await this.audit(adminId, 'points_adjust', 'user', userId, null, { points: points.toString() })
    return result
  }

  listLlmRequests(query: { userId?: string; status?: string; page?: string; pageSize?: string }) {
    const { page, pageSize } = this.pagination(query)
    const where: Prisma.LlmRequestWhereInput = {}
    if (query.userId) where.userId = query.userId
    if (this.isLlmRequestStatus(query.status)) where.status = query.status
    return this.prisma.llmRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: ADMIN_USER_SELECT },
        conversation: { select: { id: true, title: true, createdAt: true } },
        usageEvents: true
      }
    })
  }

  listPointLedger(query: { userId?: string; type?: string; page?: string; pageSize?: string }) {
    const { page, pageSize } = this.pagination(query)
    const where: Prisma.PointLedgerWhereInput = {}
    if (query.userId) where.userId = query.userId
    if (this.isPointLedgerType(query.type)) where.type = query.type
    return this.prisma.pointLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: ADMIN_USER_SELECT } }
    })
  }

  listAuditLogs(query: { adminUserId?: string; action?: string; page?: string; pageSize?: string }) {
    const { page, pageSize } = this.pagination(query)
    const where: Prisma.AdminAuditLogWhereInput = {}
    if (query.adminUserId) where.adminUserId = query.adminUserId
    if (query.action) where.action = query.action
    return this.prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        adminUser: { select: { id: true, username: true, email: true, role: true } }
      }
    })
  }

  async audit(adminUserId: string | null, action: string, targetType: string, targetId: string | null, before: unknown, after: unknown) {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        targetType,
        targetId,
        beforeJson: before === null ? undefined : JSON.parse(JSON.stringify(before)),
        afterJson: after === null ? undefined : JSON.parse(JSON.stringify(after))
      }
    })
  }

  private pagination(query: { page?: string; pageSize?: string }) {
    return {
      page: Math.max(1, Number(query.page || 1)),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize || 20)))
    }
  }

  private isLlmRequestStatus(status?: string): status is LlmRequestStatus {
    return ['pending', 'streaming', 'completed', 'failed', 'cancelled'].includes(String(status || ''))
  }

  private isPointLedgerType(type?: string): type is PointLedgerType {
    return ['redeem_code', 'ad_reward', 'recharge', 'manual_adjustment', 'model_usage', 'refund'].includes(String(type || ''))
  }

  private cookieOptions(expiresAt: Date) {
    const isProd = this.config.get<string>('NODE_ENV') === 'production'
    return { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/', expires: expiresAt }
  }

  private adminSessionSecret() {
    const secret = this.config.get<string>('ADMIN_SESSION_SECRET') || this.config.get<string>('COOKIE_SECRET')
    if (!secret) throw new UnauthorizedException('session_secret_not_configured')
    return secret
  }
}
