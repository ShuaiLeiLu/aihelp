import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomToken } from '../../common/http'
import { PrismaService } from '../prisma/prisma.service'
import { PointsService } from '../points/points.service'

@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService
  ) {}

  async webConfig(userId: string) {
    const config = await this.getConfig()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const claimed = await this.prisma.adRewardSession.count({
      where: { userId, status: 'granted', createdAt: { gte: today } }
    })
    return {
      enabled: config.enabled,
      adUnitId: config.adUnitId,
      rewardPoints: config.rewardPoints.toString(),
      dailyLimitPerUser: config.dailyLimitPerUser,
      remainingToday: Math.max(0, config.dailyLimitPerUser - claimed)
    }
  }

  async webCreateSession(userId: string) {
    const config = await this.getConfig()
    if (!config.enabled) throw new BadRequestException('reward_disabled')
    await this.assertCanClaim(userId, config.dailyLimitPerUser, config.minIntervalSeconds)
    const rewardSessionId = randomToken(24)
    const session = await this.prisma.adRewardSession.create({
      data: {
        rewardSessionId,
        userId,
        openid: '',
        adUnitId: config.adUnitId,
        rewardPoints: config.rewardPoints,
        expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000)
      }
    })
    return { rewardSessionId, adUnitId: config.adUnitId, expiresAt: session.expiresAt }
  }

  async webClaim(userId: string, rewardSessionId: string) {
    return this.serializableTransaction(async (tx) => {
      const reward = await tx.adRewardSession.findUnique({ where: { rewardSessionId } })
      if (!reward || reward.userId !== userId) throw new BadRequestException('reward_session_not_found')
      if (reward.status === 'granted') return { ok: true, duplicated: true }
      if (reward.expiresAt <= new Date()) throw new BadRequestException('reward_session_expired')
      if (reward.status !== 'pending') throw new BadRequestException('reward_session_consumed')

      const config = await this.getConfig(tx)
      await this.assertCanClaim(userId, config.dailyLimitPerUser, config.minIntervalSeconds, tx)
      const claimedAt = new Date()
      const claimed = await tx.adRewardSession.updateMany({
        where: { rewardSessionId, userId, status: 'pending', expiresAt: { gt: claimedAt } },
        data: { status: 'granted', grantedAt: claimedAt }
      })
      if (claimed.count !== 1) {
        const current = await tx.adRewardSession.findUnique({ where: { rewardSessionId } })
        if (current?.status === 'granted') return { ok: true, duplicated: true }
        throw new BadRequestException('reward_session_consumed')
      }

      const result = await this.points.changePointsInTransaction(
        tx,
        userId,
        reward.rewardPoints,
        'ad_reward',
        reward.rewardSessionId,
        '网页视频广告奖励'
      )
      await tx.adRewardEvent.create({
        data: { rewardSessionId, userId, openid: reward.openid, eventType: 'claim', result: 'granted' }
      })
      return { ok: true, rewardPoints: reward.rewardPoints.toString(), pointsBalance: result.pointsBalance.toString() }
    })
  }

  async getCheckinStatus(userId: string, db: PrismaService | Prisma.TransactionClient = this.prisma) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

    const checkins = await db.pointLedger.findMany({
      where: {
        userId,
        type: 'manual_adjustment',
        remark: '每日签到'
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    })

    const checkedInToday = checkins.some(c => {
      const cDate = new Date(c.createdAt)
      cDate.setHours(0, 0, 0, 0)
      return cDate.getTime() === today.getTime()
    })

    let streak = 0
    let checkDate = checkedInToday ? today : yesterday

    for (const c of checkins) {
      const cDate = new Date(c.createdAt)
      cDate.setHours(0, 0, 0, 0)
      if (cDate.getTime() === checkDate.getTime()) {
        streak++
        checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000)
      } else if (cDate.getTime() < checkDate.getTime()) {
        break
      }
    }

    const getRewardForDay = (day: number) => {
      const d = ((day - 1) % 7) + 1
      if (d <= 3) return 100
      if (d <= 5) return 150
      if (d === 6) return 200
      return 500
    }

    const nextReward = getRewardForDay(streak + 1)
    const todayReward = checkedInToday ? 0 : getRewardForDay(streak + 1)

    return {
      checkedInToday,
      streak,
      todayReward,
      nextReward,
      history: checkins.map(c => c.createdAt)
    }
  }

  async performCheckin(userId: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const relatedId = `checkin_${this.localDayKey(today)}`

    return this.serializableTransaction(async (tx) => {
      const existing = await tx.pointLedger.findFirst({
        where: { userId, type: 'manual_adjustment', relatedId }
      })
      if (existing) throw new BadRequestException('already_checked_in')

      const status = await this.getCheckinStatus(userId, tx)
      const rewardAmount = status.todayReward
      const result = await this.points.changePointsInTransaction(
        tx,
        userId,
        BigInt(rewardAmount),
        'manual_adjustment',
        relatedId,
        '每日签到'
      )

      return {
        ok: true,
        rewardPoints: rewardAmount,
        pointsBalance: result.pointsBalance.toString(),
        streak: status.streak + 1
      }
    })
  }

  async getDailyTasksStatus(userId: string, db: PrismaService | Prisma.TransactionClient = this.prisma) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const dialogCount = await db.message.count({
      where: {
        userId,
        role: 'user',
        createdAt: { gte: today }
      }
    })

    const imageCount = await db.imageTask.count({
      where: {
        userId,
        createdAt: { gte: today }
      }
    })

    const modelGroup = await db.llmRequest.groupBy({
      by: ['modelId'],
      where: {
        userId,
        createdAt: { gte: today }
      }
    })
    const modelCount = modelGroup.length

    // Check if task rewards have already been claimed
    const claims = await db.pointLedger.findMany({
      where: {
        userId,
        type: 'manual_adjustment',
        remark: { in: ['任务：完成一次对话', '任务：生成一张图片', '任务：切换三个模型', '任务：分享对话'] },
        createdAt: { gte: today }
      }
    })

    const hasClaimed = (remark: string) => claims.some(c => c.remark === remark)

    return {
      dialog: { completed: dialogCount > 0, count: dialogCount, target: 1, reward: 100, claimed: hasClaimed('任务：完成一次对话') },
      image: { completed: imageCount > 0, count: imageCount, target: 1, reward: 150, claimed: hasClaimed('任务：生成一张图片') },
      models: { completed: modelCount >= 3, count: modelCount, target: 3, reward: 200, claimed: hasClaimed('任务：切换三个模型') },
      share: { completed: false, count: 0, target: 1, reward: 300, claimed: hasClaimed('任务：分享对话') }
    }
  }

  async claimTaskReward(userId: string, taskType: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return this.serializableTransaction(async (tx) => {
      const status = await this.getDailyTasksStatus(userId, tx)
      let rewardAmount = 0
      let taskRemark = ''

      if (taskType === 'dialog') {
        if (!status.dialog.completed) throw new BadRequestException('task_not_completed')
        rewardAmount = status.dialog.reward
        taskRemark = '任务：完成一次对话'
      } else if (taskType === 'image') {
        if (!status.image.completed) throw new BadRequestException('task_not_completed')
        rewardAmount = status.image.reward
        taskRemark = '任务：生成一张图片'
      } else if (taskType === 'models') {
        if (!status.models.completed) throw new BadRequestException('task_not_completed')
        rewardAmount = status.models.reward
        taskRemark = '任务：切换三个模型'
      } else if (taskType === 'share') {
        throw new BadRequestException('task_not_completed')
      } else {
        throw new BadRequestException('invalid_task_type')
      }

      const relatedId = `task_${taskType}_${this.localDayKey(today)}`
      const existing = await tx.pointLedger.findFirst({
        where: { userId, type: 'manual_adjustment', relatedId }
      })
      if (existing) throw new BadRequestException('task_reward_already_claimed')

      const result = await this.points.changePointsInTransaction(
        tx,
        userId,
        BigInt(rewardAmount),
        'manual_adjustment',
        relatedId,
        taskRemark
      )

      return {
        ok: true,
        rewardPoints: rewardAmount,
        pointsBalance: result.pointsBalance.toString()
      }
    })
  }

  adminConfig() {
    return this.getConfig()
  }

  async updateConfig(adminId: string, data: { enabled?: boolean; adUnitId?: string; rewardPoints?: string | number; dailyLimitPerUser?: number; minIntervalSeconds?: number; sessionTtlSeconds?: number }) {
    const before = await this.getConfig()
    const config = await this.prisma.adRewardConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...this.configData(data), updatedByAdminId: adminId },
      update: { ...this.configData(data), updatedByAdminId: adminId }
    })
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: adminId,
        action: 'reward_config_update',
        targetType: 'ad_reward_config',
        targetId: config.id,
        beforeJson: this.auditJson(before),
        afterJson: this.auditJson(config)
      }
    })
    return config
  }

  listEvents() {
    return this.prisma.adRewardEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  }

  private async getConfig(db: PrismaService | Prisma.TransactionClient = this.prisma) {
    return db.adRewardConfig.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} })
  }

  private async assertCanClaim(
    userId: string,
    dailyLimit: number,
    minIntervalSeconds: number,
    db: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const [claimed, latest] = await Promise.all([
      db.adRewardSession.count({ where: { userId, status: 'granted', createdAt: { gte: today } } }),
      db.adRewardSession.findFirst({ where: { userId, status: 'granted' }, orderBy: { grantedAt: 'desc' } })
    ])
    if (claimed >= dailyLimit) throw new BadRequestException('reward_daily_limit')
    if (latest?.grantedAt && Date.now() - latest.grantedAt.getTime() < minIntervalSeconds * 1000) {
      throw new BadRequestException('reward_too_frequent')
    }
  }

  private configData(data: { enabled?: boolean; adUnitId?: string; rewardPoints?: string | number; dailyLimitPerUser?: number; minIntervalSeconds?: number; sessionTtlSeconds?: number }) {
    return {
      enabled: data.enabled,
      adUnitId: data.adUnitId,
      rewardPoints: data.rewardPoints === undefined ? undefined : BigInt(data.rewardPoints),
      dailyLimitPerUser: data.dailyLimitPerUser,
      minIntervalSeconds: data.minIntervalSeconds,
      sessionTtlSeconds: data.sessionTtlSeconds
    }
  }

  private async serializableTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        })
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2034' || attempt === 2) throw error
      }
    }
    throw new BadRequestException('transaction_failed')
  }

  private localDayKey(value: Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private auditJson(value: unknown) {
    if (value === null) return undefined
    return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)))
  }
}
