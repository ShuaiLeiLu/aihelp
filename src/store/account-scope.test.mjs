import test from 'node:test'
import assert from 'node:assert/strict'
import { getAccountStorageKey, useChatStore } from './useStore.js'

function installLocalStorage() {
  const values = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    }
  }
}

test('account storage keys keep persisted state separate for each user', () => {
  assert.equal(getAccountStorageKey('chatty-storage', 'user-a'), 'chatty-storage:user:user-a')
  assert.notEqual(
    getAccountStorageKey('chatty-storage', 'user-a'),
    getAccountStorageKey('chatty-storage', 'user-b')
  )
})

test('switching account scopes never exposes another account chat history', () => {
  installLocalStorage()
  useChatStore.getState().clearAccountData()
  useChatStore.getState().setAccountScope('user-a')
  useChatStore.getState().addConversation({ id: 'conv-a', title: 'private A' })

  useChatStore.getState().setAccountScope('user-b')
  assert.deepEqual(useChatStore.getState().conversations, [])

  useChatStore.getState().setAccountScope('user-a')
  assert.equal(useChatStore.getState().conversations[0].title, 'private A')

  useChatStore.getState().clearAccountData()
  useChatStore.getState().setAccountScope('user-a')
  assert.deepEqual(useChatStore.getState().conversations, [])
})
