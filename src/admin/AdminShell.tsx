import { useLogout } from '../auth/useLogout'
import { AccountControls } from '../components/AccountControls'
import { useCallback, useMemo, useState } from 'react'
import {
  ClipboardList,
  History,
  Link2,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  UserRoundCog,
  Users,
  UsersRound,
} from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import type { AuthClient, AuthSession } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { AdminApi, type Person } from './api'
import { PeoplePage } from './PeoplePage'
import { InvitePage } from './InvitePage'
import { SyncPage } from './SyncPage'
import { TeamsPage } from './TeamsPage'
import { HistoryPage } from './HistoryPage'
import { HoursSummaryPage } from './HoursSummaryPage'
import { UsersPage } from './UsersPage'
import { AuditPage } from './AuditPage'

import './admin.css'
import {
  Analyses,
  Inbox,
  NotificationBell,
  NotificationSettings,
  SendNotification,
  useNotificationApi,
  useOpenInbox,
} from '../notifications'

const navigation = [
  { id: 'people', label: 'Pessoas', icon: Users },
  { id: 'invite', label: 'Associar e convidar', icon: Link2 },
  { id: 'sync', label: 'Sincronização', icon: RefreshCw },
  { id: 'teams', label: 'Times', icon: UsersRound },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'users', label: 'Usuários', icon: UserRoundCog },
  { id: 'audit', label: 'Auditoria', icon: ClipboardList },
  { id: 'notifications', label: 'Minhas notificações', icon: ClipboardList },
  { id: 'analyses', label: 'Análises e erros', icon: History },
  { id: 'send', label: 'Enviar aviso', icon: ClipboardList },
  { id: 'settings', label: 'Configurações globais', icon: ShieldCheck },
  { id: 'hoursSummary', label: 'Resumo', icon: History },
] as const
type Page = (typeof navigation)[number]['id']
const desktopNavigation = navigation.filter(({ id }) => id !== 'hoursSummary')

const workspaces: {
  label: string
  icon: typeof Users
  pages: [Page, ...Page[]]
  related?: Page
}[] = [
  { label: 'Pessoas', icon: Users, pages: ['people', 'teams', 'users'], related: 'invite' },
  { label: 'Horas', icon: History, pages: ['hoursSummary', 'history', 'analyses', 'sync'] },
  { label: 'Comunicação', icon: Megaphone, pages: ['send'] },
  { label: 'Configurações', icon: ShieldCheck, pages: ['settings', 'audit'] },
]

function pageLabel(page: Page) {
  return navigation.find((item) => item.id === page)?.label
}

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
  const notifications = useNotificationApi(client, organization?.id)
  useOpenInbox(() => setPage('notifications'))
  const [page, setPage] = useState<Page>('people')
  const [person, setPerson] = useState<Person | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationRevision, setNotificationRevision] = useState(0)
  const closeNotifications = useCallback(() => setNotificationsOpen(false), [])
  const web = !window.__CEP_DESKTOP__
  const workspace = workspaces.find((area) => area.pages.includes(page) || area.related === page)
  const action = useLogout(client, onLogout)
  function navigate(next: Page) {
    setPage(next)
    if (next !== 'history') setPerson(null)
    window.scrollTo({ top: 0 })
  }
  return (
    <div className="admin-app">
      <aside className={web ? 'admin-sidebar coordinator-sidebar' : 'admin-sidebar'}>
        <img src={logo} alt="Conceito Engenharia" />
        <div className="admin-product">
          <span className="product-mark">C</span>
          <div>
            <strong>CEP Horas</strong>
            <span>Coordenação</span>
          </div>
        </div>
        {!web && <div className="nav-label">ORGANIZAÇÃO</div>}
        <nav aria-label="Navegação administrativa">
          {web
            ? workspaces.map((area) => (
                <button
                  key={area.label}
                  aria-current={workspace === area ? 'page' : undefined}
                  onClick={() => {
                    if (page !== area.pages[0]) navigate(area.pages[0])
                  }}
                >
                  <area.icon size={18} strokeWidth={1.6} aria-hidden="true" />
                  {area.label}
                </button>
              ))
            : desktopNavigation.map((item) => (
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
        {!web && (
          <div className="sidebar-bottom">
            <ShieldCheck size={18} />
            <span>
              {organization
                ? 'Administrador técnico · organização selecionada'
                : 'Acesso de coordenador restrito à organização da sessão'}
            </span>
          </div>
        )}
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <div>
            <span className="breadcrumb">
              Coordenação <span>/</span> <strong>{pageLabel(page)}</strong>
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
          <AccountControls
            displayName={session.user.displayName}
            fallbackName="Coordenador"
            fallbackInitial="A"
            roleLabel={organization ? 'Administrador técnico' : 'Coordenador da organização'}
            pending={action.pending}
            onLogout={action.logout}
          >
            {web && (
              <NotificationBell
                api={notifications}
                open={notificationsOpen}
                revision={notificationRevision}
                poll={page !== 'notifications'}
                onOpen={() => setNotificationsOpen(true)}
                onClose={closeNotifications}
                onAll={() => {
                  closeNotifications()
                  navigate('notifications')
                }}
              />
            )}
          </AccountControls>
        </header>
        {web && workspace && workspace.pages.length > 1 && (
          <nav className="coordinator-sections" aria-label={`Seções de ${workspace.label}`}>
            {workspace.pages.map((section) => (
              <button
                key={section}
                aria-current={page === section ? 'page' : undefined}
                onClick={() => {
                  if (page !== section) navigate(section)
                }}
              >
                {section === 'people' ? 'Diretório' : pageLabel(section)}
              </button>
            ))}
          </nav>
        )}
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
          {web && page === 'hoursSummary' && (
            <HoursSummaryPage client={client} organizationId={organization?.id} />
          )}
          {page === 'users' && <UsersPage api={api} />}
          {page === 'audit' && <AuditPage api={api} />}
          {page === 'notifications' && (
            <Inbox
              api={notifications}
              onRead={() => setNotificationRevision((revision) => revision + 1)}
            />
          )}
          {page === 'settings' && <NotificationSettings api={notifications} />}
          {page === 'send' && <SendNotification api={notifications} peopleApi={api} />}
          {page === 'analyses' && <Analyses api={notifications} peopleApi={api} />}
        </main>
        <footer className="admin-footer">
          <span>CEP Horas · Conceito Engenharia</span>
          <span>Fuso de apresentação: America/Sao_Paulo</span>
        </footer>
      </div>
    </div>
  )
}
