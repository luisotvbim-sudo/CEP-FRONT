import { describe, expect, it, vi } from 'vitest'
import type { AuthClient } from '../auth/auth-client'
import { NotificationApi } from './api'

describe('notification scoping and command safety', () => {
  const make = () => {
    const request = vi.fn().mockResolvedValue({})
    return {
      request,
      api: new NotificationApi({ request } as unknown as AuthClient, 'org-selected'),
    }
  }
  it('never scopes global settings or schedules to the selected organization', async () => {
    const { request, api } = make()
    await api.saveSettings({ toleranceMinutes: 30, automaticEnabled: false, version: 'version-1' })
    expect(request).toHaveBeenCalledWith('PATCH', '/time-control/settings', {
      toleranceMinutes: 30,
      automaticEnabled: false,
      version: 'version-1',
    })
    await api.deleteSchedule({
      id: 'schedule-id',
      version: 'old-version',
      localTime: '10:00:00',
      kind: 'previousDay',
      message: 'Teste',
      isEnabled: true,
    })
    expect(request).toHaveBeenLastCalledWith(
      'DELETE',
      '/time-control/notification-schedules/schedule-id?version=old-version',
    )
  })
  it('scopes dispatch preview and submission, retaining the caller idempotency key', async () => {
    const { request, api } = make()
    await api.preview('sprint', '')
    expect(request).toHaveBeenLastCalledWith(
      'GET',
      '/organization/time-control/notification-dispatches/preview?period=sprint&organizationId=org-selected',
    )
    const body = {
      userId: null,
      period: 'sprint' as const,
      message: 'Revise suas horas',
      requestId: 'same-key',
    }
    await api.send(body)
    await api.send(body)
    expect(request).toHaveBeenLastCalledWith(
      'POST',
      '/organization/time-control/notification-dispatches?organizationId=org-selected',
      body,
    )
  })
  it('always reads the authenticated personal inbox, without organization override', async () => {
    const { request, api } = make()
    await api.inbox(2, true)
    expect(request).toHaveBeenLastCalledWith(
      'GET',
      '/me/notifications?page=2&pageSize=20&unreadOnly=true',
    )
    await api.read('notification-id')
    expect(request).toHaveBeenLastCalledWith('POST', '/me/notifications/notification-id/read', {})
  })
})
