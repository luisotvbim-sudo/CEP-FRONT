import { afterEach, describe, expect, it, vi } from 'vitest'
import { callBridge, disposeBridge, type WebViewBridge } from './bridge-transport'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shared bridge transport', () => {
  it('attaches the document identity to auth and power envelopes without replacing call correlation', async () => {
    const documentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    vi.stubGlobal('window', { __CEP_DOCUMENT_ID__: documentId })
    type Listener = Parameters<WebViewBridge['addEventListener']>[1]
    const listeners = new Set<Listener>()
    const sent: { id: string; documentId: string }[] = []
    const bridge: WebViewBridge = {
      postMessage: (message) => {
        sent.push(message as (typeof sent)[number])
      },
      addEventListener: (_, listener) => {
        listeners.add(listener)
      },
      removeEventListener: (_, listener) => {
        listeners.delete(listener)
      },
    }
    const auth = callBridge(bridge, 'cep-auth', 'restore', {}, 45_000)
    const power = callBridge(bridge, 'cep-power', 'cancel', {}, 12_000)
    expect(sent.map((message) => message.documentId)).toEqual([documentId, documentId])
    expect(sent[0].id).not.toBe(sent[1].id)
    for (const message of sent)
      for (const listener of [...listeners])
        listener({ data: { id: message.id, ok: true, result: null } })
    await Promise.all([auth, power])
    expect(listeners.size).toBe(0)
  })
  it('multiplexes auth/power with one listener and disposes all pending calls without replay', async () => {
    vi.useFakeTimers()
    type Listener = Parameters<WebViewBridge['addEventListener']>[1]
    const listeners = new Set<Listener>()
    const sent: { id: string; type: string }[] = []
    const bridge: WebViewBridge = {
      postMessage: (message) => {
        sent.push(message as (typeof sent)[number])
      },
      addEventListener: (_, listener) => {
        listeners.add(listener)
      },
      removeEventListener: (_, listener) => {
        listeners.delete(listener)
      },
    }
    const auth = callBridge(bridge, 'cep-auth', 'restore', {}, 45_000)
    const power = callBridge(bridge, 'cep-power', 'cancel', {}, 12_000)
    expect(listeners.size).toBe(1)
    for (const listener of [...listeners])
      listener({ data: { id: sent[1].id, ok: true, result: { cancelled: true } } })
    expect(await power).toEqual({ cancelled: true })
    expect(listeners.size).toBe(1)
    const rejected = expect(auth).rejects.toMatchObject({ kind: 'unavailable' })
    disposeBridge(bridge)
    await rejected
    expect(listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(sent).toHaveLength(2)
    const retry = callBridge(bridge, 'cep-auth', 'restore', {}, 45_000)
    for (const listener of [...listeners])
      listener({ data: { id: sent[2].id, ok: true, result: null } })
    expect(await retry).toBeNull()
    expect(listeners.size).toBe(0)
  })
})
