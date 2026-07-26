'use client'

import { useState } from 'react'
import { X, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const NAV_ITEMS = ['通用', '外观', '对话偏好', '绘图偏好', '数据与隐私', '通知', '快捷键', '关于']

export default function SettingsModal({ isOpen, onClose, onLogout }) {
  const [home, setHome] = useState('chat')
  const [autoCollapse, setAutoCollapse] = useState(true)
  const [streaming, setStreaming] = useState(true)
  const [enterSend, setEnterSend] = useState(false)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink-900/35 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-[28px] border border-ink-700/10 bg-rice-50 shadow-[var(--shadow-paper-lg)] ricepaper">
        <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[200px_1fr]">
          <aside className="border-b border-ink-700/10 bg-rice-100/82 p-4 md:border-b-0 md:border-r">
            <div className="mb-3 px-2 text-[10px] text-ink-500 label-zh">设 置</div>
            <nav className="flex gap-1 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
              {NAV_ITEMS.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    'shrink-0 rounded-xl px-3 py-2 text-left text-sm transition md:block md:w-full',
                    index === 0
                      ? 'border border-celadon-600/15 bg-celadon-50 font-medium text-celadon-800'
                      : 'text-ink-600 hover:bg-ink-700/5'
                  )}
                >
                  {item}
                </button>
              ))}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-col">
            <div className="flex items-center justify-between px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] text-ink-500 label-zh">通 用</p>
                <h2 className="mt-1 font-serif text-2xl font-semibold text-ink-900">设置 · 调度</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭设置"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-700/5 hover:text-ink-900"
              >
                <X size={19} />
              </button>
            </div>

            <div className="flex-1 px-5 pb-5 sm:px-6">
              <div className="space-y-1">
                <SettingRow title="界面语言" hint="切换后立即生效">
                  <select
                    defaultValue="zh-CN"
                    className="h-9 w-[128px] rounded-xl border border-ink-700/10 bg-rice-50 px-3 text-sm text-ink-900 outline-none transition focus:border-celadon-500/45"
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="zh-HK">繁體中文</option>
                    <option value="en">English</option>
                  </select>
                </SettingRow>

                <SettingRow title="默认进入页面" hint="登录后的首屏">
                  <div className="flex rounded-xl bg-ink-700/5 p-1 text-xs">
                    {[
                      ['chat', '对话'],
                      ['image', '绘图'],
                      ['profile', '个人']
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setHome(value)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 transition',
                          home === value
                            ? 'bg-rice-50 font-medium text-celadon-700 shadow-[var(--shadow-paper)]'
                            : 'text-ink-500 hover:text-ink-800'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow title="侧栏自动折叠" hint="窄屏时自动收起侧栏">
                  <Switch checked={autoCollapse} onCheckedChange={setAutoCollapse} />
                </SettingRow>

                <SettingRow title="流式输出" hint="逐字呈现 AI 回复">
                  <Switch checked={streaming} onCheckedChange={setStreaming} />
                </SettingRow>

                <SettingRow title="回车发送" hint="否则 Shift+Enter 发送、Enter 换行">
                  <Switch checked={enterSend} onCheckedChange={setEnterSend} />
                </SettingRow>

                <SettingRow title="服务端账册" hint="余额、用量和扣费流水以数据库记录为准">
                  <span className="chip text-[10px]">已托管</span>
                </SettingRow>

                <div className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-verm-500">退出登录</div>
                    <div className="mt-0.5 text-[11px] text-ink-500">退出后将清除本设备上的对话与绘图数据</div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={onLogout} className="border-verm-500/30 text-verm-500 hover:bg-verm-500/10">
                    <LogOut size={14} />
                    退 出
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-ink-700/10 bg-rice-100/68 px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button type="button" variant="gradient" size="sm" onClick={onClose}>
                保 存 设 置
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ title, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink-700/5 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="font-medium text-sm text-ink-900">{title}</div>
        <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
