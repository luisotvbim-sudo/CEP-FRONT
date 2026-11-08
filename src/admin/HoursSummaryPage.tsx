import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import type { AuthClient } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { useAction, useQuery } from '../hooks/async'
import { daysBeforeToday, today, validatePeriod } from './format'
import { getHoursSummary, getTeamHoursSummary, type HoursReportData } from './hours-api'
import { AdminApi } from './api'
import { HoursReport } from './HoursReport'
import { Loading, PageHeading, QueryError } from './ui'
import './hours-summary.css'

const initialDates = () => ({ from: daysBeforeToday(6), to: today() })

export function HoursSummaryPage({
  client,
  organizationId,
  teamId,
}: {
  client: AuthClient
  organizationId?: string
  teamId?: string
}) {
  const api = useMemo(() => new AdminApi(client, organizationId), [client, organizationId])
  const [period, setPeriod] = useState(initialDates)
  const [draft, setDraft] = useState(period)
  const [validation, setValidation] = useState('')
  const result = useQuery<HoursReportData>(
    () =>
      teamId
        ? getTeamHoursSummary(client, teamId, period.from, period.to)
        : getHoursSummary(client, period.from, period.to, organizationId),
    [client, organizationId, teamId, period.from, period.to],
  )
  const action = useAction()
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error =
      validatePeriod(draft.from, draft.to) ??
      (draft.to > today() ? 'A data final não pode ser futura.' : '')
    setValidation(error)
    if (error) return
    if (draft.from === period.from && draft.to === period.to) result.reload()
    else setPeriod(draft)
  }
  const exportableReport =
    !result.pending && !result.error && draft.from === period.from && draft.to === period.to
      ? result.data
      : undefined
  function exportReport() {
    if (!exportableReport?.people.length) return
    void action.run(async () => {
      const { downloadHoursWorkbook } = await import('./hours-excel')
      await downloadHoursWorkbook(exportableReport, () => mounted.current)
    })
  }
  return (
    <>
      <PageHeading
        level={teamId ? 'h2' : 'h1'}
        title={teamId ? 'Resumo do time' : 'Resumo de horas'}
        description={
          teamId
            ? 'Consulte as horas importadas do Monday e do VR Mais para o time selecionado.'
            : 'Compare os registros importados do Monday e do VR Mais por pessoa, time ou organização.'
        }
        action={
          <button
            className="primary-button compact"
            type="button"
            onClick={exportReport}
            disabled={!exportableReport?.people.length || action.pending}
          >
            <Download size={17} aria-hidden="true" />
            {action.pending ? 'Gerando Excel…' : 'Exportar Excel'}
          </button>
        }
      />
      <form className="admin-panel hours-period" onSubmit={apply}>
        <label>
          De
          <input
            type="date"
            value={draft.from}
            max={today()}
            required
            disabled={action.pending}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={draft.to}
            max={today()}
            required
            disabled={action.pending}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <button className="secondary-button" type="submit" disabled={action.pending}>
          Consultar período
        </button>
        {validation && <p role="alert">{validation}</p>}
      </form>
      <FormNotice error={action.error} />
      <QueryError error={result.error} retry={result.reload} />
      {result.pending && <Loading text="Consultando registros importados…" />}
      {result.data && (!teamId || !result.error) && (
        <HoursReport key={`${teamId}/${period.from}/${period.to}`} report={result.data} api={api} />
      )}
    </>
  )
}
