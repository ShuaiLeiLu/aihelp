import { BadRequestException, Injectable } from '@nestjs/common'
import { RechargePaymentMethod } from '@prisma/client'
import { randomToken } from '../../common/http'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'

const ORDER_TTL_MS = 30 * 60 * 1000

const RECHARGE_PLANS = [
  { id: 'basic', points: BigInt(10_000), amountCents: 1200, label: '基础档' },
  { id: 'plus', points: BigInt(50_000), amountCents: 5800, label: '畅享档' },
  { id: 'pro', points: BigInt(200_000), amountCents: 19800, label: '尊享档' },
  { id: 'master', points: BigInt(1_000_000), amountCents: 88800, label: '大师档' }
] as const

@Injectable()
export class RechargeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService
  ) {}

  plans() {
    return RECHARGE_PLANS.map((plan) => ({
      ...plan,
      points: plan.points.toString()
    }))
  }

  listUserOrders(userId: string) {
    return this.prisma.rechargeOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30
    })
  }

  listAdminOrders() {
    return this.prisma.rechargeOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
            avatarUrl: true,
            status: true
          }
        }
      }
    })
  }

  async createOrder(userId: string, input: { planId?: string; paymentMethod?: string }) {
    const plan = RECHARGE_PLANS.find((item) => item.id === input.planId)
    if (!plan) throw new BadRequestException('recharge_plan_not_found')
    const paymentMethod = this.parsePaymentMethod(input.paymentMethod)
    const order = await this.prisma.rechargeOrder.create({
      data: {
        orderNo: this.orderNo(),
        userId,
        points: plan.points,
        amountCents: plan.amountCents,
        paymentMethod,
        expiresAt: new Date(Date.now() + ORDER_TTL_MS),
        remark: plan.label
      }
    })
    return {
      ...order,
      paymentUrl: null,
      nextAction: 'payment_provider_not_configured'
    }
  }

  async markPaid(adminUserId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.findUnique({ where: { id: orderId } })
      if (!order) throw new BadRequestException('recharge_order_not_found')
      if (order.status === 'paid') return order
      if (order.status !== 'pending') throw new BadRequestException('recharge_order_not_payable')

      const paidAt = new Date()
      const claimed = await tx.rechargeOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'paid', paidAt }
      })
      if (claimed.count !== 1) {
        const current = await tx.rechargeOrder.findUnique({ where: { id: order.id } })
        if (current?.status === 'paid') return current
        throw new BadRequestException('recharge_order_not_payable')
      }
      const paidOrder = { ...order, status: 'paid' as const, paidAt }
      await this.points.changePointsInTransaction(tx, order.userId, order.points, 'recharge', order.id, `充值订单：${order.orderNo}`)
      await tx.adminAuditLog.create({
        data: {
          adminUserId,
          action: 'recharge_order_mark_paid',
          targetType: 'recharge_order',
          targetId: order.id,
          beforeJson: this.auditJson(order),
          afterJson: this.auditJson(paidOrder)
        }
      })
      return paidOrder
    })
  }

  private parsePaymentMethod(value?: string): RechargePaymentMethod {
    if (value === 'alipay') return 'alipay'
    if (value === 'apple') return 'apple'
    return 'wechat'
  }

  private orderNo() {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
    return `WM${stamp}${randomToken(5).toUpperCase()}`
  }

  private auditJson(value: unknown) {
    if (value === null) return undefined
    return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)))
  }
}
