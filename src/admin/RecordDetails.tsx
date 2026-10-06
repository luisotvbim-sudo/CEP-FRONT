import { ExternalLink } from 'lucide-react'
import type { TimeRecord } from './api'
import { httpsUrl, timestamp } from './format'
export function RecordDetails({ record }: { record: TimeRecord }) {
  let details: { timeCards?: unknown; manual?: boolean; running?: boolean } = {}
  try {
    const value: unknown = JSON.parse(record.detailsJson || '{}')
    if (value && typeof value === 'object') details = value
  } catch {
    /* Optional source details are not guaranteed to be JSON. */
  }
  const cards = Array.isArray(details.timeCards)
    ? details.timeCards.filter((x): x is string => typeof x === 'string')
    : []
  const url = httpsUrl(record.url)
  const monday = record.source === 'monday'
  return (
    <details className={monday ? 'record-details monday-record-details' : 'record-details'}>
      <summary>Detalhes do registro</summary>
      <dl>
        {(monday || record.startedAt) && (
          <div>
            <dt>Início</dt>
            <dd>{timestamp(record.startedAt)}</dd>
          </div>
        )}
        {(monday || record.endedAt) && (
          <div>
            <dt>Fim</dt>
            <dd>{timestamp(record.endedAt)}</dd>
          </div>
        )}
        {monday && (
          <div>
            <dt>Origem</dt>
            <dd>
              {details.manual === true
                ? 'Manual'
                : details.manual === false || details.running === true
                  ? 'Cronômetro'
                  : 'Indisponível'}
            </dd>
          </div>
        )}
      </dl>
      {!monday && cards.length > 0 && <p>Batidas informadas: {cards.join(' · ')}</p>}
      {!monday && details.manual && <p>Lançamento manual informado pela fonte.</p>}
      {!monday && !record.startedAt && !record.endedAt && cards.length === 0 && (
        <p>Horários indisponíveis.</p>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          Abrir atividade <ExternalLink size={13} />
        </a>
      )}
    </details>
  )
}
