'use client'

import { logout } from '@/lib/api'
import { clearAllTasks, cleanOrphanImages } from '@/lib/image/db'
import { useAuthStore, useChatStore } from '@/store/useStore'
import { useImageStore } from '@/store/useImageStore'

// Shared logout path: clear in-memory and persisted account state first so no
// UI can render another account's data, then end the server session and wipe
// local image data. Local IndexedDB cleanup failures must not block logout.
export async function performLogoutCleanup() {
  useChatStore.getState().clearAccountData()
  useImageStore.getState().clearAccountData()
  useAuthStore.getState().clearSession()
  await logout().catch(() => null)
  try {
    await clearAllTasks()
    await cleanOrphanImages()
  } catch (err) {
    console.warn('[auth] clear local image data failed', err)
  }
}
