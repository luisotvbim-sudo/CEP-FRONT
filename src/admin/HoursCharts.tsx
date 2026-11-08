import { duration } from './format'
import type { HoursTotals } from './hours-api'

export function HoursCharts({ totals }: { totals: HoursTotals }) {
  const sources = [
    { name: 'Monday', seconds: totals.mondaySeconds, color: 'monday' },
    { name: 'VR Mais', seconds: totals.vrSeconds, color: 'vr' },
  ]
  const maximum = Math.max(1, ...sources.map(({ seconds }) => seconds ?? 0))
  const comparable = totals.comparableDays
  const missing = totals.personDays - comparable
  return (
    <div className="hours-charts">
      <figure className="hours-chart">
        <figcaption>Horas conhecidas por fonte</figcaption>
        {sources.map(({ name, seconds, color }) => (
          <div className="hours-chart-row" key={name}>
            <span>{name}</span>
            <strong>{seconds == null ? 'Indisponível' : `${duration(seconds)} h`}</strong>
            <div className="hours-chart-track" aria-hidden="true">
              {seconds != null && (
                <div
                  className={`hours-chart-fill hours-chart-${color}`}
                  style={{ width: `${(seconds / maximum) * 100}%` }}
                />
              )}
            </div>
          </div>
        ))}
        <p className="muted">As duas fontes podem ter dados de dias diferentes.</p>
      </figure>
      <figure className="hours-chart">
        <figcaption>Cobertura da comparação</figcaption>
        {totals.personDays > 0 ? (
          <>
            <div className="hours-chart-track hours-chart-coverage" aria-hidden="true">
              <div
                className="hours-chart-fill hours-chart-vr"
                style={{ width: `${(comparable / totals.personDays) * 100}%` }}
              />
            </div>
            <ul className="hours-chart-legend">
              <li>
                <i className="hours-chart-vr" aria-hidden="true" />
                <span>
                  Comparáveis: <strong>{comparable}</strong>
                </span>
              </li>
              <li>
                <i className="hours-chart-coverage" aria-hidden="true" />
                <span>
                  Sem comparação válida: <strong>{missing}</strong>
                </span>
              </li>
            </ul>
            <p className="muted">Cada dia de cada pessoa conta uma vez neste resumo.</p>
          </>
        ) : (
          <p className="muted">Nenhum dia neste recorte.</p>
        )}
      </figure>
    </div>
  )
}
