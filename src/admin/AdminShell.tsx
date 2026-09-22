import { useMemo, useState } from 'react'
import { History, Link2, LogOut, RefreshCw, ShieldCheck, Users, UsersRound } from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import type { AuthClient, AuthSession } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { AdminApi, type Person } from './api'
import { PeoplePage } from './PeoplePage'
import { InvitePage } from './InvitePage'
import { SyncPage } from './SyncPage'
import { TeamsPage } from './TeamsPage'
import { HistoryPage } from './HistoryPage'
import { useAction } from './ui'
import './admin.css'

type Page = 'people' | 'invite' | 'sync' | 'teams' | 'history'
const navigation = [
  { id: 'people', label: 'Pessoas', icon: Users },
  { id: 'invite', label: 'Associar e convidar', icon: Link2 },
  { id: 'sync', label: 'Sincronização', icon: RefreshCw },
  { id: 'teams', label: 'Equipes', icon: UsersRound },
  { id: 'history', label: 'Histórico', icon: History },
] as const

export function AdminShell({
  client,
  session,
  onLogout,
  organization,
  onChangeOrganization,
}: {
  client: AuthClient
  session: AuthSession
  onLogout(): void
  organization?: { id: string; name: string }
  onChangeOrganization?(): void
}) {
  const api = useMemo(() => new AdminApi(client, organization?.id), [client, organization?.id])
  const [page, setPage] = useState<Page>('people')
  const [person, setPerson] = useState<Person | null>(null)
  const action = useAction()
  function navigate(next: Page) {
    setPage(next)
    if (next !== 'history') setPerson(null)
    window.scrollTo({ top: 0 })
  }
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <img src={logo} alt="Conceito Engenharia" />
        <div className="admin-product">
          <span className="product-mark">C</span>
          <div>
            <strong>CEP Horas</strong>
            <span>Administração</span>
          </div>
        </div>
        <div className="nav-label">ORGANIZAÇÃO</div>
        <nav aria-label="Navegação administrativa">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} strokeWidth={1.6} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <span>
            {organization
              ? 'Administrador global · organização selecionada'
              : 'Acesso restrito à organização da sua sessão'}
          </span>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <div>
            <span className="breadcrumb">
              Administração <span>/</span>{' '}
              <strong>{navigation.find((x) => x.id === page)?.label}</strong>
            </span>
            {organization && (
              <div>
                <strong>{organization.name}</strong>{' '}
                <button className="text-button" onClick={onChangeOrganization}>
                  Trocar organização
                </button>
              </div>
            )}
          </div>
          <div className="admin-account">
            <span className="avatar">
              {session.user.displayName?.slice(0, 1).toUpperCase() || 'A'}
            </span>
            <div>
              <strong>{session.user.displayName || 'Administrador'}</strong>
              <span>{organization ? 'Administrador global' : 'Administrador da organização'}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sair da conta"
              title="Sair da conta"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  await client.logout()
                  onLogout()
                })
              }
            >
              <LogOut size={19} />
            </button>
          </div>
        </header>
        <main className="admin-content">
          <FormNotice error={action.error} />
          {page === 'people' && (
            <PeoplePage
              api={api}
              onAssociate={() => navigate('invite')}
              onHistory={(value) => {
                setPerson(value)
                navigate('history')
              }}
            />
          )}
          {page === 'invite' && (
            <InvitePage
              api={api}
              onPeople={() => navigate('people')}
              onSync={() => navigate('sync')}
            />
          )}
          {page === 'sync' && <SyncPage api={api} />}
          {page === 'teams' && <TeamsPage api={api} />}
          {page === 'history' && <HistoryPage api={api} initialPerson={person} />}
        </main>
        <footer className="admin-footer">
          <span>CEP Horas · Conceito Engenharia</span>
          <span>Fuso de apresentação: America/Sao_Paulo</span>
        </footer>
      </div>
    </div>
  )
}
