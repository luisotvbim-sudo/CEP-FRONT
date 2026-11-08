import { useState } from 'react'
import { useQuery } from '../hooks/async'
import { issueLabels } from '../notifications/labels'
import type { AdminApi } from './api'
import { DailyHistory } from './DailyHistory'
import { date, duration, timestamp } from './format'
import type { HoursReportData, HoursTotals } from './hours-api'
import { HoursCharts } from './HoursCharts'
import { Empty, Loading, QueryError } from './ui'

type View = 'organization' | 'teams' | 'people'
const views = { organization: 'Organização', teams: 'Times', people: 'Pessoas' } as const
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
  const person = result.error
    ? undefined
    : result.data?.people?.find((row) => row.workforcePersonId === personId)
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

export function HoursReport({ report, api }: { report: HoursReportData; api: AdminApi }) {
  const [selection, setSelection] = useState<{
    view: View
    id?: string
    memberId?: string
    day?: string
  }>({
    view: 'organization',
  })
  const organization = 'organization' in report ? report : undefined
  const managedTeam = 'team' in report ? report.team : undefined
  const view = managedTeam ? 'teams' : selection.view
  const team =
    managedTeam ??
    (view === 'teams' ? organization?.teams.find((row) => row.id === selection.id) : undefined)
  const member = team?.members.find((row) => row.personId === selection.memberId)
  const personId =
    view === 'teams' ? member?.personId : view === 'people' ? selection.id : undefined
  const person = report.people.find((row) => row.id === personId)
  const memberDates = member && !managedTeam ? new Set(member.days) : undefined
  const days =
    person?.days.filter(({ day }) => !memberDates || (day !== undefined && memberDates.has(day))) ??
    []
  const totals =
    'team' in report ? report.team.totals : (team?.totals ?? person?.totals ?? report.organization)
  const scope = team?.name ?? person?.name ?? 'Toda a organização'
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
        {organization && (
          <div className="hours-view" role="group" aria-label="Agrupar resumo por">
            {(Object.keys(views) as View[]).map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={view === item}
                onClick={() => setSelection({ view: item })}
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
      {organization && view === 'organization' && (
        <section className="admin-panel hours-overview">
          <h2>Composição do resumo</h2>
          <p>
            {organization.people.length} pessoas associadas · {organization.teams.length} times
            ativos · tolerância diária de {report.toleranceMinutes} min
          </p>
          <p className="muted">
            O total da organização inclui pessoas sem time e conta cada pessoa e dia uma vez.
          </p>
        </section>
      )}
      {organization && view !== 'organization' && (
        <section className="admin-panel hours-overview">
          <h2>{view === 'teams' ? 'Por time' : 'Por pessoa'}</h2>
          {view === 'teams' && (
            <p className="muted">
              Membros atuais, somente nos dias com vínculo. Uma pessoa pode aparecer em mais de um
              time; esses subtotais não são somados para formar o total da organização.
            </p>
          )}
          {(view === 'teams' ? organization.teams : organization.people).length ? (
            <TotalsTable
              rows={view === 'teams' ? organization.teams : organization.people}
              label={view === 'teams' ? 'Time' : 'Pessoa'}
              selected={selection.id}
              onSelect={(id) => setSelection({ view, id })}
            />
          ) : (
            <Empty title={view === 'teams' ? 'Nenhum time ativo' : 'Nenhuma pessoa associada'} />
          )}
        </section>
      )}
      {team && (
        <section className="admin-panel hours-overview">
          <h2>Pessoas de {team.name}</h2>
          {managedTeam && (
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
              selected={selection.memberId}
              onSelect={(id) => setSelection({ view, id: selection.id, memberId: id })}
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
                          aria-pressed={selection.day === day.day}
                          disabled={!day.day}
                          onClick={() => setSelection({ ...selection, day: day.day })}
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
      {person && selection.day && days.some((day) => day.day === selection.day) && (
        <DayRecords api={api} personId={person.id} day={selection.day} />
      )}
    </>
  )
}
