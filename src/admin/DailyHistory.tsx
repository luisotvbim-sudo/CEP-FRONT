import { groupHistory } from './history-data'
import { Fragment, useId, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { History, Source } from './api'
import { date, duration, sourceLabel } from './format'
import { RecordDetails } from './RecordDetails'
import { Badge } from './ui'

const states: Record<string, string> = {
  closed: 'Finalizado',
  running: 'Em andamento',
  reported: 'Informado pela fonte',
  missing: 'Sem registro',
  unrecognized: 'Não reconhecido',
}
const issues: Record<string, string> = {
  incomplete: 'Dados insuficientes',
  odd_punches: 'Batidas incompletas',
  running_timer: 'Cronômetro aberto no fechamento',
  above_tolerance: 'Diferença acima da tolerância',
}

export function dailyDifference(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return 'Indisponível'
  if (seconds === 0) return '00:00 · Totais iguais'
  return `${seconds > 0 ? '+' : '−'}${duration(Math.abs(seconds))} · ${seconds > 0 ? 'a mais' : 'a menos'} no Monday`
}

export function DailyHistory({
  person,
  source,
}: {
  person: NonNullable<History['people']>[number]
  source: Source | ''
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const prefix = useId()
  const days = useMemo(() => groupHistory(person), [person])
  return (
    <>
      <p className="muted">
        Diferença = Monday − VR Mais. Totais dos dados importados, sem garantia de cobertura
        completa ou atualização das fontes.
      </p>
      {source && (
        <p className="muted">
          O filtro mostra os detalhes de {sourceLabel(source)}. O resumo diário considera as duas
          fontes.
        </p>
      )}
      {!person.days && (
        <p role="status">
          Resumo diário indisponível nesta versão da API. Os registros continuam disponíveis ao
          expandir.
        </p>
      )}
      <div
        className="table-scroll"
        role="region"
        aria-label={`Histórico diário de ${person.displayName || 'pessoa associada'}`}
        tabIndex={0}
      >
        <table className="daily-history">
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Duração Monday</th>
              <th scope="col">Jornada VR Mais</th>
              <th scope="col">Diferença Monday − VR</th>
            </tr>
          </thead>
          <tbody>
            {days.map(({ day, summary, records: dayRecords, sources }, index) => {
              const key = day ?? 'unknown'
              const open = expanded.has(key)
              const detailId = `${prefix}-${index}`
              return (
                <Fragment key={key}>
                  <tr>
                    <th scope="row">
                      <button
                        className="day-toggle"
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailId}
                        aria-label={`${open ? 'Recolher' : 'Expandir'} dia ${date(day)}`}
                        onClick={() =>
                          setExpanded((previous) => {
                            const next = new Set(previous)
                            if (next.has(key)) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }
                      >
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span>
                          {date(day)}
                          <small>
                            {dayRecords.length} registro(s){summary?.partial ? ' · Parcial' : ''}
                          </small>
                        </span>
                      </button>
                    </th>
                    <td className="duration-cell">{duration(summary?.mondaySeconds)}</td>
                    <td className="duration-cell">{duration(summary?.vrSeconds)}</td>
                    <td className="duration-cell">
                      {dailyDifference(summary?.deltaSeconds)}
                      {!!summary?.issues?.length && (
                        <small>
                          {summary.issues.map((issue) => issues[issue] ?? issue).join(' · ')}
                        </small>
                      )}
                    </td>
                  </tr>
                  <tr id={detailId} hidden={!open} className="day-details">
                    <td colSpan={4}>
                      {open && (
                        <div className="day-sources">
                          {(['monday', 'vrMais'] as const).map((kind) => {
                            const entries = sources[kind]
                            return (
                              <section
                                key={kind}
                                aria-label={`${sourceLabel(kind)} em ${date(day)}`}
                              >
                                <h3>{sourceLabel(kind)}</h3>
                                {!entries.length && (
                                  <p className="muted">
                                    {source && source !== kind
                                      ? 'Detalhes ocultos pelo filtro de fonte.'
                                      : 'Nenhum registro importado nesta fonte; não significa zero horas.'}
                                  </p>
                                )}
                                {entries.map((record, recordIndex) => (
                                  <article className="day-record" key={record.id ?? recordIndex}>
                                    <strong>{record.title || 'Sem título informado'}</strong>
                                    <p>
                                      Duração:{' '}
                                      <span className="duration-cell">
                                        {duration(record.durationSeconds)}
                                      </span>
                                    </p>
                                    <Badge
                                      tone={
                                        record.state === 'running' || record.durationSeconds == null
                                          ? 'warning'
                                          : 'neutral'
                                      }
                                    >
                                      {states[record.state || ''] || record.state || 'Indisponível'}
                                    </Badge>
                                    <RecordDetails record={record} />
                                  </article>
                                ))}
                              </section>
                            )
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
