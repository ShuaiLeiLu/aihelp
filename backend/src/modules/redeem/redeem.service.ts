import { BadRequestException, Injectable } from '@nestjs/common'
import { randomToken, sha256 } from '../../common/http'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class RedeemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService
  ) {}

  async redeem(userId: string, code: string) {
    const codeHash = sha256(String(code || '').trim().toUpperCase())
    return this.prisma.$transaction(async (tx) => {
      const redeemCode = await tx.redeemCode.findUnique({ where: { codeHash }, include: { plan: true } })
      if (!redeemCode) throw new BadRequestException('redeem_code_invalid')
      if (redeemCode.status === 'used') throw new BadRequestException('redeem_code_used')
      if (redeemCode.status === 'revoked') throw new BadRequestException('redeem_code_revoked')
      if (redeemCode.expiresAt && redeemCode.expiresAt <= new Date()) throw new BadRequestException('redeem_code_expired')
      if (redeemCode.plan.status !== 'active') throw new BadRequestException('plan_disabled')

      const claimed = await tx.redeemCode.updateMany({
        where: { id: redeemCode.id, status: 'unused' },
        data: { status: 'used', usedByUserId: userId, usedAt: new Date() }
      })
      if (claimed.count !== 1) throw new BadRequestException('redeem_code_used')

      return this.points.changePointsInTransaction(
        tx,
        userId,
        redeemCode.plan.pointAmount,
        'redeem_code',
        redeemCode.id,
        `兑换套餐：${redeemCode.plan.name}`
      )
    })
  }

  async createPlan(adminId: string, input: { name?: string; pointAmount?: string | number; remark?: string }) {
    const plan = await this.prisma.plan.create({
      data: {
        name: String(input.name || '').trim(),
        pointAmount: BigInt(input.pointAmount || 0),
        remark: input.remark || ''
      }
    })
    await this.audit(adminId, 'plan_create', 'plan', plan.id, null, plan)
    return plan
  }

  listPlans() {
    return this.prisma.plan.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async createCodes(adminId: string, planId: string, count: number, expiresAt?: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } })
    if (!plan) throw new BadRequestException('plan_not_found')
    const plaintextCodes: string[] = []
    for (let i = 0; i < Math.min(1000, Math.max(1, count)); i += 1) {
      const code = `WM-${randomToken(10).toUpperCase()}`
      plaintextCodes.push(code)
      await this.prisma.redeemCode.create({
        data: {
          planId,
          codeHash: sha256(code),
          createdByAdminId: adminId,
          expiresAt: expiresAt ? new Date(expiresAt) : null
        }
      })
    }
    await this.audit(adminId, 'redeem_code_batch_create', 'plan', planId, null, { count: plaintextCodes.length, expiresAt: expiresAt || null })
    return { codes: plaintextCodes }
  }

  listCodes() {
    return this.prisma.redeemCode.findMany({ orderBy: { createdAt: 'desc' }, include: { plan: true } })
  }

  async revokeCode(adminId: string, id: string) {
    const before = await this.prisma.redeemCode.findUnique({ where: { id } })
    const code = await this.prisma.redeemCode.update({ where: { id }, data: { status: 'revoked', revokedAt: new Date() } })
    await this.audit(adminId, 'redeem_code_revoke', 'redeem_code', id, before, code)
    return code
  }

  private async audit(adminUserId: string, action: string, targetType: string, targetId: string | null, before: unknown, after: unknown) {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        targetType,
        targetId,
        beforeJson: this.auditJson(before),
        afterJson: this.auditJson(after)
      }
    })
  }

  private auditJson(value: unknown) {
    if (value === null) return undefined
    return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)))
  }
}
