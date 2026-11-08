import { organizationPath, query } from '../api/query'
import type { AuthClient } from '../auth/auth-client'
import type { components } from '../auth/api-schema'

export type HoursTotals = components['schemas']['HoursTotals']
export type HoursSummary = components['schemas']['HoursSummaryResponse']

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
