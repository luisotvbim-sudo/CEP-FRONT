import type { Overview, OverviewPeriod, OverviewStatus } from '../../src/user/overview-api'

export function personalOverview(
  status: OverviewStatus = 'regular',
  period: OverviewPeriod = 'daily',
): Overview {
  const cutoff = '2026-09-21T15:00:00Z'
  const from =
    period === 'sprint' ? '2026-09-15' : period === 'previousDay' ? '2026-09-20' : '2026-09-21'
  const to = period === 'previousDay' ? '2026-09-20' : '2026-09-21'
  const delta = status === 'difference' ? -2000 : status === 'incomplete' ? null : 0
  const issues =
    status === 'difference' ? ['above_tolerance'] : status === 'incomplete' ? ['incomplete'] : []
  const days = [
    {
      day: from,
      vrSeconds: status === 'incomplete' ? null : 7200,
      mondaySeconds: status === 'incomplete' ? null : delta === null ? 7200 : 7200 + delta,
      deltaSeconds: delta,
      partial: period !== 'previousDay',
      issues,
    },
  ]
  const noPerson = status === 'notAssociated' || status === 'inactiveIdentity'
  return {
    period,
    cutoff,
    status,
    periods: [
      { period: 'daily', from: '2026-09-21', to: '2026-09-21' },
      { period: 'weekly', from: '2026-09-21', to: '2026-09-21' },
      { period: 'sprint', from: '2026-09-15', to: '2026-09-21' },
      { period: 'previousDay', from: '2026-09-20', to: '2026-09-20' },
    ],
    analysis: noPerson
      ? null
      : {
          from,
          to,
          cutoff,
          toleranceMinutes: 30,
          days,
          vrSeconds: days[0].vrSeconds,
          mondaySeconds: days[0].mondaySeconds,
          deltaSeconds: delta,
          absoluteDivergenceSeconds: delta === null ? null : Math.abs(delta),
          hasIssues: issues.length > 0,
          settingsVersion: '00000000-0000-0000-0000-000000000001',
          sources: [
            { source: 'monday', status: 'complete', observedAt: cutoff, errorCode: null },
            {
              source: 'vrMais',
              status: status === 'incomplete' ? 'incomplete' : 'complete',
              observedAt: cutoff,
              errorCode: null,
            },
          ],
        },
    attentionDays:
      !noPerson && issues.length
        ? [{ day: from, status, partial: period !== 'previousDay', issues }]
        : [],
    availableSourceDays: noPerson
      ? []
      : [{ day: from, vrSeconds: status === 'incomplete' ? null : 7200, mondaySeconds: 7200 }],
  }
}
