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
  return (
    <details className="record-details">
      <summary>Detalhes do registro</summary>
      <dl>
        <div>
          <dt>Início</dt>
          <dd>{timestamp(record.startedAt)}</dd>
        </div>
        <div>
          <dt>Fim</dt>
          <dd>{timestamp(record.endedAt)}</dd>
        </div>
        <div>
          <dt>Importado em</dt>
          <dd>{timestamp(record.lastSyncedAt)}</dd>
        </div>
        <div>
          <dt>Referência externa</dt>
          <dd>{record.externalKey || 'Indisponível'}</dd>
        </div>
      </dl>
      {cards.length > 0 && <p>Batidas informadas: {cards.join(' · ')}</p>}
      {details.manual && <p>Lançamento manual informado pela fonte.</p>}
      {details.running && <p>Cronômetro em andamento; duração provisória.</p>}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          Abrir atividade <ExternalLink size={13} />
        </a>
      )}
    </details>
  )
}

