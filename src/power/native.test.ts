import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativePowerBridge, NativePowerUncertain } from './native'
import type { WebViewBridge } from '../auth/bridge-transport'

function fixture() {
  type Listener = Parameters<WebViewBridge['addEventListener']>[1]
  const listeners = new Set<Listener>()
  const messages: {
    id: string
    operation: string
    payload: { requestId: string; action: string }
  }[] = []
  const bridge: WebViewBridge = {
    postMessage: (message) => {
      messages.push(message as (typeof messages)[number])
    },
    addEventListener: (_, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_, listener) => {
      listeners.delete(listener)
    },
  }
  return {
    messages,
    listeners,
    host: new NativePowerBridge(bridge),
    reply: (index: number, result: unknown) => {
      for (const listener of [...listeners])
        listener({ data: { id: messages[index].id, ok: true, result } })
    },
    fail: (index: number, requestId: string) => {
      for (const listener of [...listeners])
        listener({
          data: {
            id: messages[index].id,
            ok: false,
            error: { code: 'native_power_uncertain', requestId },
          },
        })
    },
    failCode: (index: number, code: string) => {
      for (const listener of [...listeners])
        listener({
          data: {
            id: messages[index].id,
            ok: false,
            error: { code, message: 'private fixture payload' },
          },
        })
    },
  }
}
afterEach(() => vi.useRealTimers())

describe('native power deadlines and reconciliation', () => {
  it.each([
    'power_service_unavailable',
    'power_service_timeout',
    'power_service_invalid_response',
    'update_maintenance',
    'access_denied',
    'service_error',
  ])('preserves native error %s without exposing raw payload', async (code) => {
    const f = fixture()
    const operation = f.host.cancel(crypto.randomUUID())
    const assertion = expect(operation).rejects.toMatchObject({ code })
    f.failCode(0, code)
    await assertion
    await expect(operation).rejects.not.toThrow('private fixture payload')
    expect(f.messages).toHaveLength(1)
    expect(f.listeners.size).toBe(0)
  })
  it('retains the existing host request ID and requires explicit cancellation instead of canceling it during a new schedule', async () => {
    const f = fixture()
    const existingId = crypto.randomUUID()
    const pending = f.host.schedule('shutdown', { kind: 'api-unreachable' })
    const assertion = expect(pending).rejects.toMatchObject({
      requestId: existingId,
      code: 'native_power_uncertain',
    })
    f.fail(0, existingId)
    await assertion
    expect(f.messages.map((message) => message.operation)).toEqual(['schedule'])
    const cancelled = f.host.cancel(existingId)
    expect(f.messages[1].payload.requestId).toBe(existingId)
    f.reply(1, { cancelled: true })
    await cancelled
    expect(f.listeners.size).toBe(0)
  })
  it('waits for host revalidation beyond five seconds and only starts countdown after confirmation', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const pending = f.host.schedule('shutdown', { kind: 'api-unreachable' })
    await vi.advanceTimersByTimeAsync(25_000)
    expect(f.messages.map((message) => message.operation)).toEqual(['schedule'])
    f.reply(0, {
      requestId: f.messages[0].payload.requestId,
      action: 'shutdown',
      executeAt: new Date(Date.now() + 10_000).toISOString(),
    })
    expect((await pending).requestId).toBe(f.messages[0].payload.requestId)
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds the full schedule, cancels the exact ID, and ignores the late schedule reply', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const pending = f.host.schedule('restart', { kind: 'api-unreachable' })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'native_power_timeout' })
    await vi.advanceTimersByTimeAsync(80_000)
    expect(f.messages.map((message) => message.operation)).toEqual(['schedule', 'cancel'])
    expect(f.messages[1].payload.requestId).toBe(f.messages[0].payload.requestId)
    f.reply(0, {
      requestId: f.messages[0].payload.requestId,
      action: 'restart',
      executeAt: new Date(Date.now() + 10_000).toISOString(),
    })
    f.reply(1, { cancelled: true })
    await assertion
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains cancellation uncertainty after both finite operation budgets expire', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const pending = f.host.schedule('hibernate', { kind: 'api-unreachable' })
    const assertion = expect(pending).rejects.toBeInstanceOf(NativePowerUncertain)
    await vi.advanceTimersByTimeAsync(92_000)
    await assertion
    expect(f.messages).toHaveLength(2)
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not confuse bridge probe timeout with API unreachability', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const assertion = expect(f.host.verifyApiUnreachable()).rejects.toMatchObject({
      code: 'native_power_timeout',
    })
    await vi.advanceTimersByTimeAsync(7_000)
    await assertion
    expect(f.messages).toHaveLength(1)
    expect(f.listeners.size).toBe(0)
  })
  it('accepts terminal state only for the requested ID, never a truthy or unrelated result', async () => {
    for (const result of [
      null,
      { requestId: 'other', state: 'terminal' },
      { requestId: 'fixture', state: true },
    ]) {
      const f = fixture()
      const assertion = expect(f.host.reconcile('fixture')).rejects.toBeInstanceOf(
        NativePowerUncertain,
      )
      f.reply(0, result)
      await assertion
    }
    const f = fixture()
    const pending = f.host.reconcile('fixture')
    f.reply(0, { requestId: 'fixture', state: 'terminal' })
    expect(await pending).toEqual({ requestId: 'fixture', state: 'terminal' })
  })
})
