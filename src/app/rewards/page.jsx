'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Loader2, PlayCircle, Gift, Copy, Share2 } from 'lucide-react'
import ProfileShell from '@/components/profile/ProfileShell'
import { toast } from '@/components/ui/sonner'
import { useAuthStore } from '@/store/useStore'
import { cn } from '@/lib/utils'
import {
  fetchRewardsConfig,
  createRewardsSession,
  claimRewards,
  fetchCheckinStatus,
  performCheckin,
  fetchDailyTasksStatus,
  claimTaskReward
} from '@/lib/api'
import LabelZH from '@/components/ui/LabelZH'
import InkStroke from '@/components/ui/InkStroke'

export default function RewardsPage() {
  const router = useRouter()
  const { user, points, setSession } = useAuthStore()
  
  const [config, setConfig] = useState(null)
  const [checkin, setCheckin] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Video Ad mock play state
  const [adPlaying, setAdPlaying] = useState(false)
  const [adTimeLeft, setAdTimeLeft] = useState(0)
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [showQrModal, setShowQrModal] = useState(false)

  useEffect(() => {
    if (!user) {
      router.replace('/login?next=/rewards')
      return
    }
    loadData()
  }, [user])

  async function loadData() {
    try {
      setLoading(true)
      const [nextConfig, nextCheckin, nextTasks] = await Promise.all([
        fetchRewardsConfig(),
        fetchCheckinStatus(),
        fetchDailyTasksStatus()
      ])
      setConfig(nextConfig)
      setCheckin(nextCheckin)
      setTasks(nextTasks)
    } catch (err) {
      toast.error('加载失败', { description: err?.message || '无法获取奖励数据' })
    } finally {
      setLoading(false)
    }
  }

  // Handle Daily Checkin
  async function handleCheckin() {
    if (!user) return
    try {
      const res = await performCheckin()
      toast.success('签到成功', { description: `已领取 ${res.rewardPoints} 算力点！` })
      loadData()
    } catch (err) {
      toast.error('签到失败', { description: err?.message === 'already_checked_in' ? '今日已签到' : (err?.message || '请稍后重试') })
    }
  }

  // Handle Daily Task Claim
  async function handleClaimTask(taskType) {
    if (!user) return
    try {
      const res = await claimTaskReward(taskType)
      toast.success('领取成功', { description: `已领取 ${res.rewardPoints} 算力点！` })
      loadData()
    } catch (err) {
      toast.error('领取失败', { description: err?.message || '请稍后重试' })
    }
  }

  // Handle Video Ad Watching (Mock)
  async function startMockAd() {
    if (!config?.enabled) {
      toast.error('视频广告未开启')
      return
    }
    if (config?.remainingToday <= 0) {
      toast.error('今日可观看次数已达上限')
      return
    }
    try {
      setAdPlaying(true)
      setAdTimeLeft(30)
      const session = await createRewardsSession()
      setCurrentSessionId(session.rewardSessionId)
      
      const interval = setInterval(() => {
        setAdTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(interval)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      setAdPlaying(false)
      toast.error('广告加载失败', { description: err?.message || '请稍后重试' })
    }
  }

  useEffect(() => {
    if (adPlaying && adTimeLeft === 0 && currentSessionId) {
      finishMockAd()
    }
  }, [adPlaying, adTimeLeft, currentSessionId])

  async function finishMockAd() {
    setAdPlaying(false)
    try {
      const res = await claimRewards(currentSessionId)
      toast.success('观看完成', { description: `已获得 ${res.rewardPoints} 算力点奖励！` })
      loadData()
    } catch (err) {
      toast.error('领取失败', { description: err?.message || '请稍后重试' })
    } finally {
      setCurrentSessionId(null)
    }
  }

  function handleCopyInviteLink() {
    const inviteUrl = `${window.location.origin}/login?ref=${user?.id || ''}`
    navigator.clipboard.writeText(inviteUrl)
      .then(() => toast.success('链接已复制', { description: '分享给朋友吧！' }))
      .catch(() => toast.error('复制失败'))
  }

  // Compute 7-day sign-in progress
  const checkinDays = useMemo(() => {
    if (!checkin) return []
    const list = []
    const rewards = [100, 100, 100, 150, 150, 200, 500]
    
    // Checkin streak goes from 1 to streak
    const streak = checkin.streak
    const checkedToday = checkin.checkedInToday
    
    for (let i = 1; i <= 7; i++) {
      let status = 'upcoming' // 'done' | 'active' | 'upcoming'
      if (i < streak || (i === streak && checkedToday)) {
        status = 'done'
      } else if (i === streak + 1 && !checkedToday) {
        status = 'active'
      }
      list.push({ day: i, reward: rewards[i-1], status })
    }
    return list
  }, [checkin])

  if (loading && !checkin) {
    return (
      <ProfileShell active="rewards">
        <div className="flex h-[60dvh] items-center justify-center text-ink-500">
          <Loader2 className="mr-2 animate-spin text-celadon-600" size={18} />
          正在载入奖励中心...
        </div>
      </ProfileShell>
    )
  }

  return (
    <ProfileShell active="rewards">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-zh text-[10px] text-celadon-700">奖 励 · REWARDS</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-ink-900">奖励中心</h1>
          <p className="mt-1 text-sm text-ink-500">签到、看视频或完成每日任务得算力点</p>
        </div>
        <Link href="/profile" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-700/10 bg-rice-50 px-4 text-xs font-semibold text-ink-600 shadow-[var(--shadow-paper)] lg:hidden">
          <ArrowLeft size={13} />
          返回我的
        </Link>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6">
        
        {/* Banner/Hero */}
        <div className="relative rounded-3xl p-6 md:p-8 overflow-hidden text-rice-50 shadow-[var(--shadow-paper)]" style={{ background: 'linear-gradient(135deg, #C8472F 0%, #A93820 100%)' }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none bg-dot-grid" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <LabelZH className="text-rice-50/80 tracking-widest text-[10px]">REWARDS · 砚 田</LabelZH>
              <h2 className="font-serif text-3xl md:text-4xl font-semibold mt-2">每一笔都是真实算力点</h2>
              <p className="opacity-90 mt-2 text-sm leading-relaxed max-w-xl">
                观看激励视频 30 秒即可获得 {config?.rewardPoints || 200} 算力点。
                {config && `今日可领上限 ${config.dailyLimitPerUser} 次，当前剩余 ${config.remainingToday} 次。`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={startMockAd}
                  disabled={adPlaying || config?.remainingToday <= 0}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-rice-50 text-verm-600 font-semibold text-sm shadow hover:bg-rice-100 transition active:scale-95 disabled:opacity-50"
                >
                  <PlayCircle size={15} />
                  {adPlaying ? `观看中 (${adTimeLeft}s)` : '立即网页模拟观看'}
                </button>
                <button
                  onClick={() => setShowQrModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-rice-50/30 bg-transparent text-rice-50 font-medium text-xs hover:bg-rice-50/10 transition"
                >
                  微信扫码观看
                </button>
              </div>
            </div>

            <div className="hidden md:block select-none">
              <div className="seal w-24 h-24 flex flex-col items-center justify-center" style={{ background: '#FDFCF8', color: '#C8472F', boxShadow: 'inset 0 0 0 2px rgba(200,71,47,.3), 0 4px 12px rgba(0,0,0,.1)' }}>
                <span className="font-serif text-2xl font-bold">福</span>
                <span className="text-[9px] tracking-widest mt-0.5 font-semibold">奉还砚田</span>
              </div>
            </div>
          </div>
        </div>

        {/* sign-in & invite side-by-side */}
        <div className="grid md:grid-cols-2 gap-6">
          
          {/* Daily Sign-in */}
          <div className="card p-5 bg-rice-50 relative flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <LabelZH className="text-celadon-700">每日签到</LabelZH>
                {checkin?.checkedInToday ? (
                  <span className="chip text-[10px]">今日已签到</span>
                ) : (
                  <span className="chip chip-verm text-[10px] animate-pulse">今日待签到</span>
                )}
              </div>
              
              <div className="grid grid-cols-7 gap-1.5 my-3">
                {checkinDays.map((d) => (
                  <div
                    key={d.day}
                    className={cn(
                      'aspect-square rounded-lg flex flex-col items-center justify-center text-[10px] font-medium border transition',
                      d.status === 'done' && 'bg-celadon-600 border-celadon-600 text-rice-50 shadow-sm',
                      d.status === 'active' && 'bg-rice-50 border-celadon-500 text-celadon-700 font-bold ring-2 ring-celadon-500/20',
                      d.status === 'upcoming' && 'bg-rice-200 border-ink-700/5 text-ink-500'
                    )}
                  >
                    <span>{d.day}天</span>
                    <span className="mt-0.5 scale-90">{d.reward}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-500 mt-2 leading-relaxed">
                当前已连续签到 <span className="font-mono text-celadon-700 font-semibold">{checkin?.streak || 0}</span> 天。
                {checkin?.checkedInToday ? '明日签到可获得双倍或更高奖励！' : `今日签到可领 ${checkin?.todayReward || 100} 算力点。`}
              </p>
            </div>
            
            <button
              onClick={handleCheckin}
              disabled={checkin?.checkedInToday}
              className={cn(
                'btn-primary justify-center w-full text-sm py-2.5 mt-4',
                checkin?.checkedInToday && 'pointer-events-none opacity-50 bg-ink-700/5 text-ink-400 border-0 shadow-none'
              )}
            >
              {checkin?.checkedInToday ? '已 签 到' : '领 取 今 日 签 到'}
            </button>
          </div>

          {/* Invitation */}
          <div className="card p-5 bg-rice-50 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <LabelZH className="text-celadon-700">邀请有礼</LabelZH>
                <span className="chip chip-gold text-[10px]">双向得 5,000</span>
              </div>
              <div className="font-serif text-3xl font-semibold text-ink-950">
                +5,000<span className="text-base text-ink-500 ml-1 font-sans">/ 人</span>
              </div>
              <p className="text-xs text-ink-500 mt-2 leading-relaxed">
                朋友通过您的链接注册并完成首次对话，双方各得 5,000 算力点。
              </p>
              
              <div className="rounded-xl bg-rice-100 border border-ink-700/8 px-3 py-2.5 mt-4 flex items-center gap-2">
                <code className="text-xs font-mono text-celadon-700 flex-1 truncate select-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/login?ref=${user?.id || ''}` : 'loading...'}
                </code>
                <button
                  onClick={handleCopyInviteLink}
                  className="text-xs text-celadon-700 font-semibold hover:underline flex items-center gap-1 shrink-0"
                >
                  <Copy size={11} />
                  复制
                </button>
              </div>
            </div>

            <div className="flex justify-between text-xs text-ink-500 mt-4 pt-2 border-t border-ink-700/5">
              <span>已成功邀请</span>
              <span className="font-mono font-bold text-ink-900">0 人</span>
            </div>
          </div>
        </div>

        {/* Daily Tasks */}
        <div className="card overflow-hidden bg-rice-50 shadow-[var(--shadow-paper)]">
          <div className="px-5 py-4 border-b border-ink-700/8">
            <h3 className="font-serif font-semibold text-base text-ink-950">每 日 任 务</h3>
            <p className="text-[11px] text-ink-500 mt-0.5">完成任务额外获得算力点，每日 0 点刷新</p>
          </div>
          <div className="divide-y divide-ink-700/5">
            {/* Task 1 */}
            <TaskRow
              title="完成一次对话"
              desc="使用任意模型发起一次聊天对话"
              reward="+100"
              status={tasks?.dialog}
              onClaim={() => handleClaimTask('dialog')}
              onGo={() => router.push('/chat')}
            />
            {/* Task 2 */}
            <TaskRow
              title="生成一张图片"
              desc="在画板中使用任意模型绘制一幅画作"
              reward="+150"
              status={tasks?.image}
              onClaim={() => handleClaimTask('image')}
              onGo={() => router.push('/image')}
            />
            {/* Task 3 */}
            <TaskRow
              title="体验 3 个模型"
              desc={`使用 3 款不同的语言或绘画模型进行对话 · 进度 ${tasks?.models?.count || 0}/3`}
              reward="+200"
              status={tasks?.models}
              onClaim={() => handleClaimTask('models')}
              onGo={() => router.push('/chat')}
            />
          </div>
        </div>

      </div>

      {/* QR Code Scan Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-900/35 backdrop-blur-sm" onClick={() => setShowQrModal(false)} />
          <div className="relative w-full max-w-sm rounded-[28px] border border-ink-700/10 bg-rice-50 p-6 text-center shadow-lg ricepaper">
            <LabelZH className="text-celadon-700">小 程 序 扫 码</LabelZH>
            <h3 className="font-serif text-lg font-semibold text-ink-900 mt-1">在微信小程序观看</h3>
            <p className="text-xs text-ink-500 mt-1.5 leading-relaxed">
              请打开微信扫描下方小程序码，在小程序端直接观看视频广告，算力点同样会实时同步到您的万模账户中。
            </p>
            
            <div className="my-5 mx-auto w-48 h-48 border border-ink-700/10 rounded-2xl bg-white p-3 flex items-center justify-center">
              {/* Fallback mock QR code */}
              <div className="h-full w-full rounded-xl bg-rice-100 flex flex-col items-center justify-center text-ink-400">
                <span className="font-serif font-bold text-3xl text-celadon-600">万模</span>
                <span className="text-[9px] mt-1.5">小程序二维码</span>
              </div>
            </div>
            
            <button
              onClick={() => setShowQrModal(false)}
              className="btn-ghost py-2 w-full text-xs font-semibold"
            >
              关 闭
            </button>
          </div>
        </div>
      )}
    </ProfileShell>
  )
}

function TaskRow({ title, desc, reward, status, onClaim, onGo }) {
  const isCompleted = status?.completed
  const isClaimed = status?.claimed

  return (
    <div className="px-5 py-3.5 flex items-center gap-4 hover:bg-ink-700/[0.02] transition">
      <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-celadon-500" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-ink-900 truncate">{title}</div>
        <div className="text-[11px] text-ink-500 mt-0.5 truncate">{desc}</div>
      </div>
      <span className="font-mono text-celadon-700 text-sm font-semibold pr-2 shrink-0">{reward}</span>
      <div className="shrink-0">
        {isClaimed ? (
          <span className="text-xs text-ink-400 font-semibold px-3 py-1.5 inline-block">已领取</span>
        ) : isCompleted ? (
          <button
            onClick={onClaim}
            className="inline-flex h-8 items-center justify-center px-3 rounded-lg bg-celadon-600 text-rice-50 text-xs font-semibold hover:bg-celadon-500 transition active:scale-95"
          >
            领取算力
          </button>
        ) : (
          <button
            onClick={onGo}
            className="inline-flex h-8 items-center justify-center px-3 rounded-lg border border-ink-700/10 text-ink-700 text-xs font-semibold hover:bg-ink-700/5 transition active:scale-95"
          >
            去完成
          </button>
        )}
      </div>
    </div>
  )
}
