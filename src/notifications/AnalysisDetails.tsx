import type { Analysis } from './api'
import { date, duration, timestamp } from '../admin/format'
import { issueLabels } from './labels'

export function AnalysisDetails({ value }: { value: Analysis }) {
  return (
    <div className="analysis-details">
      <p>
        {date(value.from)} a {date(value.to)} · Corte: {timestamp(value.cutoff)} · Tolerância
        diária: {value.toleranceMinutes} minutos nos dois sentidos.
      </p>
      <dl className="analysis-totals">
        <div>
          <dt>VR Mais</dt>
          <dd>{duration(value.vrSeconds)}</dd>
        </div>
        <div>
          <dt>Monday</dt>
          <dd>{duration(value.mondaySeconds)}</dd>
        </div>
        <div>
          <dt>Diferença Monday − VR</dt>
          <dd>{duration(value.deltaSeconds)}</dd>
        </div>
        <div>
          <dt>Divergência absoluta dos dias</dt>
          <dd>{duration(value.absoluteDivergenceSeconds)}</dd>
        </div>
      </dl>
      {value.sources?.map((source) => (
        <p key={source.source} className="muted">
          {source.source === 'monday' ? 'Monday' : 'VR Mais'}:{' '}
          {source.status === 'complete' ? 'Leitura completa' : 'Leitura incompleta'} ·{' '}
          {timestamp(source.observedAt)}
          {source.errorCode ? ' · Não foi possível concluir esta leitura.' : ''}
        </p>
      ))}
      <div
        className="table-scroll"
        role="region"
        aria-label="Detalhes diários da análise"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Dia</th>
              <th>VR Mais</th>
              <th>Monday</th>
              <th>Diferença</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {(value.days ?? []).map((day) => (
              <tr key={day.day}>
                <td>
                  {date(day.day)}
                  {day.partial && <small> · Parcial</small>}
                </td>
                <td>{duration(day.vrSeconds)}</td>
                <td>{duration(day.mondaySeconds)}</td>
                <td>{duration(day.deltaSeconds)}</td>
                <td>
                  {day.issues?.length
                    ? day.issues
                        .map((issue) => issueLabels[issue] ?? 'Informações a revisar')
                        .join(' · ')
                    : day.deltaSeconds == null
                      ? 'Informações insuficientes'
                      : 'Dentro da tolerância'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Valores indisponíveis não significam zero. Corrija os registros na origem. Ler o aviso não
        resolve uma pendência.
      </p>
    </div>
  )
}
