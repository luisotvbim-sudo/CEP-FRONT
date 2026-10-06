import type { ReactNode } from 'react'
import type { Source } from './api'

export function HistoryFields({
  idPrefix,
  from,
  to,
  source,
  setFrom,
  setTo,
  setSource,
  changed,
  children,
}: {
  idPrefix: string
  from: string
  to: string
  source: Source | ''
  setFrom(value: string): void
  setTo(value: string): void
  setSource(value: Source | ''): void
  changed(): void
  children: ReactNode
}) {
  return (
    <div className="form-grid history-fields">
      <div>
        <label htmlFor={`${idPrefix}-from`}>De</label>
        <input
          id={`${idPrefix}-from`}
          type="date"
          required
          value={from}
          onChange={(event) => {
            setFrom(event.target.value)
            changed()
          }}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-to`}>Até</label>
        <input
          id={`${idPrefix}-to`}
          type="date"
          required
          min={from}
          value={to}
          onChange={(event) => {
            setTo(event.target.value)
            changed()
          }}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-source`}>Fonte</label>
        <select
          id={`${idPrefix}-source`}
          value={source}
          onChange={(event) => {
            setSource(event.target.value as Source | '')
            changed()
          }}
        >
          <option value="">Todas as fontes</option>
          <option value="monday">Monday</option>
          <option value="vrMais">VR Mais</option>
        </select>
      </div>
      {children}
    </div>
  )
}
