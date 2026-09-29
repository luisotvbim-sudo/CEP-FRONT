import { useEffect, useState } from 'react'
import { NotificationApi } from './api'
import { AnalysisDetails } from './AnalysisDetails'
import { timestamp } from '../admin/format'
import { Empty, Loading, PageHeading, Pagination, QueryError } from '../admin/ui'
import { useAction, useQuery } from '../hooks/async'
import { FormNotice } from '../components/FormNotice'

export function Inbox({ api }: { api: NotificationApi }) {
  const [page, setPage] = useState(1)
  const [unread, setUnread] = useState(true)
  const result = useQuery(() => api.inbox(page, unread), [api, page, unread])
  const action = useAction()
  useEffect(() => {
    const timer = setInterval(result.reload, 60_000)
    return () => clearInterval(timer)
  }, [result.reload])
  return (
    <>
      <PageHeading
        title="Minhas notificações"
        description="Mensagens e análises no horário original. Avisos recuperados depois de uma desconexão não representam uma conferência atual."
        action={
          <button className="secondary-button" onClick={result.reload}>
            Atualizar
          </button>
        }
      />
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
        {result.pending ? (
          <Loading />
        ) : (
          <div className="notification-list">
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
        {!result.pending && result.data?.total === 0 && (
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
