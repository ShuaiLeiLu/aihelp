'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Coins, Gift, History, LogOut, PlayCircle, RefreshCw, ShieldCheck, Sparkles, Ticket } from 'lucide-react'
import { fetchMe, fetchPointsLedger, fetchPointsSummary } from '@/lib/api'
import { useAuthStore } from '@/store/useStore'
import { performLogoutCleanup } from '@/lib/auth-cleanup'
import { cn } from '@/lib/utils'
import ProfileShell from '@/components/profile/ProfileShell'

export default function ProfilePage() {
  const router = useRouter()
  const { user, points, setSession, clearSession } = useAuthStore()
  const [ledger, setLedger] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refreshGeneration = useRef(0)
  const isLoggingOut = useRef(false)

  useEffect(() => {
    refresh()
  }, [])

  const balance = useMemo(() => formatToken(points?.pointsBalance || 0), [points])
  async function refresh() {
    const generation = ++refreshGeneration.current
    if (isLoggingOut.current) return
    try {
      setLoading(true)
      setError('')
      const [nextUser, nextPoints, nextLedger] = await Promise.all([
        fetchMe(),
        fetchPointsSummary(),
        fetchPointsLedger({ pageSize: 30 })
      ])
      if (isLoggingOut.current || generation !== refreshGeneration.current) return
      setSession({ user: nextUser, points: nextPoints })
      setLedger(nextLedger)
    } catch (err) {
      if (isLoggingOut.current || generation !== refreshGeneration.current) return
      if (String(err.message || '').includes('请先登录')) {
        clearSession()
        router.replace('/login')
        return
      }
      setError(err.message || '个人中心加载失败')
    } finally {
      if (!isLoggingOut.current && generation === refreshGeneration.current) setLoading(false)
    }
  }

  async function handleLogout() {
    isLoggingOut.current = true
    refreshGeneration.current += 1
    setLoading(false)
    await performLogoutCleanup()
    router.replace('/login')
  }

  return (
    <ProfileShell active="profile">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-celadon-700 label-zh">个 人 中 心</p>
                <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-900">{spacedName(user?.displayName || '微信用户')}</h1>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/image"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-700/10 bg-rice-50 px-4 text-xs font-semibold text-ink-600 shadow-[var(--shadow-paper)] transition hover:bg-rice-100 active:scale-95 lg:hidden"
                >
                  <ArrowLeft size={13} />
                  返回客户端
                </Link>
                <button
                  onClick={refresh}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-700/10 bg-rice-50 px-4 text-xs font-semibold text-ink-600 shadow-[var(--shadow-paper)] transition hover:bg-rice-100 active:scale-95"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  刷新
                </button>
                <button
                  onClick={handleLogout}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-verm-500/20 bg-verm-500/5 px-4 text-xs font-semibold text-verm-600 transition hover:bg-verm-500/10 active:scale-95"
                >
                  <LogOut size={13} />
                  退出登录
                </button>
              </div>
            </div>

        <section className="relative overflow-hidden rounded-[28px] border border-ink-700/10 bg-rice-50 p-6 shadow-[var(--shadow-paper)] ricepaper">
          <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-celadon-600 to-celadon-500 text-xl font-bold text-rice-50 shadow-[var(--shadow-ink)]">
                  {(user?.displayName || '微').slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <h1 className="truncate font-serif text-3xl font-semibold text-ink-900 tracking-wide">{spacedName(user?.displayName || '微信用户')}</h1>
                  <p className="mt-1 truncate text-[10px] font-mono text-ink-500">ID: {user?.id || '正在同步...'}</p>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-2xl border border-celadon-700/20 bg-gradient-to-br from-celadon-600 via-celadon-800 to-ink-800 p-5 text-rice-50 shadow-[var(--shadow-ink)] min-h-[180px] flex flex-col justify-between">
                <div className="absolute inset-0 bg-dot-grid opacity-25 pointer-events-none" />
                <div className="seal absolute right-5 top-5 flex h-12 w-12 flex-col items-center justify-center text-center">
                  <span className="font-serif text-sm font-bold leading-tight">万模</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Coins size={18} className="text-gold-400" />
                    <span className="text-[10px] label-zh text-rice-50/80">万 模 卡</span>
                  </div>
                </div>

                <div className="my-3">
                  <span className="text-[9px] text-rice-50/60 block uppercase tracking-wider font-semibold">Available Balance</span>
                  <span className="text-4xl font-light tracking-tight text-rice-50 font-mono">{balance}</span>
                </div>

                <div className="flex items-end justify-between text-[9px] font-mono">
                  <div>
                    <span className="text-[8px] text-rice-50/50 block uppercase tracking-wider font-semibold">Holder ID</span>
                    <span className="text-rice-50/80 max-w-[150px] truncate block">{user?.id || 'SYNCING...'}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[8px] text-rice-50/50 block uppercase tracking-wider font-semibold">Point Unit</span>
                    <span className="text-gold-400 font-bold">积分</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <QuickAction href="/rewards" icon={PlayCircle} label="看视频" />
                <QuickAction href="/redeem" icon={Ticket} label="兑换码" />
                <QuickAction href="/recharge" icon={Gift} label="充值" />
              </div>
            </div>

            <div className="rounded-2xl border border-ink-700/10 bg-rice-100 p-5 flex flex-col justify-between">
              <div>
                <h2 className="text-xs font-bold text-ink-900 flex items-center gap-1.5 mb-4">
                  <span className="h-1.5 w-1.5 rounded-full bg-celadon-600" />
                  账号状态与规则
                </h2>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-xl border border-celadon-600/15 bg-celadon-50 p-3.5 text-xs text-celadon-800">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-celadon-600" />
                    <div>
                      <p className="font-semibold text-celadon-800">微信身份已绑定</p>
                      <p className="mt-1 leading-relaxed text-celadon-700/70">客户端扫码登录、小程序同步，都归集到同一个后端用户。</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-ink-700/10 bg-rice-50 p-3.5 text-xs text-ink-600">
                    <Sparkles size={16} className="mt-0.5 shrink-0 text-gold-600" />
                    <div>
                      <p className="font-semibold text-ink-900">数据以后端账本为准</p>
                      <p className="mt-1 leading-relaxed text-ink-500">模型消耗、奖励、管理员手动调整均以服务端流水为依据。</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

            <LedgerSection error={error} loading={loading} ledger={ledger} />
    </ProfileShell>
  )
}

function LedgerSection({ error, loading, ledger }) {
  return (
        <section className="mt-6 rounded-[28px] border border-ink-700/10 bg-rice-50 p-6 shadow-[var(--shadow-paper)]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={16} className="text-ink-500" />
              <h2 className="font-serif text-sm font-semibold text-ink-900">算力点流水</h2>
            </div>
            <span className="text-xs text-ink-500 font-medium label-zh">最 近 30 条</span>
          </div>

          {error ? (
            <div className="rounded-xl border border-verm-500/20 bg-verm-500/10 px-4 py-3 text-xs text-verm-600">{error}</div>
          ) : loading ? (
            <div className="py-12 text-center text-xs text-ink-500 flex flex-col items-center gap-2">
              <RefreshCw size={18} className="animate-spin text-celadon-600" />
              正在拉取账单流水...
            </div>
          ) : ledger.length === 0 ? (
            <div className="py-12 text-center text-xs text-ink-500">暂无算力点流水</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-ink-700/10 bg-rice-50">
              {ledger.map((item) => {
                const isPositive = Number(item.deltaPoints || 0) >= 0
                return (
                  <div key={item.id} className="grid min-h-12 gap-3 border-b border-rice-200 px-4 py-3.5 last:border-b-0 sm:grid-cols-[1fr_auto_auto] sm:items-center transition-colors duration-200 hover:bg-rice-100">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink-900">{ledgerTitle(item.type)}</p>
                      <p className="mt-0.5 truncate text-[10.5px] text-ink-500 font-medium">{item.remark || item.relatedId || '系统记录'}</p>
                    </div>
                    <p className={cn(
                      'text-sm font-mono font-bold leading-none',
                      isPositive ? 'text-celadon-700' : 'text-verm-600'
                    )}>
                      {isPositive ? '+' : ''}{formatToken(item.deltaPoints)}
                    </p>
                    <p className="text-[10px] font-medium text-ink-500 sm:text-right">{formatDate(item.createdAt)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </section>
  )
}

function QuickAction({ href, icon: Icon, label }) {
  const content = (
    <>
      <Icon size={18} className="text-celadon-700" />
      <span>{label}</span>
    </>
  )
  const className = 'flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-2xl border border-ink-700/10 bg-rice-50 text-xs font-medium text-ink-700 shadow-[var(--shadow-paper)] transition hover:bg-rice-100 active:scale-[0.98]'
  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    )
  }
  return (
    <button className={className}>
      {content}
    </button>
  )
}

function spacedName(name) {
  const clean = String(name || '').trim()
  if (!clean) return '微 信 用 户'
  if (/^[\u4e00-\u9fff]{2,4}$/.test(clean)) return clean.split('').join(' ')
  return clean
}

function formatToken(value) {
  const numberValue = Number(value || 0)
  if (!Number.isFinite(numberValue)) return String(value || 0)
  return numberValue.toLocaleString('en-US')
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function ledgerTitle(type) {
  const map = {
    ad_reward: '广告奖励',
    model_usage: '模型消耗',
    redeem_code: '兑换到账',
    recharge: '充值到账',
    manual_adjustment: '后台调整'
  }
  return map[type] || type || '算力点变动'
}
