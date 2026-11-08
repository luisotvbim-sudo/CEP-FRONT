import { organizationPath, query } from '../api/query'
import type { AuthClient } from '../auth/auth-client'
import type { components } from '../auth/api-schema'

export type HoursTotals = components['schemas']['HoursTotals']
export type HoursSummary = components['schemas']['HoursSummaryResponse']
export type HoursTeamSummary = components['schemas']['HoursTeamSummaryResponse']
export type HoursReportData = HoursSummary | HoursTeamSummary

export const getHoursSummary = (
  client: AuthClient,
  from: string,
  to: string,
  organizationId?: string,
) =>
  client.request<HoursSummary>(
    'GET',
    organizationPath(
      `/organization/time-control/hours-summary${query({ from, to })}`,
      organizationId,
    ),
  )

export function getTeamHoursSummary(client: AuthClient, teamId: string, from: string, to: string) {
  return client.request<HoursTeamSummary>(
    'GET',
    `/organization/time-control/teams/${encodeURIComponent(teamId)}/hours-summary${query({ from, to })}`,
  )
}
