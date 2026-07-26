import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PointLedgerType, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

export type ModelUsageKind = 'chat' | 'image_generation' | 'image_edit'

const MODEL_USAGE_POINT_DEFAULTS: Record<ModelUsageKind, bigint> = {
  chat: BigInt(1),
  image_generation: BigInt(20),
  image_edit: BigInt(30)
}

const MODEL_USAGE_POINT_ENV: Record<ModelUsageKind, string> = {
  chat: 'POINT_PRICE_CHAT',
  image_generation: 'POINT_PRICE_IMAGE_GENERATION',
  image_edit: 'POINT_PRICE_IMAGE_EDIT'
}

@Injectable()
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async balance(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const account = await tx.pointAccount.findUnique({
      where: { userId },
      select: { balance: true }
    })
    return account?.balance || BigInt(0)
  }

  async summary(userId: string) {
    const balance = await this.balance(userId)
    return { pointsBalance: balance.toString() }
  }

  ledger(userId: string, query: { page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)))
    return this.prisma.pointLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  }

  async addPoints(input: {
    userId: string
    points: bigint
    type: PointLedgerType
    relatedId?: string
    remark?: string
  }) {
    return this.prisma.$transaction((tx) =>
      this.changePointsInTransaction(tx, input.userId, input.points, input.type, input.relatedId, input.remark)
    )
  }

  async consumePoints(userId: string, points: bigint, relatedId: string, remark?: string) {
    if (points <= BigInt(0)) return
    await this.prisma.$transaction((tx) =>
      this.consumePointsInTransaction(tx, userId, points, relatedId, remark)
    )
  }

  async consumePointsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    points: bigint,
    relatedId: string,
    remark?: string
  ) {
    if (points <= BigInt(0)) return
    return this.changePointsInTransaction(tx, userId, -points, 'model_usage', relatedId, remark || 'Model usage points consumption')
  }

  async changePointsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    deltaPoints: bigint,
    type: PointLedgerType,
    relatedId?: string,
    remark?: string
  ) {
    if (deltaPoints === BigInt(0) && type !== 'manual_adjustment') {
      throw new BadRequestException('points_required')
    }
    await tx.pointAccount.upsert({
      where: { userId },
      create: { userId, balance: BigInt(0) },
      update: {}
    })
    const updatedRows = await tx.pointAccount.updateManyAndReturn({
      where: deltaPoints < BigInt(0)
        ? { userId, balance: { gte: -deltaPoints } }
        : { userId },
      data: { balance: { increment: deltaPoints } },
      select: { balance: true }
    })
    const updated = updatedRows[0]
    if (!updated) {
      if (deltaPoints < BigInt(0)) throw new BadRequestException('points_insufficient')
      throw new BadRequestException('points_update_failed')
    }
    const ledger = await tx.pointLedger.create({
      data: {
        userId,
        type,
        deltaPoints,
        balanceAfter: updated.balance,
        relatedId,
        remark: remark || ''
      }
    })
    return { ledger, pointsBalance: updated.balance.toString() }
  }

  priceModelUsage(kind: ModelUsageKind = 'chat') {
    const raw = this.config.get<string>(MODEL_USAGE_POINT_ENV[kind])
    if (raw != null && String(raw).trim() !== '') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed >= 0) return BigInt(Math.floor(parsed))
    }
    return MODEL_USAGE_POINT_DEFAULTS[kind]
  }
}
