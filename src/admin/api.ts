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
  constructor(private readonly client: AuthClient) {}
  people(search = '', page = 1) {
    return this.client.request<Paged<Person>>(
      'GET',
      `${root}/people${query({ search, page, pageSize: 12 })}`,
    )
  }
  invitations() {
    return this.client.request<Invitation[]>('GET', '/organization/invitations')
  }
  identities(source: Source, search = '', page = 1) {
    return this.client.request<Paged<Identity>>(
      'GET',
      `${root}/external-identities${query({ source, search, page, pageSize: 8, activeOnly: true, mapped: false })}`,
    )
  }
  invite(body: Schema['InviteWorkforcePersonRequest']) {
    return this.client.request<Schema['InviteWorkforcePersonResponse']>(
      'POST',
      `${root}/people/invitations`,
      body,
    )
  }
  latest() {
    return this.client.request<Sync>('GET', `${root}/synchronizations/latest`)
  }
  syncStatus(id: string) {
    return this.client.request<Sync>('GET', `${root}/synchronizations/${encodeURIComponent(id)}`)
  }
  synchronize(full: boolean) {
    return this.client.request<Sync>('POST', `${root}/synchronizations${query({ full })}`)
  }
  teams(includeInactive: boolean, asOf: string) {
    return this.client.request<Team[]>('GET', `${root}/teams${query({ includeInactive, asOf })}`)
  }
  createTeam(name: string) {
    return this.client.request<Team>('POST', `${root}/teams`, { name })
  }
  updateTeam(id: string, name: string, isActive: boolean) {
    return this.client.request<Team>('PATCH', `${root}/teams/${encodeURIComponent(id)}`, {
      name,
      isActive,
    })
  }
  assignments(teamId: string, includeHistory: boolean, asOf: string) {
    return this.client.request<Assignment[]>(
      'GET',
      `${root}/teams/${encodeURIComponent(teamId)}/assignments${query({ includeHistory, asOf })}`,
    )
  }
  users(search: string, page = 1) {
    return this.client.request<Paged<User>>(
      'GET',
      `/organization/users${query({ search, page, pageSize: 12, status: 'active' })}`,
    )
  }
  assign(teamId: string, body: Schema['CreateTeamAssignmentRequest']) {
    return this.client.request<Assignment>(
      'POST',
      `${root}/teams/${encodeURIComponent(teamId)}/assignments`,
      body,
    )
  }
  endAssignment(teamId: string, id: string, effectiveTo: string) {
    return this.client.request<Assignment>(
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
    return this.client.request<History>('GET', `${root}/history${query(input)}`)
  }
}
