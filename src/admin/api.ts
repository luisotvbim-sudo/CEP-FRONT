import type { components } from '../auth/api-schema'
import type { AuthClient } from '../auth/auth-client'

type Schema = components['schemas']
export type Person = Schema['WorkforcePersonResponse']
export type Identity = Schema['ExternalWorkforceIdentityResponse']
export type Source = Schema['ExternalWorkforceSource']
export type Sync = Schema['WorkforceSyncResponse']
export type Team = Schema['WorkforceTeamResponse']
export type Assignment = Schema['TeamAssignmentResponse']
export type TimeRecord = Schema['WorkforceTimeRecordResponse']
export type Invitation = Schema['InvitationResponse']
export type User = Schema['UserResponse']
export type AuditEvent = Schema['AuditEventResponse']
export type Paged<T> = { items?: T[] | null; total?: number; page?: number; pageSize?: number }
export type History = Schema['WorkforceAdminHistoryResponse']

const root = '/organization/time-control'
function query(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.size ? `?${params}` : ''
}
export class AdminApi {
  constructor(
    private readonly client: AuthClient,
    private readonly organizationId?: string,
  ) {}
  private request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object): Promise<T> {
    const scoped = this.organizationId
      ? `${path}${path.includes('?') ? '&' : '?'}organizationId=${encodeURIComponent(this.organizationId)}`
      : path
    return this.client.request<T>(method, scoped, body)
  }
  people(search = '', page = 1, pageSize = 12) {
    return this.request<Paged<Person>>(
      'GET',
      `${root}/people${query({ search, page, pageSize })}`,
    )
  }
  async visiblePeople() {
    const pageSize = 100
    const first = await this.people('', 1, pageSize)
    const pages = Math.ceil((first.total ?? first.items?.length ?? 0) / pageSize)
    const rest = pages > 1
      ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => this.people('', i + 2, pageSize)))
      : []
    return [first, ...rest].flatMap((result) => result.items ?? [])
  }
  invitations() {
    return this.request<Invitation[]>('GET', '/organization/invitations')
  }
  resendInvitation(id: string) {
    return this.request<void>('POST', `/organization/invitations/${encodeURIComponent(id)}/resend`)
  }
  identities(source: Source, search = '', page = 1) {
    return this.request<Paged<Identity>>(
      'GET',
      `${root}/external-identities${query({ source, search, page, pageSize: 8, activeOnly: true, mapped: false })}`,
    )
  }
  invite(body: Schema['InviteWorkforcePersonRequest']) {
    return this.request<Schema['InviteWorkforcePersonResponse']>(
      'POST',
      `${root}/people/invitations`,
      body,
    )
  }
  latest() {
    return this.request<Sync>('GET', `${root}/synchronizations/latest`)
  }
  syncStatus(id: string) {
    return this.request<Sync>('GET', `${root}/synchronizations/${encodeURIComponent(id)}`)
  }
  synchronize(full: boolean) {
    return this.request<Sync>('POST', `${root}/synchronizations${query({ full })}`)
  }
  teams(includeInactive: boolean, asOf: string) {
    return this.request<Team[]>('GET', `${root}/teams${query({ includeInactive, asOf })}`)
  }
  createTeam(name: string) {
    return this.request<Team>('POST', `${root}/teams`, { name })
  }
  updateTeam(id: string, name: string, isActive: boolean) {
    return this.request<Team>('PATCH', `${root}/teams/${encodeURIComponent(id)}`, {
      name,
      isActive,
    })
  }
  assignments(teamId: string, includeHistory: boolean, asOf: string) {
    return this.request<Assignment[]>(
      'GET',
      `${root}/teams/${encodeURIComponent(teamId)}/assignments${query({ includeHistory, asOf })}`,
    )
  }
  users(search: string, page = 1) {
    return this.request<Paged<User>>(
      'GET',
      `/organization/users${query({ search, page, pageSize: 12, status: 'active' })}`,
    )
  }
  organizationUsers(search = '', status?: Schema['UserStatus'], page = 1) {
    return this.request<Paged<User>>('GET', `/organization/users${query({ search, status, page, pageSize: 20 })}`)
  }
  updateUser(id: string, body: Schema['UpdateUserRequest']) {
    return this.request<User>('PATCH', `/organization/users/${encodeURIComponent(id)}`, body)
  }
  inviteUser(body: Schema['InviteUserRequest']) {
    return this.request<Invitation>('POST', '/organization/invitations', body)
  }
  audit(before?: string) {
    return this.request<AuditEvent[]>('GET', `/organization/audit${query({ before, pageSize: 50 })}`)
  }
  assign(teamId: string, body: Schema['CreateTeamAssignmentRequest']) {
    return this.request<Assignment>(
      'POST',
      `${root}/teams/${encodeURIComponent(teamId)}/assignments`,
      body,
    )
  }
  endAssignment(teamId: string, id: string, effectiveTo: string) {
    return this.request<Assignment>(
      'PATCH',
      `${root}/teams/${encodeURIComponent(teamId)}/assignments/${encodeURIComponent(id)}/end`,
      { effectiveTo },
    )
  }
  history(input: {
    from: string
    to: string
    workforcePersonId?: string
    source?: Source
    search?: string
  }) {
    return this.request<History>('GET', `${root}/history${query(input)}`)
  }
}
