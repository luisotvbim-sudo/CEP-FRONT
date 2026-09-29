import { useState, type FormEvent } from 'react'
import {
  NotificationApi,
  kindLabels,
  type Settings,
  type Schedule,
  type ScheduleInput,
} from './api'
import { timestamp } from '../admin/format'
import { Empty, Loading, PageHeading, QueryError } from '../admin/ui'
import { useAction, useQuery } from '../hooks/async'
import { FormNotice } from '../components/FormNotice'

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
