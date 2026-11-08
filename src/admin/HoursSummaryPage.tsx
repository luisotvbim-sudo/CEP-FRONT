import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import type { AuthClient } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { useAction, useQuery } from '../hooks/async'
import { issueLabels } from '../notifications/labels'
import { date, daysBeforeToday, duration, timestamp, today, validatePeriod } from './format'
import {
  getHoursSummary,
  getTeamHoursSummary,
  type HoursSummary,
  type HoursTotals,
} from './hours-api'
import { AdminApi } from './api'
import { DailyHistory } from './DailyHistory'
import { HoursCharts } from './HoursCharts'
import { Empty, Loading, PageHeading, QueryError } from './ui'
import './hours-summary.css'

type View = 'organization' | 'teams' | 'people'
const views = { organization: 'Organização', teams: 'Times', people: 'Pessoas' } as const
const initialDates = () => ({ from: daysBeforeToday(6), to: today() })
type Row = { id: string; name: string; totals: HoursTotals }

function TotalsTable({
  rows,
  label,
  onSelect,
  selected,
}: {
  rows: Row[]
  label: string
  selected?: string | null
  onSelect(id: string): void
}) {
  return (
    <div className="hours-table">
      <table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">Monday</th>
            <th scope="col">VR Mais</th>
            <th scope="col">Saldo comparável</th>
            <th scope="col">Divergência absoluta</th>
            <th scope="col">Dias comparáveis</th>
            <th scope="col">Acima da tolerância</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, totals }) => (
            <tr key={id}>
              <th scope="row">
                <button
                  type="button"
                  className="text-button"
                  aria-pressed={selected === id}
                  onClick={() => onSelect(id)}
                >
                  {name}
                </button>
              </th>
              <td>{duration(totals.mondaySeconds)}</td>
              <td>{duration(totals.vrSeconds)}</td>
              <td>{duration(totals.deltaSeconds)}</td>
              <td>{duration(totals.absoluteDivergenceSeconds)}</td>
              <td>
                {totals.comparableDays} / {totals.personDays}
              </td>
              <td>{totals.aboveToleranceDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DayRecords({ api, personId, day }: { api: AdminApi; personId: string; day: string }) {
  const result = useQuery(
    () => api.history({ from: day, to: day, workforcePersonId: personId }),
    [api, personId, day],
  )
  const person = result.data?.people?.find((row) => row.workforcePersonId === personId)
  return (
    <section className="admin-panel hours-overview">
      <h2>Registros importados · {date(day)}</h2>
      <QueryError error={result.error} retry={result.reload} />
      {result.pending && <Loading />}
      {person?.records?.length ? (
        <DailyHistory key={day} person={person} source="" />
      ) : (
        !result.pending &&
        !result.error && <Empty title="Nenhum registro importado para este dia" />
      )}
    </section>
  )
}

function Report({ report, api, teamId }: { report: HoursSummary; api: AdminApi; teamId?: string }) {
  const [view, setView] = useState<View>(teamId ? 'teams' : 'organization')
  const [selected, setSelected] = useState<string | null>(teamId ?? null)
  const [member, setMember] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const team = view === 'teams' ? report.teams.find((row) => row.id === selected) : undefined
  const person = report.people.find((row) => row.id === (view === 'teams' ? member : selected))
  const teamMember = team?.members.find((row) => row.personId === member)
  const teamDays = teamMember && new Set(teamMember.days)
  const days =
    person?.days.filter((day) => view !== 'teams' || (day.day && teamDays?.has(day.day))) ?? []
  const totals =
    team?.totals ?? (view === 'people' ? person?.totals : undefined) ?? report.organization
  const scope = team?.name ?? (view === 'people' ? person?.name : undefined) ?? 'Toda a organização'
  const metrics = [
    [
      'Monday',
      duration(totals.mondaySeconds),
      `${totals.mondayDays} de ${totals.personDays} pessoa-dias com dados`,
    ],
    [
      'VR Mais',
      duration(totals.vrSeconds),
      `${totals.vrDays} de ${totals.personDays} pessoa-dias com dados`,
    ],
    ['Saldo comparável', duration(totals.deltaSeconds), 'Monday menos VR Mais'],
    [
      'Divergência absoluta',
      duration(totals.absoluteDivergenceSeconds),
      `${totals.aboveToleranceDays} acima da tolerância diária`,
    ],
  ]
  const peopleById = new Map(report.people.map((p) => [p.id, p.name]))
  return (
    <>
      <section className="admin-panel hours-overview" aria-label="Totais do período">
        {!teamId && (
          <div className="hours-view" role="group" aria-label="Agrupar resumo por">
            {(Object.keys(views) as View[]).map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={view === item}
                onClick={() => {
                  setView(item)
                  setSelected(null)
                  setMember(null)
                  setSelectedDay(null)
                }}
              >
                {views[item]}
              </button>
            ))}
          </div>
        )}
        <h2>{scope}</h2>
        <p className="muted">
          {date(report.from)} a {date(report.to)} · Consultado em {timestamp(report.generatedAt)}
        </p>
        <dl className="hours-metrics">
          {metrics.map(([label, value, caption]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
              <small>{caption}</small>
            </div>
          ))}
        </dl>
        <HoursCharts totals={totals} />
        <p className="muted">
          Saldo e divergência usam somente dias comparáveis; o saldo pode ser zero mesmo com
          divergências. A ausência de dados não indica zero horas ou folga.
        </p>
      </section>
      {view === 'organization' && (
        <section className="admin-panel hours-overview">
          <h2>Composição do resumo</h2>
          <p>
            {report.people.length} pessoas associadas · {report.teams.length} times ativos ·
            tolerância diária de {report.toleranceMinutes} min
          </p>
          <p className="muted">
            O total da organização inclui pessoas sem time e conta cada pessoa e dia uma vez.
          </p>
        </section>
      )}
      {!teamId && view !== 'organization' && (
        <section className="admin-panel hours-overview">
          <h2>{view === 'teams' ? 'Por time' : 'Por pessoa'}</h2>
          {view === 'teams' && (
            <p className="muted">
              Membros atuais, somente nos dias com vínculo. Uma pessoa pode aparecer em mais de um
              time; esses subtotais não são somados para formar o total da organização.
            </p>
          )}
          {(view === 'teams' ? report.teams : report.people).length ? (
            <TotalsTable
              rows={view === 'teams' ? report.teams : report.people}
              label={view === 'teams' ? 'Time' : 'Pessoa'}
              selected={selected}
              onSelect={(id) => {
                setSelected(id)
                setMember(null)
                setSelectedDay(null)
              }}
            />
          ) : (
            <Empty title={view === 'teams' ? 'Nenhum time ativo' : 'Nenhuma pessoa associada'} />
          )}
        </section>
      )}
      {team && (
        <section className="admin-panel hours-overview">
          <h2>Pessoas de {team.name}</h2>
          {teamId && (
            <p className="muted">
              Pessoas com vínculo vigente, com horas somente nos dias de vínculo com este time.
            </p>
          )}
          {team.members.length ? (
            <TotalsTable
              rows={team.members.map((m) => ({
                id: m.personId,
                name: peopleById.get(m.personId) ?? 'Pessoa',
                totals: m.totals,
              }))}
              label="Pessoa"
              selected={member}
              onSelect={(id) => {
                setMember(id)
                setSelectedDay(null)
              }}
            />
          ) : (
            <Empty title="Nenhum membro associado neste time" />
          )}
        </section>
      )}
      {person && (
        <section className="admin-panel hours-overview">
          <h2>Detalhe diário · {person.name}</h2>
          {team && <p className="muted">Somente dias com vínculo em {team.name}.</p>}
          {days.length ? (
            <div className="hours-table">
              <table>
                <caption className="sr-only">Detalhe diário</caption>
                <thead>
                  <tr>
                    <th scope="col">Dia</th>
                    <th scope="col">Monday</th>
                    <th scope="col">VR Mais</th>
                    <th scope="col">Diferença</th>
                    <th scope="col">Ocorrências</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.day}>
                      <th scope="row">
                        <button
                          className="text-button"
                          type="button"
                          aria-pressed={selectedDay === day.day}
                          disabled={!day.day}
                          onClick={() => setSelectedDay(day.day ?? null)}
                        >
                          {date(day.day)}
                          {day.partial && ' · parcial'}
                        </button>
                      </th>
                      <td>{duration(day.mondaySeconds)}</td>
                      <td>{duration(day.vrSeconds)}</td>
                      <td>{duration(day.deltaSeconds)}</td>
                      <td>
                        {(day.issues ?? [])
                          .map((issue) => issueLabels[issue] ?? issue)
                          .join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Nenhum dia de vínculo no período" />
          )}
        </section>
      )}
      {person && selectedDay && days.some((day) => day.day === selectedDay) && (
        <DayRecords api={api} personId={person.id} day={selectedDay} />
      )}
    </>
  )
}

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
  const result = useQuery(
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
  function exportReport() {
    const report = result.data
    if (!report) return
    void action.run(async () => {
      const { downloadHoursWorkbook } = await import('./hours-excel')
      await downloadHoursWorkbook(report, () => mounted.current)
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
          !teamId && (
            <button
              className="primary-button compact"
              type="button"
              onClick={exportReport}
              disabled={!result.data?.people.length || result.pending || action.pending}
            >
              <Download size={17} aria-hidden="true" />
              {action.pending ? 'Gerando Excel…' : 'Exportar Excel'}
            </button>
          )
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
        <Report
          key={`${teamId}/${period.from}/${period.to}`}
          report={result.data}
          api={api}
          teamId={teamId}
        />
      )}
    </>
  )
}
