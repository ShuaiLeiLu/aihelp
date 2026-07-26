'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { uid } from '@/lib/utils'
import { accountStorage, getAccountStorageKey, readAccountState, setActiveAccountId } from './useStore'

const DEFAULT_PARAMS = {
  size: '1024x1024',
  quality: 'medium',
  output_format: 'png',
  output_compression: 80,
  moderation: 'auto',
  n: 1
}

const DEFAULT_PRESET = {
  target: '1K',
  aspect: '1:1'
}

// All large data (image blobs, base64 refs) lives in IndexedDB; this store
// only persists lightweight UI state and the in-memory task index.

export const useImageStore = create(
  persist(
    (set, get) => ({
      accountId: null,
      // --- task index (in memory + persisted lightly; full data in IndexedDB) ---
      taskIndex: [], // [{ id, status, prompt, createdAt, modelId }]

      // --- composer state ---
      prompt: '',
      modelId: null,
      params: { ...DEFAULT_PARAMS },
      sizePreset: { ...DEFAULT_PRESET },
      // pending reference images (in memory only, not persisted)
      refs: [], // [{ hash, previewUrl, type, width, height, bytes, name }]

      // --- UI state ---
      filter: 'all', // all | running | done | failed
      search: '',
      activeTaskId: null,

      setAccountScope: (accountId) => {
        const normalized = String(accountId || '').trim()
        if (!normalized || get().accountId === normalized) return
        setActiveAccountId(normalized)
        const saved = readAccountState('chatty-image-ui', normalized)
        set({
          accountId: normalized,
          taskIndex: [],
          activeTaskId: null,
          prompt: typeof saved?.prompt === 'string' ? saved.prompt : '',
          modelId: saved?.modelId || null,
          params: saved?.params && typeof saved.params === 'object' ? { ...DEFAULT_PARAMS, ...saved.params } : { ...DEFAULT_PARAMS },
          sizePreset: saved?.sizePreset && typeof saved.sizePreset === 'object' ? { ...DEFAULT_PRESET, ...saved.sizePreset } : { ...DEFAULT_PRESET },
          filter: saved?.filter || 'all',
          search: typeof saved?.search === 'string' ? saved.search : '',
          refs: []
        })
      },

      clearAccountData: () => {
        const currentId = get().accountId
        set({
          accountId: null,
          taskIndex: [],
          prompt: '',
          modelId: null,
          params: { ...DEFAULT_PARAMS },
          sizePreset: { ...DEFAULT_PRESET },
          refs: [],
          filter: 'all',
          search: '',
          activeTaskId: null
        })
        const key = getAccountStorageKey('chatty-image-ui', currentId)
        if (typeof window !== 'undefined' && key) window.localStorage.removeItem(key)
        setActiveAccountId(null)
      },

      // ---- actions ----
      setPrompt: (prompt) => set({ prompt }),
      setModelId: (modelId) => set({ modelId }),
      setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),
      setParams: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
      setSizePreset: (preset) => set({ sizePreset: { ...get().sizePreset, ...preset } }),

      addRef: (ref) =>
        set((s) => {
          if (s.refs.length >= 16) return s
          if (s.refs.find((r) => r.hash === ref.hash)) return s
          return { refs: [...s.refs, ref] }
        }),
      removeRef: (hash) => set((s) => ({ refs: s.refs.filter((r) => r.hash !== hash) })),
      clearRefs: () => set({ refs: [] }),
      setRefs: (refs) => set({ refs }),

      setFilter: (filter) => set({ filter }),
      setSearch: (search) => set({ search }),
      setActiveTaskId: (id) => set({ activeTaskId: id }),

      // task index management
      setTaskIndex: (tasks) =>
        set({
          taskIndex: tasks.map((t) => ({
            id: t.id,
            status: t.status,
            prompt: t.prompt,
            modelId: t.modelId,
            createdAt: t.createdAt
          }))
        }),
      addTaskToIndex: (task) =>
        set((s) => ({
          taskIndex: [
            {
              id: task.id,
              status: task.status,
              prompt: task.prompt,
              modelId: task.modelId,
              createdAt: task.createdAt
            },
            ...s.taskIndex.filter((t) => t.id !== task.id)
          ]
        })),
      updateTaskInIndex: (id, patch) =>
        set((s) => ({
          taskIndex: s.taskIndex.map((t) => (t.id === id ? { ...t, ...patch } : t))
        })),
      removeTaskFromIndex: (id) =>
        set((s) => ({
          taskIndex: s.taskIndex.filter((t) => t.id !== id),
          activeTaskId: s.activeTaskId === id ? null : s.activeTaskId
        })),

      // reuse: apply a task's prompt/params/refs back into composer
      reuseTaskConfig: ({ prompt, params, sizePreset }) => {
        const updates = {}
        if (typeof prompt === 'string') updates.prompt = prompt
        if (params) updates.params = { ...DEFAULT_PARAMS, ...params }
        if (sizePreset) updates.sizePreset = { ...DEFAULT_PRESET, ...sizePreset }
        set(updates)
      },

      resetComposer: () =>
        set({
          prompt: '',
          params: { ...DEFAULT_PARAMS },
          sizePreset: { ...DEFAULT_PRESET },
          refs: []
        })
    }),
    {
      name: 'chatty-image-ui',
      storage: createJSONStorage(() => accountStorage('chatty-image-ui')),
      skipHydration: true,
      partialize: (state) => ({
        prompt: state.prompt,
        modelId: state.modelId,
        params: state.params,
        sizePreset: state.sizePreset,
        filter: state.filter,
        search: state.search
      })
    }
  )
)

export function newTaskId() {
  return uid('img')
}

export { DEFAULT_PARAMS, DEFAULT_PRESET }
