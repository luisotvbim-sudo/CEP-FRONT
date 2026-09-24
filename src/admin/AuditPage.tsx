import { useState } from 'react'
import type { AdminApi } from './api'
import { timestamp } from './format'
import { Empty, Loading, PageHeading, QueryError, useQuery } from './ui'

export function AuditPage({ api }: { api: AdminApi }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const before = cursors[cursors.length - 1]
  const events = useQuery(() => api.audit(before), [api, before])
  const items = events.data ?? []
  const last = items.at(-1)?.createdAt
  return <>
    <PageHeading title="Auditoria" description="Eventos administrativos da organização, não o histórico de justificativas ou conciliação." />
    <div className="admin-panel">
      <div className="panel-toolbar"><div><h2>Eventos recentes</h2><p>As ações são registradas pela API no escopo da organização selecionada.</p></div><button className="secondary-button" onClick={events.reload} disabled={events.pending}>Atualizar</button></div>
      <QueryError error={events.error} retry={events.reload} />
      {events.pending ? <Loading /> : !events.error && items.length === 0 ? <Empty title="Nenhum evento nesta página"><p>Volte à página anterior ou consulte novamente mais tarde.</p></Empty> : !events.error && <div className="table-scroll" role="region" aria-label="Lista de eventos de auditoria" tabIndex={0}><table><thead><tr><th>Quando</th><th>Ação</th><th>Autor</th><th>Usuário afetado</th></tr></thead><tbody>
        {items.map((event, index) => <tr key={event.id ?? index}>
          <td>{timestamp(event.createdAt)}</td><td><strong>{event.action || 'Ação indisponível'}</strong></td>
          <td>{event.actorUserId || 'Não informado'}</td><td>{event.targetUserId || 'Não informado'}</td>
        </tr>)}
      </tbody></table></div>}
      <div className="button-row">
        {cursors.length > 1 && <button className="secondary-button" disabled={events.pending} onClick={() => setCursors((value) => value.slice(0, -1))}>Eventos mais recentes</button>}
        {items.length === 50 && last && <button className="secondary-button" disabled={events.pending} onClick={() => setCursors((value) => [...value, last])}>Eventos anteriores</button>}
      </div>
    </div>
  </>
}
