import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AuthClient } from '../auth/auth-client'
import { AdminApi } from '../admin/api'
import { date, duration, timestamp } from '../admin/format'
import {
  Empty,
  Loading,
  PageHeading,
  Pagination,
  QueryError,
  useAction,
  useQuery,
} from '../admin/ui'
import { FormNotice } from '../components/FormNotice'
import {
  NotificationApi,
  kindLabels,
  periodLabels,
  type Analysis,
  type Period,
  type Schedule,
  type ScheduleInput,
  type Settings,
} from './api'
import './notifications.css'

const issueLabels: Record<string, string> = {
  odd_punches: 'Batidas ímpares',
  running_timer: 'Cronômetro aberto no fechamento',
  incomplete: 'Dados insuficientes',
  above_tolerance: 'Diferença acima da tolerância',
}
const dispatchLabels: Record<string, string> = {
  pending: 'Na fila',
  running: 'Processando',
  processing: 'Processando',
  succeeded: 'Concluído',
  completed: 'Concluído',
  partiallySucceeded: 'Concluído com falhas',
  failed: 'Falhou',
}

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
          {dispatchLabels[source.status ?? ''] ?? source.status ?? 'Indisponível'} ·{' '}
          {timestamp(source.observedAt)}
          {source.errorCode ? ` · ${source.errorCode}` : ''}
        </p>
      ))}
      <div className="table-scroll">
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
                    ? day.issues.map((issue) => issueLabels[issue] ?? issue).join(' · ')
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

function SettingsForm({
  value,
  api,
  reload,
}: {
  value: Settings
  api: NotificationApi
  reload(): void
}) {
  const action = useAction()
  const [notice, setNotice] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void action.run(async () => {
      await api.saveSettings({
        version: value.version,
        toleranceMinutes: Number(form.get('tolerance')),
        automaticEnabled: form.has('automatic'),
      })
      setNotice('Configuração global salva.')
      reload()
    })
  }
  return (
    <form className="admin-panel notification-form" onSubmit={submit}>
      <h2>Regras globais</h2>
      <p>
        Estas alterações afetam todas as organizações. Dados e destinatários permanecem restritos ao
        escopo autorizado.
      </p>
      <label>
        Tolerância diária em minutos
        <input
          name="tolerance"
          type="number"
          required
          min="0"
          max="1440"
          step="1"
          defaultValue={value.toleranceMinutes}
        />
      </label>
      <p className="muted">
        O mesmo limite se aplica a horas a mais e a menos. Fuso: {value.timeZoneId}.
      </p>
      <label className="notification-check">
        <input name="automatic" type="checkbox" defaultChecked={value.automaticEnabled} /> Ativar
        notificações automáticas de segunda a sexta
      </label>
      <p className="muted">
        Última alteração: {timestamp(value.updatedAt)}. Ao ativar, os horários cadastrados passam a
        valer para todas as organizações.
      </p>
      <FormNotice error={action.error} />
      {notice && <p role="status">{notice}</p>}
      {action.error?.status === 409 && (
        <button type="button" className="secondary-button" onClick={reload}>
          Recarregar alterações de outro administrador
        </button>
      )}
      <button className="primary-button" disabled={action.pending}>
        Salvar configuração global
      </button>
    </form>
  )
}

function ScheduleForm({ row, api, done }: { row?: Schedule; api: NotificationApi; done(): void }) {
  const action = useAction()
  return (
    <form
      className="admin-panel notification-form"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const localTime = String(form.get('time'))
        const input: ScheduleInput = {
          localTime: localTime.length === 5 ? `${localTime}:00` : localTime,
          message: String(form.get('message')).trim(),
          kind: String(form.get('kind')) as Schedule['kind'],
          isEnabled: form.has('enabled'),
          ...(row ? { version: row.version } : {}),
        }
        void action.run(async () => {
          await api.saveSchedule(input, row?.id)
          done()
        })
      }}
    >
      <h2>{row ? 'Editar agendamento' : 'Novo agendamento'}</h2>
      <label>
        Horário em São Paulo
        <input
          name="time"
          type="time"
          required
          defaultValue={row?.localTime.slice(0, 5) ?? '10:00'}
        />
      </label>
      <label>
        Finalidade
        <select name="kind" defaultValue={row?.kind ?? 'previousDay'}>
          {Object.entries(kindLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mensagem
        <textarea name="message" required maxLength={2000} defaultValue={row?.message ?? ''} />
      </label>
      <label className="notification-check">
        <input type="checkbox" name="enabled" defaultChecked={row?.isEnabled ?? true} /> Agendamento
        ativo
      </label>
      <p className="muted">
        Somente dias úteis. Pendências de ontem consideram o dia civil anterior; segunda-feira
        considera domingo. Salvar não envia uma notificação agora.
      </p>
      <FormNotice error={action.error} />
      {action.error?.code === 'configuration_conflict' && (
        <button type="button" className="secondary-button" onClick={done}>
          Descartar edição e recarregar agendas
        </button>
      )}
      <div className="button-row">
        <button className="primary-button" disabled={action.pending}>
          Salvar agendamento
        </button>
        <button type="button" className="secondary-button" onClick={done}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

export function NotificationSettings({ api }: { api: NotificationApi }) {
  const settings = useQuery(() => api.settings(), [api])
  const schedules = useQuery(() => api.schedules(), [api])
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Schedule | null>(null)
  const action = useAction()
  return (
    <>
      <PageHeading
        title="Configurações de horas e avisos"
        description="Tolerância e horários globais. Alterações administrativas ficam auditadas."
      />
      <QueryError error={settings.error} retry={settings.reload} />
      {settings.pending ? (
        <Loading />
      ) : (
        settings.data && (
          <SettingsForm
            key={settings.data.version}
            value={settings.data}
            api={api}
            reload={settings.reload}
          />
        )
      )}
      <section className="admin-panel">
        <div className="panel-toolbar">
          <h2>Agendamentos globais</h2>
          <button className="primary-button" onClick={() => setEditing('new')}>
            Criar agendamento
          </button>
        </div>
        <QueryError error={schedules.error} retry={schedules.reload} />
        <FormNotice error={action.error} />
        {schedules.pending ? (
          <Loading />
        ) : (
          <div className="notification-list">
            {schedules.data?.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>
                    {row.localTime.slice(0, 5)} · {kindLabels[row.kind]}
                  </strong>
                  <p>{row.message}</p>
                  <small>{row.isEnabled ? 'Ativo' : 'Desativado'}</small>
                </div>
                <div className="button-row">
                  <button className="secondary-button" onClick={() => setEditing(row)}>
                    Editar
                  </button>
                  <button className="text-button" onClick={() => setDeleting(row)}>
                    Excluir
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {!schedules.pending && schedules.data?.length === 0 && (
          <Empty title="Nenhum agendamento">
            <p>Crie um horário para os avisos automáticos.</p>
          </Empty>
        )}
        {deleting && (
          <div role="alert" className="admin-panel">
            <p>
              Excluir o agendamento global das {deleting.localTime.slice(0, 5)}? Isso afeta todas as
              organizações.
            </p>
            <div className="button-row">
              <button
                className="primary-button"
                disabled={action.pending}
                onClick={() =>
                  void action.run(async () => {
                    await api.deleteSchedule(deleting)
                    setDeleting(null)
                    schedules.reload()
                  })
                }
              >
                Confirmar exclusão
              </button>
              <button className="secondary-button" onClick={() => setDeleting(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>
      {editing && (
        <ScheduleForm
          key={editing === 'new' ? 'new' : editing.id}
          api={api}
          row={editing === 'new' ? undefined : editing}
          done={() => {
            setEditing(null)
            schedules.reload()
          }}
        />
      )}
    </>
  )
}

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

export function Analyses({
  api,
  peopleApi,
  ownUserId,
}: {
  api: NotificationApi
  peopleApi: AdminApi
  ownUserId?: string
}) {
  const [period, setPeriod] = useState<Period>('daily')
  const [personId, setPersonId] = useState('')
  const [day, setDay] = useState('')
  const [issue, setIssue] = useState('')
  const [page, setPage] = useState(1)
  const people = useQuery(() => peopleApi.visiblePeople(), [peopleApi])
  const own = people.data?.find((person) => person.userId === ownUserId)
  const result = useQuery(
    async () =>
      ownUserId && !own?.id
        ? { items: [], total: 0 }
        : api.reports(period, page, ownUserId ? own?.id : personId, day, issue),
    [api, period, page, personId, ownUserId, own?.id, day, issue],
  )
  return (
    <>
      <PageHeading
        title={ownUserId ? 'Minha análise' : 'Análises e relatórios de erros'}
        description="Resultados calculados pelo backend, com corte e qualidade das fontes. Esta consulta não executa uma nova importação."
        action={
          <button className="secondary-button" onClick={result.reload}>
            Atualizar consulta
          </button>
        }
      />
      <section className="admin-panel notification-form">
        <label>
          Período
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as Period)
              setPage(1)
            }}
          >
            {Object.entries(periodLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!ownUserId && (
          <label>
            Pessoa
            <select
              value={personId}
              onChange={(e) => {
                setPersonId(e.target.value)
                setPage(1)
              }}
            >
              <option value="">Todas do escopo</option>
              {people.data?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Dia da ocorrência (opcional)
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <label>
          Tipo de ocorrência
          <select
            value={issue}
            onChange={(e) => {
              setIssue(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Todos</option>
            {Object.entries(issueLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <QueryError error={people.error} retry={people.reload} />
        <QueryError error={result.error} retry={result.reload} />
        {people.pending || result.pending ? (
          <Loading />
        ) : (
          result.data?.items?.map((row) => (
            <article key={row.id}>
              <h2>{row.displayName}</h2>
              <p>Gerado em {timestamp(row.createdAt)}</p>
              <AnalysisDetails value={row.analysis} />
            </article>
          ))
        )}
        {!people.pending && !result.pending && result.data?.total === 0 && (
          <Empty title="Nenhuma análise disponível">
            <p>
              O processamento diário e os envios geram análises. Ausência de resultado não significa
              horas corretas ou zero horas.
            </p>
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

export function useNotificationApi(client: AuthClient, organizationId?: string) {
  return useMemo(() => new NotificationApi(client, organizationId), [client, organizationId])
}
export function useOpenInbox(open: () => void) {
  const callback = useRef(open)
  callback.current = open
  useEffect(() => {
    const listener = () => callback.current()
    window.addEventListener('cep-open-notifications', listener)
    return () => window.removeEventListener('cep-open-notifications', listener)
  }, [])
}
