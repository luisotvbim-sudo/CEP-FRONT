import { useEffect, useRef, useState } from 'react'
import { AdminApi } from '../admin/api'
import { NotificationApi, periodLabels, type Period } from './api'
import { dispatchLabels } from './labels'
import { date, timestamp } from '../admin/format'
import { Empty, Loading, PageHeading, Pagination, QueryError } from '../admin/ui'
import { useAction, useQuery } from '../hooks/async'
import { FormNotice } from '../components/FormNotice'

export function SendNotification({
  api,
  peopleApi,
}: {
  api: NotificationApi
  peopleApi: AdminApi
}) {
  const people = useQuery(() => peopleApi.visiblePeople(), [peopleApi])
  const [userId, setUserId] = useState('')
  const [period, setPeriod] = useState<Period>('daily')
  const [message, setMessage] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState(1)
  const dispatches = useQuery(() => api.dispatches(page), [api, page])
  const preview = useQuery(() => api.preview(period, userId), [api, period, userId])
  const action = useAction()
  // The same key is retained after an uncertain network response; never resend blindly.
  const requestId = useRef(crypto.randomUUID())
  function changed() {
    setConfirmed(false)
    setNotice('')
    requestId.current = crypto.randomUUID()
  }
  useEffect(() => {
    const timer = setInterval(dispatches.reload, 15_000)
    return () => clearInterval(timer)
  }, [dispatches.reload])
  return (
    <>
      <PageHeading
        title="Enviar aviso agora"
        description="Cada destinatário recebe sua própria análise. Um único envio reúne mensagem e resultado, sem repetir avisos por problema."
      />
      <form
        className="admin-panel notification-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!confirmed || !preview.data?.recipientCount) return
          void action.run(async () => {
            const result = await api.send({
              userId: userId || null,
              period,
              message: message.trim(),
              requestId: requestId.current,
            })
            setNotice(
              `Solicitação registrada para ${result.recipientCount} destinatário(s). Acompanhe o processamento abaixo; enfileirar não comprova entrega.`,
            )
            setConfirmed(false)
            requestId.current = crypto.randomUUID()
            dispatches.reload()
          })
        }}
      >
        <QueryError error={people.error} retry={people.reload} />
        <label>
          Destinatário
          <select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value)
              changed()
            }}
            disabled={action.pending}
          >
            <option value="">Todos do escopo autorizado</option>
            {people.data
              ?.filter((person) => person.userId)
              .map((person) => (
                <option key={person.id} value={person.userId!}>
                  {person.displayName} · {person.email}
                </option>
              ))}
          </select>
        </label>
        <label>
          Análise
          <select
            value={period}
            disabled={action.pending}
            onChange={(e) => {
              setPeriod(e.target.value as Period)
              changed()
            }}
          >
            {Object.entries(periodLabels)
              .filter(([key]) => key !== 'previousDay')
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Mensagem
          <textarea
            value={message}
            required
            maxLength={2000}
            disabled={action.pending}
            onChange={(e) => {
              setMessage(e.target.value)
              changed()
            }}
          />
        </label>
        <QueryError error={preview.error} retry={preview.reload} />
        {preview.pending ? (
          <Loading text="Consultando período e destinatários…" />
        ) : (
          preview.data && (
            <p>
              Prévia: {preview.data.recipientCount} destinatário(s), de {date(preview.data.from)} a{' '}
              {date(preview.data.to)}. Corte da prévia: {timestamp(preview.data.cutoff)}. A análise
              usará o corte do processamento.
            </p>
          )
        )}
        <label className="notification-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{' '}
          Confirmo a mensagem e os destinatários acima
        </label>
        <FormNotice error={action.error} />
        {notice && <p role="status">{notice}</p>}
        <button
          className="primary-button"
          disabled={
            action.pending ||
            !confirmed ||
            preview.pending ||
            !preview.data?.recipientCount ||
            !message.trim()
          }
        >
          Enviar notificação
        </button>
      </form>
      <section className="admin-panel">
        <div className="panel-toolbar">
          <h2>Histórico de envios</h2>
          <button className="secondary-button" onClick={dispatches.reload}>
            Atualizar
          </button>
        </div>
        <QueryError error={dispatches.error} retry={dispatches.reload} />
        {dispatches.pending ? (
          <Loading />
        ) : (
          <div className="notification-list">
            {dispatches.data?.items?.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>
                    {dispatchLabels[row.status] ?? row.status} · {periodLabels[row.period]}
                  </strong>
                  <p>{row.message}</p>
                  <small>
                    {timestamp(row.createdAt)} · {row.recipientCount} destinatário(s)
                    {row.errorCode ? ` · ${row.errorCode}` : ''}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
        {!dispatches.pending && dispatches.data?.total === 0 && (
          <Empty title="Nenhum envio">
            <p>As solicitações e seus resultados aparecerão aqui.</p>
          </Empty>
        )}
        <Pagination
          page={page}
          total={dispatches.data?.total ?? 0}
          size={20}
          onPage={setPage}
          pending={dispatches.pending}
        />
      </section>
    </>
  )
}
