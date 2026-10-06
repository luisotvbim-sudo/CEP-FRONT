import { useEffect, useState } from 'react'
import { NotificationApi } from './api'
import { AnalysisDetails } from './AnalysisDetails'
import { timestamp } from '../admin/format'
import { Empty, Loading, PageHeading, Pagination, QueryError } from '../admin/ui'
import { useAction, useQuery } from '../hooks/async'
import { FormNotice } from '../components/FormNotice'

export function Inbox({
  api,
  compact = false,
  onRead,
}: {
  api: NotificationApi
  compact?: boolean
  onRead?(): void
}) {
  const [page, setPage] = useState(1)
  const [unread, setUnread] = useState(true)
  const result = useQuery(() => api.inbox(page, unread), [api, page, unread])
  const action = useAction()
  useEffect(() => {
    // A navigation request is consumed only after this destination commits.
    // Repeated intents also need acknowledgement when the Inbox is already open.
    const acknowledge = () => {
      const token = window.__CEP_INBOX_INTENT__
      const documentId = window.__CEP_DOCUMENT_ID__
      const bridge = window.chrome?.webview
      if (!token || typeof documentId !== 'string' || !bridge) return
      try {
        bridge.postMessage({ type: 'cep-inbox-consumed', token, documentId })
        if (window.__CEP_INBOX_INTENT__ === token) window.__CEP_INBOX_INTENT__ = undefined
      } catch {
        // A detached bridge must leave the intent available for another delivery.
      }
    }
    window.addEventListener('cep-open-notifications', acknowledge)
    acknowledge()
    return () => window.removeEventListener('cep-open-notifications', acknowledge)
  }, [])
  useEffect(() => {
    const timer = setInterval(result.reload, 60_000)
    return () => clearInterval(timer)
  }, [result.reload])
  return (
    <>
      {compact ? (
        <button className="secondary-button" onClick={result.reload}>
          Atualizar notificações
        </button>
      ) : (
        <PageHeading
          title="Minhas notificações"
          description="Mensagens e análises no horário original. Avisos recuperados depois de uma desconexão não representam uma conferência atual."
          action={
            <button className="secondary-button" onClick={result.reload}>
              Atualizar
            </button>
          }
        />
      )}
      <section className="admin-panel">
        <label className="notification-check">
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => {
              setUnread(e.target.checked)
              setPage(1)
            }}
          />{' '}
          Somente não lidas
        </label>
        <QueryError error={result.error} retry={result.reload} />
        <FormNotice error={action.error} />
        {result.refreshing && <Loading text="Atualizando notificações…" />}
        {result.initialLoading ? (
          <Loading />
        ) : (
          <div className="notification-list" aria-busy={result.refreshing}>
            {result.data?.items?.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>
                    {row.readAt ? 'Lida' : 'Não lida'} · {timestamp(row.createdAt)}
                  </strong>
                  {row.deliveredAt && (
                    <p className="muted">
                      Recebimento registrado em {timestamp(row.deliveredAt)}. A análise mantém o
                      corte original abaixo.
                    </p>
                  )}
                  <p>{row.message}</p>
                  <details>
                    <summary>Ver análise anexada</summary>
                    <AnalysisDetails value={row.analysis} />
                  </details>
                  {!row.readAt && (
                    <button
                      className="secondary-button"
                      disabled={action.pending}
                      onClick={() =>
                        void action.run(async () => {
                          await api.read(row.id)
                          result.reload()
                          onRead?.()
                        })
                      }
                    >
                      Marcar como lida
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {!result.initialLoading && result.data?.total === 0 && (
          <Empty title="Nenhuma notificação neste filtro">
            <p>Não há mensagens para mostrar.</p>
          </Empty>
        )}
        <Pagination
          page={page}
          total={result.data?.total ?? 0}
          size={20}
          onPage={setPage}
          pending={result.pending}
        />
      </section>
    </>
  )
}
