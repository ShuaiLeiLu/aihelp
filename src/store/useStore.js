import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

const ACTIVE_ACCOUNT_STORAGE_KEY = 'chatty-active-account'

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function normalizeAccountId(accountId) {
  const value = String(accountId || '').trim()
  return value || null
}

export function getAccountStorageKey(name, accountId) {
  const normalized = normalizeAccountId(accountId)
  return normalized ? `${name}:user:${encodeURIComponent(normalized)}` : null
}

export function setActiveAccountId(accountId) {
  if (!canUseStorage()) return
  const normalized = normalizeAccountId(accountId)
  if (normalized) {
    window.localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, normalized)
    // Legacy unscoped values cannot be attributed to a user safely.
    window.localStorage.removeItem('chatty-storage')
    window.localStorage.removeItem('chatty-image-ui')
  } else {
    window.localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY)
  }
}

export function readAccountState(name, accountId) {
  if (!canUseStorage()) return null
  const key = getAccountStorageKey(name, accountId)
  if (!key) return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.state && typeof parsed.state === 'object' ? parsed.state : null
  } catch {
    return null
  }
}

export function accountStorage(name) {
  return {
    getItem: () => {
      if (!canUseStorage()) return null
      const accountId = window.localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY)
      const key = getAccountStorageKey(name, accountId)
      return key ? window.localStorage.getItem(key) : null
    },
    setItem: (_name, value) => {
      if (!canUseStorage()) return
      const accountId = window.localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY)
      const key = getAccountStorageKey(name, accountId)
      if (key) window.localStorage.setItem(key, value)
    },
    removeItem: () => {
      if (!canUseStorage()) return
      const accountId = window.localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY)
      const key = getAccountStorageKey(name, accountId)
      if (key) window.localStorage.removeItem(key)
    }
  }
}

export const useChatStore = create(
  persist(
    (set, get) => ({
      accountId: null,
      conversations: [],
      activeConversationId: null,
      history: {}, // convId -> messages[]

      setAccountScope: (accountId) => {
        const normalized = normalizeAccountId(accountId)
        if (!normalized || get().accountId === normalized) return
        setActiveAccountId(normalized)
        const saved = readAccountState('chatty-storage', normalized)
        set({
          accountId: normalized,
          conversations: Array.isArray(saved?.conversations) ? saved.conversations : [],
          activeConversationId: saved?.activeConversationId || null,
          history: saved?.history && typeof saved.history === 'object' ? saved.history : {}
        })
      },

      clearAccountData: () => {
        const currentId = get().accountId
        set({ accountId: null, conversations: [], activeConversationId: null, history: {} })
        const key = getAccountStorageKey('chatty-storage', currentId)
        if (canUseStorage() && key) window.localStorage.removeItem(key)
        setActiveAccountId(null)
      },

      // Actions
      addConversation: (conv) => set((state) => ({
        conversations: [conv, ...state.conversations]
      })),

      replaceConversationId: (oldId, newId, updates = {}) => set((state) => {
        if (!oldId || !newId || oldId === newId) return state
        const oldMessages = state.history[oldId] || []
        const { [oldId]: _, ...remainingHistory } = state.history
        return {
          conversations: state.conversations.map((conversation) => (
            conversation.id === oldId ? { ...conversation, ...updates, id: newId } : conversation
          )),
          history: {
            ...remainingHistory,
            [newId]: oldMessages
          },
          activeConversationId: state.activeConversationId === oldId ? newId : state.activeConversationId
        }
      }),
      
      deleteConversation: (id) => set((state) => {
        const { [id]: _, ...remainingHistory } = state.history
        return {
          conversations: state.conversations.filter((c) => c.id !== id),
          history: remainingHistory,
          activeConversationId: state.activeConversationId === id ? null : state.activeConversationId
        }
      }),

      setActiveConversationId: (id) => set({ activeConversationId: id }),

      addMessage: (convId, message) => set((state) => {
        const convMessages = state.history[convId] || []
        const newHistory = {
          ...state.history,
          [convId]: [...convMessages, message]
        }
        
        // Update conversation's updatedAt and messageCount
        const newConversations = state.conversations.map(c => 
          c.id === convId ? { ...c, updatedAt: Date.now(), messageCount: (c.messageCount || 0) + 1 } : c
        )

        return {
          history: newHistory,
          conversations: newConversations
        }
      }),

      updateMessage: (convId, msgId, updates) => set((state) => {
        const convMessages = state.history[convId] || []
        const newHistory = {
          ...state.history,
          [convId]: convMessages.map(m => m.id === msgId ? { ...m, ...updates } : m)
        }
        return { history: newHistory }
      }),

      clearHistory: (convId) => set((state) => {
        const newHistory = { ...state.history }
        delete newHistory[convId]
        return { history: newHistory }
      })
    }),
    {
      name: 'chatty-storage',
      storage: createJSONStorage(() => accountStorage('chatty-storage')),
      skipHydration: true,
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        history: state.history
      })
    }
  )
)

export const useUIStore = create(
  persist(
    (set) => ({
      // mobile overlay open/close
      isSidebarOpen: true,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),

      // desktop rail collapse
      isSidebarCollapsed: false,
      toggleSidebarCollapsed: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed })
    }),
    {
      name: 'chatty-ui',
      partialize: (state) => ({ isSidebarCollapsed: state.isSidebarCollapsed })
    }
  )
)

export const useModelStore = create((set) => ({
  selectedProvider: null,
  selectedModel: null,
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),
  setSelectedModel: (model) => set({ selectedModel: model }),
}))

export const useAuthStore = create((set) => ({
  user: null,
  points: null,
  isLoading: false,
  isAuthenticated: false,
  setAuthLoading: (isLoading) => set({ isLoading }),
  setSession: ({ user, points }) => set({
    user: user || null,
    points: points || null,
    isAuthenticated: Boolean(user),
    isLoading: false
  }),
  clearSession: () => set({
    user: null,
    points: null,
    isAuthenticated: false,
    isLoading: false
  })
}))
