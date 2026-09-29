import { useAction, useQuery } from '../hooks/async'
import { useState, type FormEvent } from 'react'
import type { components } from '../auth/api-schema'
import type { AuthClient, AuthSession } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { AdminShell } from './AdminShell'
import type { Paged } from './api'
import './admin.css'
import { Inbox, NotificationSettings, useNotificationApi, useOpenInbox } from '../notifications'

type Organization = components['schemas']['OrganizationResponse']

export function SystemAdminShell({
  client,
  session,
  onLogout,
}: {
  client: AuthClient
  session: AuthSession
  onLogout(): void
}) {
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [globalPage, setGlobalPage] = useState<'settings' | 'inbox' | null>(null)
  const notifications = useNotificationApi(client)
  useOpenInbox(() => {
    if (!selected) setGlobalPage('inbox')
  })

  const list = useQuery(
    () =>
      client.request<Paged<Organization>>('GET', `/admin/organizations?page=${page}&pageSize=20`),
    [client, page],
  )
  const action = useAction()
  const organizations = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const loading = list.pending
  const { pending } = action
  const error = action.error || list.error
  function reload(nextPage = page) {
    action.clear()
    if (nextPage === page) list.reload()
    else setPage(nextPage)
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setNotice('')
    await action.run(async () => {
      await client.request<Organization>('POST', '/admin/organizations', {
        name: String(values.get('name')).trim(),
        slug: String(values.get('slug')).trim(),
        initialAdminEmail: String(values.get('email')).trim(),
        products: ['revit', 'zwcad'],
      })
      setShowCreate(false)
      setNotice('Organização criada. O convite do coordenador foi colocado na fila de envio.')
      reload(1)
    })
  }

  if (globalPage && !selected)
    return (
      <div className="admin-app system-admin-app">
        <div className="admin-main">
          <main className="admin-content">
            <button className="secondary-button" onClick={() => setGlobalPage(null)}>
              Voltar às organizações
            </button>
            {globalPage === 'settings' ? (
              <NotificationSettings api={notifications} />
            ) : (
              <Inbox api={notifications} />
            )}
          </main>
        </div>
      </div>
    )
  if (selected)
    return (
      <AdminShell
        key={selected.id}
        client={client}
        session={session}
        organization={selected}
        onLogout={onLogout}
        onChangeOrganization={() => setSelected(null)}
      />
    )

  return (
    <div className="admin-app system-admin-app">
      <div className="admin-main">
        <header className="admin-header">
          <div>
            <strong>CEP Horas · Administração técnica da plataforma</strong>
            <p>{session.user.displayName}</p>
          </div>
          <button
            className="text-button"
            disabled={pending}
            onClick={() =>
              void action.run(async () => {
                await client.logout()
                onLogout()
              })
            }
          >
            Sair da conta
          </button>
        </header>
        <main className="admin-content">
          <h1>Organizações</h1>
          <p>Selecione a organização que deseja administrar. Seu acesso global permanece ativo.</p>
          <div className="button-row">
            <button className="secondary-button" onClick={() => setGlobalPage('settings')}>
              Configurações globais
            </button>
            <button className="secondary-button" onClick={() => setGlobalPage('inbox')}>
              Minhas notificações
            </button>
          </div>
          <FormNotice error={error} />
          {notice && <p role="status">{notice}</p>}
          <button className="text-button" onClick={() => reload()} disabled={loading}>
            Atualizar lista
          </button>
          <button
            className="text-button"
            onClick={() => setShowCreate((value) => !value)}
            disabled={pending}
          >
            Nova organização
          </button>
          {showCreate && (
            <form onSubmit={create}>
              <label>
                Nome
                <input name="name" required maxLength={200} disabled={pending} />
              </label>
              <label>
                Identificador
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={100}
                  disabled={pending}
                  placeholder="conceito-projetos"
                />
              </label>
              <label>
                E-mail do coordenador da organização
                <input name="email" type="email" required maxLength={320} disabled={pending} />
              </label>
              <p>
                Ao criar, será enviado um convite para este coordenador, com acesso a Revit e ZWCAD.
              </p>
              <button className="primary-button" disabled={pending}>
                {pending ? 'Criando…' : 'Criar e convidar'}
              </button>
            </form>
          )}
          {loading ? (
            <p role="status">Carregando organizações…</p>
          ) : (
            <>
              {!organizations.length && !error && <p>Nenhuma organização cadastrada.</p>}
              <ul>
                {organizations.map((org) => (
                  <li key={org.id} style={{ marginBlock: 16 }}>
                    <strong>{org.name}</strong> ·{' '}
                    {org.status === 'active'
                      ? 'Ativa'
                      : org.status === 'suspended'
                        ? 'Suspensa'
                        : 'Arquivada'}{' '}
                    <button
                      className="text-button"
                      disabled={!org.id}
                      onClick={() =>
                        org.id && setSelected({ id: org.id, name: org.name ?? 'Organização' })
                      }
                    >
                      Administrar
                    </button>
                  </li>
                ))}
              </ul>
              <button
                className="text-button"
                disabled={page === 1}
                onClick={() => reload(page - 1)}
              >
                Anterior
              </button>
              <span> Página {page} </span>
              <button
                className="text-button"
                disabled={page * 20 >= total}
                onClick={() => reload(page + 1)}
              >
                Próxima
              </button>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
