'use client'

import { memo, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  Menu,
  PanelLeftClose,
  PanelLeft,
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  User,
  Image as ImageIcon,
  Coins,
  Gift
} from 'lucide-react'
import { useUIStore, useChatStore, useModelStore, useAuthStore } from '@/store/useStore'
import { useImageStore } from '@/store/useImageStore'
import SettingsModal from './SettingsModal'
import { cn, formatNumber, formatRelativeTime } from '@/lib/utils'
import { deleteTask } from '@/lib/image/db'
import { performLogoutCleanup } from '@/lib/auth-cleanup'

export default function Shell({ children, workspace = 'chat' }) {
  const router = useRouter()
  const pathname = usePathname()
  const {
    isSidebarOpen,
    toggleSidebar,
    setSidebarOpen,
    isSidebarCollapsed,
    toggleSidebarCollapsed
  } = useUIStore()
  const {
    conversations,
    accountId: chatAccountId,
    activeConversationId,
    setActiveConversationId,
    deleteConversation,
    setAccountScope: setChatAccountScope
  } = useChatStore()
  const { selectedProvider, selectedModel, setSelectedModel, setSelectedProvider } = useModelStore()
  const { user, points, isAuthenticated, isLoading: isAuthLoading } = useAuthStore()
  const imageTaskIndex = useImageStore((s) => s.taskIndex)
  const imageAccountId = useImageStore((s) => s.accountId)
  const activeTaskId = useImageStore((s) => s.activeTaskId)
  const setActiveTaskId = useImageStore((s) => s.setActiveTaskId)
  const removeTaskFromIndex = useImageStore((s) => s.removeTaskFromIndex)
  const setImageAccountScope = useImageStore((s) => s.setAccountScope)

  const [isMobile, setIsMobile] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    setChatAccountScope(user.id)
    setImageAccountScope(user.id)
  }, [user?.id, setChatAccountScope, setImageAccountScope])

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      setSidebarOpen(!mobile)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [setSidebarOpen])

  const collapsed = !isMobile && isSidebarCollapsed
  const inActiveChat = workspace === 'chat' && activeConversationId

  const switchWorkspace = useCallback((target) => {
    if (target === 'chat' && pathname !== '/chat') router.push('/chat')
    if (target === 'image' && pathname !== '/image') router.push('/image')
    if (isMobile) setSidebarOpen(false)
  }, [isMobile, pathname, router, setSidebarOpen])

  const createNewItem = useCallback(() => {
    if (workspace === 'chat') {
      setActiveConversationId(null)
      setSelectedModel(null)
      setSelectedProvider(null)
    } else {
      setActiveTaskId(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    if (isMobile) setSidebarOpen(false)
  }, [
    workspace,
    isMobile,
    setActiveConversationId,
    setSelectedModel,
    setSelectedProvider,
    setActiveTaskId,
    setSidebarOpen
  ])

  const handleSelectConversation = useCallback((id) => {
    setActiveConversationId(id)
    if (isMobile) setSidebarOpen(false)
  }, [isMobile, setActiveConversationId, setSidebarOpen])

  const handleSelectTask = useCallback((id) => {
    setActiveTaskId(id)
    if (isMobile) setSidebarOpen(false)
  }, [isMobile, setActiveTaskId, setSidebarOpen])

  const handleDeleteTask = useCallback(async (id) => {
    try {
      await deleteTask(id)
      removeTaskFromIndex(id)
    } catch (err) {
      console.warn('[shell] delete task failed', err)
    }
  }, [removeTaskFromIndex])

  const handleLogout = useCallback(async () => {
    setIsSettingsOpen(false)
    await performLogoutCleanup()
    router.replace('/login')
  }, [router])

  const accountReady = Boolean(user?.id) && chatAccountId === user.id && imageAccountId === user.id
  const visibleConversations = accountReady ? conversations : []
  const visibleImageTaskIndex = accountReady ? imageTaskIndex : []

  return (
    <div className="relative flex h-screen-dvh w-full overflow-hidden bg-rice-100 text-ink-900 paper">
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/35 backdrop-blur-sm transition-opacity animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 transform transition-[width,transform] duration-300 ease-in-out lg:relative lg:translate-x-0',
          'border-r border-ink-700/10 bg-rice-50/95 pl-safe shadow-[12px_0_36px_-24px_rgba(20,18,12,.35)] backdrop-blur-xl',
          collapsed ? 'w-16' : 'w-[84vw] max-w-[300px] lg:w-[260px]',
          !isSidebarOpen && '-translate-x-full lg:hidden'
        )}
      >
        <div className="flex h-full flex-col p-3 pt-safe">
          <div className={cn('mb-4 flex items-center gap-2', collapsed ? 'flex-col' : 'justify-between')}>
            <Link
              href="/image"
              className={cn('flex items-center gap-2 rounded-xl py-1.5 tap-transparent', collapsed ? 'justify-center w-full' : 'flex-1 min-w-0')}
              title={collapsed ? '万模 AI' : undefined}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-celadon-600 to-celadon-500 text-rice-50 shadow-[var(--shadow-ink)]">
                <span className="font-serif text-xl font-bold">万</span>
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="truncate font-serif text-base font-semibold tracking-wide brand-mark">万模 AI</p>
                  <p className="truncate text-[10px] text-ink-500">一念通达 · 万模为器</p>
                </div>
              )}
            </Link>

            {!isMobile && (
              <Tip label={collapsed ? '展开侧边栏' : '收起侧边栏'} placement="right">
                <button
                  onClick={toggleSidebarCollapsed}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-700/5 hover:text-ink-900 tap-transparent"
                  aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
                >
                  {collapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
                </button>
              </Tip>
            )}
          </div>

          {collapsed ? (
            <div className="mb-3 flex flex-col gap-1">
              <RailButton icon={MessageSquare} label="对话" active={workspace === 'chat'} onClick={() => switchWorkspace('chat')} />
              <RailButton icon={ImageIcon} label="绘图" active={workspace === 'image'} onClick={() => switchWorkspace('image')} />
            </div>
          ) : (
            <div className="mb-4 flex rounded-xl border border-ink-700/10 bg-rice-200/70 p-1">
              <WorkspaceTab icon={MessageSquare} label="对话" active={workspace === 'chat'} onClick={() => switchWorkspace('chat')} />
              <WorkspaceTab icon={ImageIcon} label="绘图" active={workspace === 'image'} onClick={() => switchWorkspace('image')} />
            </div>
          )}

          {workspace === 'chat' && (
            collapsed ? (
              <Tip label="开启新对话" placement="right">
                <button
                  onClick={createNewItem}
                  className="mb-4 flex h-10 w-10 mx-auto items-center justify-center rounded-xl bg-celadon-600 text-rice-50 shadow-[var(--shadow-ink)] transition hover:bg-celadon-500 active:scale-95 tap-transparent"
                  aria-label="开启新对话"
                >
                  <Plus size={16} />
                </button>
              </Tip>
            ) : (
              <button
                onClick={createNewItem}
                className="mb-4 flex min-h-[44px] items-center gap-3 rounded-xl bg-gradient-to-br from-celadon-600 to-celadon-500 px-4 py-2.5 text-sm font-medium text-rice-50 shadow-[var(--shadow-ink)] transition hover:-translate-y-0.5 active:scale-[0.98] tap-transparent"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-rice-50/16">
                  <Plus size={14} />
                </span>
                <span>开启新对话</span>
              </button>
            )
          )}

          {!collapsed && (
            <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1 scrollbar-thin">
              {workspace === 'chat' ? (
                <ChatList
                  conversations={visibleConversations}
                  activeId={activeConversationId}
                  onSelect={handleSelectConversation}
                  onDelete={deleteConversation}
                />
              ) : (
                <ImageList
                  tasks={visibleImageTaskIndex}
                  activeTaskId={activeTaskId}
                  onSelect={handleSelectTask}
                  onDelete={handleDeleteTask}
                />
              )}
            </div>
          )}

          {collapsed && <div className="flex-1" />}

          {collapsed ? (
            <div className="mt-auto flex flex-col items-center gap-1 border-t border-ink-700/10 pt-3 pb-safe">
              <Tip label="设置" placement="right">
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-700/5 hover:text-ink-900 tap-transparent"
                  aria-label="设置"
                >
                  <Settings size={16} />
                </button>
              </Tip>
              <Tip
                label={
                  isAuthLoading
                    ? '同步登录状态中'
                    : isAuthenticated
                      ? `${user?.displayName || '微信用户'}\n${formatNumber(points?.pointsBalance || 0)} 算力点`
                      : '未登录'
                }
                placement="right"
              >
                <Link href={isAuthenticated ? '/profile' : '/login'} className="flex h-9 w-9 items-center justify-center rounded-xl bg-celadon-600 text-rice-50 transition hover:bg-celadon-500 tap-transparent">
                  <User size={15} />
                </Link>
              </Tip>
            </div>
          ) : (
            <div className="mt-auto space-y-2 border-t border-ink-700/10 pt-3 pb-safe">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-500 transition-colors hover:bg-ink-700/5 hover:text-ink-900 tap-transparent"
              >
                <Settings size={16} />
                <span>设置</span>
              </button>
              <Link
                href={isAuthenticated ? '/profile' : '/login'}
                className="flex min-h-[58px] items-center gap-3 rounded-2xl border border-ink-700/10 bg-rice-100 px-3 py-2.5 transition hover:bg-rice-50 tap-transparent"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-celadon-600 to-celadon-500 text-rice-50">
                  <User size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-ink-900">
                    {isAuthLoading && !isAuthenticated
                      ? '同步登录中'
                      : isAuthenticated
                        ? user?.displayName || '微信用户'
                        : '未登录'}
                  </p>
                  <p className="flex items-center gap-1 truncate text-[10px] text-ink-500 mt-0.5">
                    {isAuthLoading && !isAuthenticated ? (
                      <span className="inline-block h-2 w-2 rounded-full bg-celadon-500 animate-pulse" />
                    ) : isAuthenticated ? (
                      <>
                        <Coins size={9} className="text-gold-600" />
                        <span className="font-mono text-gold-600">{formatNumber(points?.pointsBalance || 0)}</span>
                        <span className="text-[9px]">算力点</span>
                      </>
                    ) : (
                      <span className="text-celadon-700 font-medium">点击进入登录</span>
                    )}
                  </p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col min-w-0">
        <MobileHeader
          workspace={workspace}
          inActiveChat={!!inActiveChat}
          provider={selectedProvider}
          model={selectedModel}
          points={points}
          isAuthenticated={isAuthenticated}
          onMenu={toggleSidebar}
          onCreate={createNewItem}
        />
        <div className="flex min-h-0 flex-1 flex-col pb-[64px] lg:pb-0">
          {children}
        </div>
      </main>

      <MobileTabbar active={workspace} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onLogout={handleLogout} />
    </div>
  )
}

const MobileHeader = memo(function MobileHeader({
  workspace,
  inActiveChat,
  provider,
  model,
  points,
  isAuthenticated,
  onMenu,
  onCreate
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-700/10 bg-rice-50/90 px-3 backdrop-blur-xl pl-safe pr-safe lg:hidden">
      <button
        onClick={onMenu}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-700 hover:bg-ink-700/5 active:scale-95 tap-transparent"
        aria-label="打开菜单"
      >
        <Menu size={18} />
      </button>

      {inActiveChat && model ? (
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <div className="logo-dot shrink-0" style={{ background: provider?.color || '#1F6B66' }}>
            {provider?.logo ? <img src={provider.logo} alt="" className="h-4 w-4 object-contain" /> : provider?.initial || '万'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-ink-900 leading-tight">{model?.name}</p>
            {isAuthenticated && points?.pointsBalance != null && (
              <p className="flex items-center gap-1 text-[9px] text-ink-500 leading-tight">
                <Coins size={8} className="text-gold-600" />
                {formatNumber(points.pointsBalance)} 算力点
              </p>
            )}
          </div>
        </div>
      ) : (
        <Link href={workspace === 'chat' ? '/chat' : '/image'} className="flex flex-1 items-center justify-center gap-2 tap-transparent">
          <span className="font-serif text-sm font-semibold brand-mark">万模 AI</span>
        </Link>
      )}

      <button
        onClick={onCreate}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-celadon-600 text-rice-50 active:scale-95 tap-transparent"
        aria-label={workspace === 'chat' ? '新对话' : '新任务'}
      >
        <Plus size={18} />
      </button>
    </header>
  )
})

function MobileTabbar({ active }) {
  const items = [
    { href: '/chat', label: '对话', icon: MessageSquare, id: 'chat' },
    { href: '/image', label: '绘图', icon: ImageIcon, id: 'image' },
    { href: '/rewards', label: '奖励', icon: Gift, id: 'rewards' },
    { href: '/profile', label: '我的', icon: User, id: 'profile' }
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-ink-700/10 bg-rice-50/95 px-2 pb-safe backdrop-blur-xl lg:hidden">
      {items.map((item) => {
        const Icon = item.icon
        const isActive = item.id === active || (item.id === 'profile' && active === 'profile')
        return (
          <Link
            key={`${item.id}-${item.label}`}
            href={item.href}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10px] transition tap-transparent',
              isActive ? 'text-celadon-700' : 'text-ink-500'
            )}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function WorkspaceTab({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all tap-transparent active:scale-95',
        active
          ? 'bg-rice-50 text-celadon-700 shadow-[var(--shadow-paper)]'
          : 'text-ink-500 hover:bg-rice-50/70 hover:text-ink-900'
      )}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  )
}

function RailButton({ icon: Icon, label, active, onClick }) {
  return (
    <Tip label={label} placement="right">
      <button
        onClick={onClick}
        className={cn(
          'flex h-10 w-10 mx-auto items-center justify-center rounded-xl transition-all tap-transparent active:scale-95',
          active ? 'bg-celadon-600 text-rice-50 shadow-[var(--shadow-ink)]' : 'text-ink-500 hover:bg-ink-700/5 hover:text-ink-900'
        )}
      >
        <Icon size={16} />
      </button>
    </Tip>
  )
}

function Tip({ label, placement = 'right', children }) {
  return (
    <span className="group/tip relative inline-block">
      {children}
      <span
        className={cn(
          'pointer-events-none absolute z-50 whitespace-pre rounded-md border border-ink-700/10 bg-rice-50 px-2 py-1 text-[11px] font-medium text-ink-700 shadow-[var(--shadow-paper)] opacity-0 transition-opacity group-hover/tip:opacity-100 hidden lg:block',
          placement === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
          placement === 'left' && 'right-full top-1/2 mr-2 -translate-y-1/2',
          placement === 'top' && 'bottom-full left-1/2 mb-2 -translate-x-1/2',
          placement === 'bottom' && 'top-full left-1/2 mt-2 -translate-x-1/2'
        )}
      >
        {label}
      </span>
    </span>
  )
}

const ChatList = memo(function ChatList({ conversations, activeId, onSelect, onDelete }) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-700/10 bg-rice-100/60 py-10 text-center text-ink-400">
        <MessageSquare size={24} strokeWidth={1.5} />
        <p className="mt-2 text-xs font-medium">暂无对话历史</p>
      </div>
    )
  }
  return (
    <>
      <p className="px-2 pb-2 text-[10px] text-ink-500 label-zh">最 近 对 话</p>
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={cn(
            'group relative flex min-h-[44px] cursor-pointer items-center justify-between rounded-xl px-3 py-2 transition-all tap-transparent active:scale-[0.98]',
            activeId === conv.id
              ? 'border border-celadon-200 bg-celadon-50 text-celadon-800'
              : 'border border-transparent text-ink-500 hover:bg-ink-700/5 hover:text-ink-900'
          )}
        >
          {activeId === conv.id && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r bg-celadon-600" />}
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare size={13} />
            <span className="truncate text-xs font-medium">{conv.title}</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(conv.id)
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition hover:bg-verm-500/10 hover:text-verm-600 lg:h-6 lg:w-6 lg:opacity-0 lg:group-hover:opacity-100 tap-transparent"
            aria-label="删除"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </>
  )
})

const ImageList = memo(function ImageList({ tasks, activeTaskId, onSelect, onDelete }) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-700/10 bg-rice-100/60 py-10 text-center text-ink-400">
        <ImageIcon size={24} strokeWidth={1.5} />
        <p className="mt-2 text-xs font-medium">还没有图片任务</p>
      </div>
    )
  }
  return (
    <>
      <p className="px-2 pb-2 text-[10px] text-ink-500 label-zh">最 近 任 务</p>
      {tasks.slice(0, 50).map((task) => {
        const isRunning = task.status === 'running'
        const statusColor =
          task.status === 'done'
            ? 'text-celadon-700'
            : task.status === 'failed'
              ? 'text-verm-600'
              : 'text-gold-600'
        return (
          <div
            key={task.id}
            onClick={() => onSelect(task.id)}
            className={cn(
              'group relative flex min-h-[48px] cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 transition-all tap-transparent active:scale-[0.98]',
              activeTaskId === task.id
                ? 'border-celadon-200 bg-celadon-50 text-celadon-800'
                : 'border-transparent text-ink-500 hover:bg-ink-700/5 hover:text-ink-900'
            )}
          >
            {activeTaskId === task.id && <div className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r bg-celadon-600" />}
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rice-50 border border-ink-700/10">
              <ImageIcon size={12} className={cn(statusColor, isRunning && 'animate-spin')} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{task.prompt || '未命名任务'}</p>
              <p className="text-[10px] text-ink-500 mt-0.5">
                {formatRelativeTime(task.createdAt)} ·{' '}
                <span className={statusColor}>{task.status === 'done' ? '完成' : task.status === 'failed' ? '失败' : '生成中'}</span>
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(task.id)
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-verm-500/10 hover:text-verm-600 lg:h-6 lg:w-6 lg:opacity-0 lg:group-hover:opacity-100 tap-transparent"
              aria-label="删除"
            >
              <Trash2 size={10} />
            </button>
          </div>
        )
      })}
    </>
  )
})
