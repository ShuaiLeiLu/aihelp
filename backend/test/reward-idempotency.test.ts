import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { RedeemService } from '../src/modules/redeem/redeem.service'
import { RechargeService } from '../src/modules/recharge/recharge.service'
import { RewardsService } from '../src/modules/rewards/rewards.service'

test('redeem refuses to grant points when the unused-code claim loses a race', async () => {
  const points = { changePointsInTransaction: async () => { throw new Error('must not grant') } }
  const tx = {
    redeemCode: {
      findUnique: async () => ({ id: 'code-1', status: 'unused', expiresAt: null, plan: { status: 'active', pointAmount: BigInt(10), name: 'test' } }),
      updateMany: async () => ({ count: 0 })
    }
  }
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx)
  }
  const service = new RedeemService(prisma as any, points as any)
  await assert.rejects(
    () => service.redeem('user-1', 'WM-TEST'),
    (error: unknown) => error instanceof BadRequestException && (error as Error).message === 'redeem_code_used'
  )
})

test('recharge confirmation does not grant a second time after a concurrent paid update', async () => {
  const points = { changePointsInTransaction: async () => { throw new Error('must not grant') } }
  let reads = 0
  const tx = {
    rechargeOrder: {
      findUnique: async () => {
        reads += 1
        return reads === 1
          ? { id: 'order-1', userId: 'user-1', status: 'pending', points: BigInt(10), orderNo: 'WM1' }
          : { id: 'order-1', status: 'paid' }
      },
      updateMany: async () => ({ count: 0 })
    }
  }
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx)
  }
  const service = new RechargeService(prisma as any, points as any)
  const result = await service.markPaid('admin-1', 'order-1')
  assert.deepEqual(result, { id: 'order-1', status: 'paid' })
})

test('reward claim returns duplicated when the session was granted by another request', async () => {
  const points = { addPoints: async () => { throw new Error('must not grant') } }
  const tx = {
    adRewardSession: {
      findUnique: async () => ({ rewardSessionId: 'reward-1', userId: 'user-1', status: 'granted' }),
      updateMany: async () => ({ count: 0 })
    }
  }
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx)
  }
  const service = new RewardsService(prisma as any, points as any)
  const result = await service.webClaim('user-1', 'reward-1')
  assert.deepEqual(result, { ok: true, duplicated: true })
})

test('daily check-in checks and grants inside a serializable transaction', async () => {
  const points = { changePointsInTransaction: async () => { throw new Error('must not grant') } }
  const tx = {
    pointLedger: {
      findFirst: async () => ({ id: 'existing-checkin' })
    }
  }
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => unknown, options: { isolationLevel?: string }) => {
      assert.equal(options?.isolationLevel, 'Serializable')
      return fn(tx)
    }
  }
  const service = new RewardsService(prisma as any, points as any)
  await assert.rejects(
    () => service.performCheckin('user-1'),
    (error: unknown) => error instanceof BadRequestException && (error as Error).message === 'already_checked_in'
  )
})
