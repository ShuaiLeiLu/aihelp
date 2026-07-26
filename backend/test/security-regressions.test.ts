import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { AuthService } from '../src/modules/auth/auth.service'
import { AdminSessionGuard, UserSessionGuard } from '../src/common/session.guard'
import { CasdoorOauthService } from '../src/modules/auth/casdoor-oauth.service'
import { AdminService } from '../src/modules/admin/admin.service'
import { PointsService } from '../src/modules/points/points.service'

const config = (values: Record<string, string | undefined>) => ({
  get: <T>(key: string) => values[key] as T | undefined
}) as any

test('debit uses a conditional atomic update and records the returned balance', async () => {
  const calls: string[] = []
  const tx = {
    pointAccount: {
      upsert: async () => ({}),
      updateManyAndReturn: async (args: any) => {
        calls.push('updateManyAndReturn')
        assert.deepEqual(args.where, { userId: 'u1', balance: { gte: BigInt(3) } })
        assert.deepEqual(args.data, { balance: { increment: BigInt(-3) } })
        return [{ balance: BigInt(7) }]
      }
    },
    pointLedger: {
      create: async ({ data }: any) => {
        calls.push('ledger')
        assert.equal(data.balanceAfter, BigInt(7))
        return data
      }
    }
  }
  const service = new PointsService({} as any, config({}) as any)
  const result = await service.consumePointsInTransaction(tx as any, 'u1', BigInt(3), 'request-1')
  assert.equal(result?.pointsBalance, '7')
  assert.deepEqual(calls, ['updateManyAndReturn', 'ledger'])
})

test('production user sessions fail when no session secret is configured', async () => {
  const service = new AuthService(
    { user: { update: async () => ({}) } } as any,
    config({ NODE_ENV: 'production' })
  )
  await assert.rejects(
    () => service.createUserSession('u1', { cookie: () => undefined } as any, { ip: '', userAgent: '' }),
    (error: unknown) => error instanceof UnauthorizedException && (error as Error).message === 'session_secret_not_configured'
  )
})

test('session guard fails closed when production secret is missing', async () => {
  const guard = new UserSessionGuard({} as any, config({ NODE_ENV: 'production' }))
  await assert.rejects(
    () => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ cookies: { chatty_session: 'token' } }) }) } as any),
    (error: unknown) => error instanceof UnauthorizedException && (error as Error).message === 'session_secret_not_configured'
  )
})

test('admin session guard fails closed when production secret is missing', async () => {
  const guard = new AdminSessionGuard({} as any, config({ NODE_ENV: 'production' }))
  await assert.rejects(
    () => guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ cookies: { chatty_admin_session: 'token' } }) }) } as any),
    (error: unknown) => error instanceof UnauthorizedException && (error as Error).message === 'session_secret_not_configured'
  )
})

test('OAuth state requires a configured secret when Casdoor is enabled', () => {
  const service = new CasdoorOauthService(
    {} as any,
    config({
      NODE_ENV: 'production',
      CASDOOR_ENDPOINT: 'https://casdoor.example',
      CASDOOR_CLIENT_ID: 'client',
      CASDOOR_CLIENT_SECRET: 'secret',
      CASDOOR_REDIRECT_URI: 'https://chatty.example/auth/callback'
    }),
    {} as any,
    {} as any
  )
  assert.throws(() => service.buildAuthorizeUrl({ next: '/' }), /state_secret_not_configured/)
})

test('OAuth next rejects backslash and control-character redirect forms', () => {
  const service = new CasdoorOauthService({} as any, config({ CASDOOR_STATE_SECRET: 'state' }), {} as any, {} as any)
  const normalizeNext = (service as any).normalizeNext.bind(service)
  assert.equal(normalizeNext('/\\\\evil.example'), '/')
  assert.equal(normalizeNext('/%5cevil.example'), '/')
  assert.equal(normalizeNext('/safe\npath'), '/')
  assert.equal(normalizeNext('https://evil.example'), '/')
})

test('profile name alone does not grant Casdoor admin access', () => {
  const service = new CasdoorOauthService({} as any, config({ CASDOOR_STATE_SECRET: 'state' }), {} as any, {} as any)
  assert.equal((service as any).casdoorAdminRole({ sub: 'subject', name: 'admin' }), null)
})

test('Casdoor login does not reactivate an existing disabled administrator', async () => {
  let updated = false
  const update = async () => {
    updated = true
    return {}
  }
  const service = new AdminService(
    { adminUser: { findFirst: async () => ({ id: 'a1', username: 'old', email: 'old@example.com', casdoorSubject: 'subject', role: 'admin', status: 'disabled' }), update, create: async () => ({}) } } as any,
    {} as any,
    config({ ADMIN_SESSION_SECRET: 'admin-secret' })
  )
  await assert.rejects(
    () => service.loginCasdoorAdmin({ subject: 'subject', username: 'old', email: 'old@example.com', role: 'admin' }, {} as any, { ip: '', userAgent: '' }),
    (error: unknown) => error instanceof UnauthorizedException && (error as Error).message === 'admin_disabled'
  )
  assert.equal(updated, false)
})

test('insufficient points do not create a ledger entry', async () => {
  const tx = {
    pointAccount: {
      upsert: async () => ({}),
      updateManyAndReturn: async () => []
    },
    pointLedger: { create: async () => { throw new Error('ledger must not be written') } }
  }
  const service = new PointsService({} as any, config({}) as any)
  await assert.rejects(
    () => service.consumePointsInTransaction(tx as any, 'u1', BigInt(3), 'request-1'),
    (error: unknown) => error instanceof BadRequestException && (error as Error).message === 'points_insufficient'
  )
})
