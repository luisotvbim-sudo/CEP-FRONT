import type { components } from '../auth/api-schema'
import type { AuthClient } from '../auth/auth-client'
import type { Paged } from '../admin/api'

type Schema = components['schemas']
export type Period = Schema['AnalysisPeriod']
export const periodLabels: Record<Period, string> = {
  daily: 'Diário',
  weekly: 'Semanal',
  sprint: 'Sprint',
  previousDay: 'Dia anterior',
}
export type Settings = Required<Schema['TimeSettingsResponse']>
export type Schedule = Required<Schema['TimeScheduleResponse']>
export const kindLabels = {
  previousDay: 'Pendências de ontem',
  lunch: 'Conferência antes do almoço',
  endOfDay: 'Conferência antes de encerrar',
}
export type ScheduleInput = Schema['TimeScheduleRequest']
export type Dispatch = Required<Schema['TimeDispatchResponse']>
export type Analysis = Schema['TimeAnalysisResponse']
export type Notification = Required<Schema['TimeNotificationResponse']>
export type Report = Required<Schema['TimeReportResponse']>
export class NotificationApi {
  constructor(
    private readonly client: AuthClient,
    private readonly organizationId?: string,
  ) {}
  private scoped(path: string) {
    return this.organizationId
      ? `${path}${path.includes('?') ? '&' : '?'}organizationId=${encodeURIComponent(this.organizationId)}`
      : path
  }
  settings() {
    return this.client.request<Settings>('GET', '/time-control/settings')
  }
  saveSettings(input: Pick<Settings, 'version' | 'toleranceMinutes' | 'automaticEnabled'>) {
    return this.client.request<Settings>('PATCH', '/time-control/settings', input)
  }
  schedules() {
    return this.client.request<Schedule[]>('GET', '/time-control/notification-schedules')
  }
  saveSchedule(input: ScheduleInput, id?: string) {
    return this.client.request<Schedule>(
      id ? 'PATCH' : 'POST',
      `/time-control/notification-schedules${id ? `/${encodeURIComponent(id)}` : ''}`,
      input,
    )
  }
  deleteSchedule(row: Schedule) {
    return this.client.request<void>(
      'DELETE',
      `/time-control/notification-schedules/${encodeURIComponent(row.id)}?version=${encodeURIComponent(row.version)}`,
    )
  }
  send(input: { userId: string | null; message: string; period: Period; requestId: string }) {
    return this.client.request<Dispatch>(
      'POST',
      this.scoped('/organization/time-control/notification-dispatches'),
      input,
    )
  }
  preview(period: Period, userId: string) {
    return this.client.request<Required<Schema['TimeDispatchPreviewResponse']>>(
      'GET',
      this.scoped(
        `/organization/time-control/notification-dispatches/preview?period=${period}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`,
      ),
    )
  }
  dispatches(page: number) {
    return this.client.request<Paged<Dispatch>>(
      'GET',
      this.scoped(`/organization/time-control/notification-dispatches?page=${page}&pageSize=20`),
    )
  }
  inbox(page: number, unreadOnly: boolean) {
    return this.client.request<Paged<Notification>>(
      'GET',
      `/me/notifications?page=${page}&pageSize=20&unreadOnly=${unreadOnly}`,
    )
  }
  read(id: string) {
    return this.client.request<void>('POST', `/me/notifications/${encodeURIComponent(id)}/read`, {})
  }
  reports(period: Period, page: number, workforcePersonId?: string, day?: string, issue?: string) {
    const query = new URLSearchParams({ period, page: String(page), pageSize: '20' })
    if (workforcePersonId) query.set('workforcePersonId', workforcePersonId)
    if (day) query.set('day', day)
    if (issue) query.set('issue', issue)
    return this.client.request<Paged<Report>>(
      'GET',
      this.scoped(`/organization/time-control/analyses?${query}`),
    )
  }
}
