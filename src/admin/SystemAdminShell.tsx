import { useEffect, useState, type FormEvent } from 'react'
import type { components } from '../auth/api-schema'
import {
  errorMessage,
  type AuthClient,
  type AuthError,
  type AuthSession,
} from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { AdminShell } from './AdminShell'
import type { Paged } from './api'
import './admin.css'

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
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    let active = true
    client
      .request<Paged<Organization>>('GET', `/admin/organizations?page=${page}&pageSize=20`)
      .then((result) => {
        if (active) {
          setOrganizations(result.items ?? [])
          setTotal(result.total ?? 0)
        }
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [client, page, revision])

  function reload(nextPage = page) {
    setError(null)
    setLoading(true)
    setPage(nextPage)
    setRevision((value) => value + 1)
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const values = new FormData(form)
    setPending(true)
    setError(null)
    setNotice('')
    try {
      await client.request<Organization>('POST', '/admin/organizations', {
        name: String(values.get('name')).trim(),
        slug: String(values.get('slug')).trim(),
        initialAdminEmail: String(values.get('email')).trim(),
        products: ['revit', 'zwcad'],
      })
      setShowCreate(false)
      setNotice('Organização criada. O convite do administrador foi colocado na fila de envio.')
      reload(1)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

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
            <strong>CEP Horas · Administrador global</strong>
            <p>{session.user.displayName}</p>
          </div>
          <button
            className="text-button"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              setError(null)
              try {
                await client.logout()
                onLogout()
              } catch (failure) {
                setError(errorMessage(failure))
              } finally {
                setPending(false)
              }
            }}
          >
            Sair da conta
          </button>
        </header>
        <main className="admin-content">
          <h1>Organizações</h1>
          <p>Selecione a organização que deseja administrar. Seu acesso global permanece ativo.</p>
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
                E-mail do administrador da organização
                <input name="email" type="email" required maxLength={320} disabled={pending} />
              </label>
              <p>
                Ao criar, será enviado um convite para este administrador, com acesso a Revit e
                ZWCAD.
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
