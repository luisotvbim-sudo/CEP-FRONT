import { useQuery } from '../hooks/async'
import { useLogout } from '../auth/useLogout'
import { AccountControls } from '../components/AccountControls'
import { useCallback, useMemo, useState } from 'react'
import { History, UsersRound } from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import { type AuthClient, type AuthSession } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { AdminApi } from '../admin/api'
import { HistoryView } from './HistoryView'
import { TeamHistory } from './TeamHistory'
import { PersonalOverview } from './PersonalOverview'
import { SyncPage } from '../admin/SyncPage'
import { today } from '../admin/format'
import { Empty, Loading, PageHeading, QueryError } from '../admin/ui'
import '../admin/admin.css'
import {
  Analyses,
  Inbox,
  NotificationBell,
  useNotificationApi,
  useOpenInbox,
} from '../notifications'

type Page = 'mine' | 'history' | 'teams' | 'notifications' | 'analyses' | 'teamAnalyses'

export function UserShell({
  client,
  session,
  onLogout,
}: {
  client: AuthClient
  session: AuthSession
  onLogout(): void
}) {
  const api = useMemo(() => new AdminApi(client), [client])
  const people = useQuery(() => api.visiblePeople(), [api])
  const teams = useQuery(() => api.teams(false, today()), [api])
  const reloadPeople = people.reload
  const reloadTeams = teams.reload
  const [page, setPage] = useState<Page>('mine')
  const notifications = useNotificationApi(client)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const closeNotifications = useCallback(() => setNotificationsOpen(false), [])
  const [notificationRevision, setNotificationRevision] = useState(0)
  useOpenInbox(() => {
    setNotificationsOpen(false)
    setPage('notifications')
  })
  const [teamId, setTeamId] = useState<string | null>(null)
  const [historyRevision, setHistoryRevision] = useState(0)
  const onSyncCompleted = useCallback(() => {
    reloadPeople()
    reloadTeams()
    setHistoryRevision((value) => value + 1)
  }, [reloadPeople, reloadTeams])
  const logout = useLogout(client, onLogout)
  const self = people.data?.find((person) => person.userId === session.user.id)
  const managed = teams.data ?? []
  const selectedTeam = managed.find((team) => team.id === teamId) ?? null
  const navigation = [
    { id: 'mine' as const, label: 'Minha jornada', icon: History },
    { id: 'history' as const, label: 'Meu histórico', icon: History },
    ...(managed.length ? [{ id: 'teams' as const, label: 'Meus times', icon: UsersRound }] : []),
    { id: 'analyses' as const, label: 'Minha análise', icon: History },
    ...(managed.length
      ? [{ id: 'teamAnalyses' as const, label: 'Análises dos times', icon: UsersRound }]
      : []),
  ]
  const activePage = page === 'teams' && !managed.length ? 'mine' : page

  return (
    <div className="admin-app user-app">
      <aside className="admin-sidebar">
        <img src={logo} alt="Conceito Engenharia" />
        <div className="admin-product">
          <span className="product-mark">C</span>
          <div>
            <strong>CEP Horas</strong>
            <span>{managed.length ? 'Membro e Líder' : 'Membro'}</span>
          </div>
        </div>
        <div className="nav-label">JORNADA</div>
        <nav aria-label="Navegação de membro e líder">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={activePage === item.id ? 'page' : undefined}
              onClick={() => {
                setPage(item.id)
                window.scrollTo({ top: 0 })
              }}
            >
              <item.icon size={18} strokeWidth={1.6} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          A API limita os dados à sua pessoa e aos times que você lidera atualmente.
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <div>
            <span className="breadcrumb">
              CEP Horas <span>/</span>{' '}
              <strong>
                {activePage === 'notifications'
                  ? 'Minhas notificações'
                  : navigation.find((item) => item.id === activePage)?.label}
              </strong>
            </span>
          </div>
          <AccountControls
            displayName={session.user.displayName}
            fallbackName="Membro"
            fallbackInitial="M"
            roleLabel={managed.length ? 'Visão pessoal e gestão dos times' : 'Visão pessoal'}
            pending={logout.pending}
            onLogout={logout.logout}
          >
            <NotificationBell
              api={notifications}
              open={notificationsOpen}
              revision={notificationRevision}
              onOpen={() => setNotificationsOpen(true)}
              onClose={closeNotifications}
              onAll={() => {
                setNotificationsOpen(false)
                setPage('notifications')
              }}
            />
          </AccountControls>
        </header>
        <main className="admin-content">
          <FormNotice error={logout.error} />
          {activePage === 'mine' && (
            <PersonalOverview
              client={client}
              historyApi={api}
              personId={self?.id}
              associationPending={people.pending}
              associationError={people.error}
              retryAssociation={people.reload}
              onHistory={() => setPage('history')}
              onNotifications={() => setNotificationsOpen(true)}
            />
          )}
          {activePage === 'history' && (
            <>
              {!self && (
                <PageHeading
                  eyebrow="ACOMPANHAMENTO PESSOAL"
                  title="Meu histórico"
                  description="Registros importados e associação da sua conta."
                />
              )}
              <SyncPage
                api={api}
                allowFull={false}
                embedded
                onCompleted={onSyncCompleted}
              />
              <QueryError error={people.error} retry={people.reload} />
              {people.pending && !self ? (
                <Loading text="Localizando sua associação…" />
              ) : people.error ? null : !self ? (
                <div className="admin-panel">
                  <Empty title="Seus registros ainda não estão disponíveis">
                    <p>
                      Não encontramos uma pessoa associada à sua conta.
                      Isso não significa zero horas. Peça ao coordenador para conferir a associação
                      e seu acesso.
                    </p>
                  </Empty>
                </div>
              ) : (
                self && (
                  <HistoryView
                    api={api}
                    person={self}
                    title="Meu histórico"
                    refreshRevision={historyRevision}
                  />
                )
              )}
            </>
          )}
          {activePage === 'teams' && (
            <>
              <PageHeading
                title="Meus times"
                description="Somente times que você lidera com vínculo vigente. Sua jornada pessoal permanece em Minha jornada."
              />
              <QueryError error={teams.error} retry={teams.reload} />
              {teams.pending ? (
                <Loading text="Consultando times geridos…" />
              ) : (
                !teams.error && (
                  <>
                    <div className="admin-panel">
                      <h2>Selecionar time gerido</h2>
                      <div className="button-row">
                        {managed.map((team) => (
                          <button
                            key={team.id}
                            type="button"
                            className="secondary-button"
                            aria-pressed={selectedTeam?.id === team.id}
                            onClick={() => setTeamId(team.id!)}
                          >
                            {team.name || 'Time sem nome'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {people.error ? (
                      <QueryError error={people.error} retry={people.reload} />
                    ) : people.pending ? (
                      <Loading text="Consultando pessoas autorizadas…" />
                    ) : selectedTeam ? (
                      <TeamHistory
                        key={selectedTeam.id}
                        api={api}
                        team={selectedTeam}
                        people={people.data ?? []}
                      />
                    ) : (
                      <div className="admin-panel">
                        <Empty title="Escolha um time">
                          <p>
                            O histórico é consultado por pessoa e continua sujeito ao escopo
                            validado pelo servidor.
                          </p>
                        </Empty>
                      </div>
                    )}
                  </>
                )
              )}
            </>
          )}
          {activePage === 'notifications' && !notificationsOpen && (
            <Inbox
              api={notifications}
              onRead={() => setNotificationRevision((value) => value + 1)}
            />
          )}
          {activePage === 'analyses' && (
            <Analyses api={notifications} peopleApi={api} ownUserId={session.user.id} />
          )}
          {activePage === 'teamAnalyses' && <Analyses api={notifications} peopleApi={api} />}
        </main>
        <footer className="admin-footer">
          <span>CEP Horas · Conceito Engenharia</span>
          <span>Fuso de apresentação: America/Sao_Paulo</span>
        </footer>
      </div>
    </div>
  )
}
