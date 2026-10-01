import { describe, expect, it, vi } from 'vitest'
import { AuthError, type AuthClient } from '../auth/auth-client'
import { parsePowerCheck, PowerApi } from './api'
import { mayVerifyOffline, NativePowerBridge, NativePowerUncertain } from './native'
import type { WebViewBridge } from '../auth/desktop-auth-client'

const analysis = {
  from: '2026-09-30',
  to: '2026-09-30',
  cutoff: '2026-09-30T20:00:00Z',
  toleranceMinutes: 30,
  settingsVersion: 'aaaaaaaa-0000-0000-0000-000000000001',
  days: [
    {
      day: '2026-09-30',
      vrSeconds: 3600,
      mondaySeconds: 1800,
      deltaSeconds: -1800,
      partial: true,
      issues: [],
    },
  ],
  vrSeconds: 3600,
  mondaySeconds: 1800,
  deltaSeconds: -1800,
  absoluteDivergenceSeconds: 1800,
  hasIssues: false,
  sources: ['monday', 'vrMais'].map((source) => ({
    source,
    status: 'complete',
    errorCode: null,
    observedAt: '2026-09-30T20:00:00Z',
  })),
}
const allowed = {
  action: 'shutdown',
  decision: 'allowed',
  code: 'within_tolerance',
  message: 'Liberado.',
  analysis,
}

describe('power contract', () => {
  it('preserves the server decision at the exact tolerance and partial day', () => {
    expect(parsePowerCheck(allowed, 'shutdown')).toEqual(allowed)
    expect(
      parsePowerCheck({ ...allowed, decision: 'blocked', code: 'above_tolerance' }, 'shutdown')
        .decision,
    ).toBe('blocked')
    expect(
      parsePowerCheck(
        {
          ...allowed,
          decision: 'indeterminate',
          code: 'workforce_person_not_associated',
          analysis: null,
        },
        'shutdown',
      ).analysis,
    ).toBeNull()
  })
  it.each([
    null,
    {},
    { ...allowed, action: 'restart' },
    { ...allowed, decision: 'ok' },
    { ...allowed, decision: 'allowed', code: 'above_tolerance' },
    { ...allowed, analysis: null },
    { ...allowed, analysis: { ...analysis, deltaSeconds: undefined } },
  ])('refuses invalid response %#', (value) => {
    expect(() => parsePowerCheck(value, 'shutdown')).toThrow(AuthError)
  })
  it('uses only the authenticated own-person routes and forwards the selected action', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...allowed, action: 'hibernate' })
      .mockResolvedValueOnce(allowed)
    const api = new PowerApi({ request } as unknown as AuthClient)
    await api.check('hibernate')
    await api.status()
    expect(request.mock.calls).toEqual([
      ['POST', '/me/time-control/power-action-check', { action: 'hibernate' }],
      ['GET', '/me/time-control/power-action-status?action=shutdown'],
    ])
  })
  it.each([400, 401, 403, 429, 500])(
    'does not treat HTTP %i as offline even with transport code',
    (status) => {
      expect(mayVerifyOffline(new AuthError('error', undefined, 'connection_failed', status))).toBe(
        false,
      )
    },
  )
  it('only permits native verification for explicit transport failures', () => {
    expect(mayVerifyOffline(new AuthError('offline', undefined, 'connection_failed'))).toBe(true)
    for (const code of [
      'invalid_power_response',
      'above_tolerance',
      'analysis_incomplete',
      'desktop_request_failed',
      'native_power_timeout',
    ])
      expect(mayVerifyOffline(new AuthError('error', undefined, code))).toBe(false)
    expect(mayVerifyOffline(new TypeError('Failed to fetch'))).toBe(false)
  })
})

function nativeFixture(reply: (message: any) => unknown) {
  const listeners = new Set<Parameters<WebViewBridge['addEventListener']>[1]>()
  const messages: any[] = []
  const bridge: WebViewBridge = {
    addEventListener: (_, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_, listener) => {
      listeners.delete(listener)
    },
    postMessage: (message) => {
      messages.push(message)
      const m = message as any
      const result = reply(m)
      queueMicrotask(() =>
        listeners.forEach((listener) => listener({ data: { id: m.id, ok: true, result } })),
      )
    },
  }
  return { host: new NativePowerBridge(bridge), messages, listeners }
}

describe('native power adapter', () => {
  it('schedules ten seconds in the native host, then aborts the same ID', async () => {
    const f = nativeFixture((m) =>
      m.operation === 'schedule'
        ? {
            requestId: m.payload.requestId,
            action: m.payload.action,
            executeAt: new Date(Date.now() + 10_000).toISOString(),
          }
        : { cancelled: true },
    )
    const job = await f.host.schedule('shutdown', {
      kind: 'api',
      check: parsePowerCheck(allowed, 'shutdown'),
    })
    await f.host.cancel(job.requestId)
    expect(f.messages.map((m) => m.operation)).toEqual(['schedule', 'cancel'])
    expect(f.messages[0]).toMatchObject({
      type: 'cep-power',
      payload: { delaySeconds: 10, action: 'shutdown', authorization: { kind: 'api' } },
    })
    expect(f.messages[1].payload).toEqual({ requestId: job.requestId })
    expect(f.listeners.size).toBe(0)
  })
  it('does not accept generic truthy replies as verified offline or cancellation', async () => {
    const f = nativeFixture(() => ({ unreachable: 'true', cancelled: false }))
    expect(await f.host.verifyApiUnreachable()).toBe(false)
    await expect(f.host.cancel('job')).rejects.toThrow('cancelamento não foi confirmado')
  })
  it('aborts malformed native schedules without manufacturing a countdown', async () => {
    const f = nativeFixture((m) =>
      m.operation === 'schedule' ? { executeAt: new Date().toISOString() } : { cancelled: true },
    )
    await expect(f.host.schedule('restart', { kind: 'api-unreachable' })).rejects.toThrow(
      'agendamento inválido',
    )
    expect(f.messages.map((m) => m.operation)).toEqual(['schedule', 'cancel'])
  })
  it('retains an ID for retrying cancellation when scheduling is uncertain', async () => {
    const f = nativeFixture(() => null)
    await expect(f.host.schedule('hibernate', { kind: 'api-unreachable' })).rejects.toBeInstanceOf(
      NativePowerUncertain,
    )
    expect(f.messages[0].payload.requestId).toBe(f.messages[1].payload.requestId)
  })
})
