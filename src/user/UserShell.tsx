import { useAction, useQuery } from '../hooks/async'
import { useMemo, useState } from 'react'
import { History, LogOut, RefreshCw, UsersRound } from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import { AuthError, type AuthClient, type AuthSession } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { AdminApi, type Assignment, type Person, type Team } from '../admin/api'
import { HistoryView } from './HistoryView'
import { SyncPage } from '../admin/SyncPage'
import { sourceLabel, syncLabels, timestamp, today } from '../admin/format'
import { Badge, Empty, Loading, PageHeading, QueryError } from '../admin/ui'
import '../admin/admin.css'
import { Analyses, Inbox, useNotificationApi, useOpenInbox } from '../notifications'

type Page = 'mine' | 'teams' | 'sync' | 'notifications' | 'analyses' | 'teamAnalyses'

function LatestSources({ api }: { api: AdminApi }) {
  const latest = useQuery(async () => {
    try {
      return await api.latest()
    } catch (failure) {
      if (failure instanceof AuthError && failure.code === 'sync_not_found') return null
      throw failure
    }
  }, [api])
  if (latest.pending) return <Loading text="Consultando a última tentativa de atualização…" />
  if (latest.error) return <QueryError error={latest.error} retry={latest.reload} />
  if (!latest.data)
    return (
      <p className="muted">
        Você ainda não solicitou uma atualização. Isso não informa a cobertura histórica das fontes.
      </p>
    )
  return (
    <div className="user-source-status">
      <p className="muted">
        Última tentativa solicitada por você: {timestamp(latest.data.startedAt)}. Esta data não é
        necessariamente o último sucesso de cada fonte.
      </p>
      <div className="button-row">
        {(['monday', 'vrMais'] as const).map((source) => {
          const item = latest.data?.sources?.find((entry) => entry.source === source)
          return (
            <Badge
              key={source}
              tone={
                item?.status === 'succeeded'
                  ? 'good'
                  : item?.status === 'failed' || item?.status === 'partiallySucceeded'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {sourceLabel(source)}: {syncLabels[item?.status ?? ''] || 'Sem resultado'}
            </Badge>
          )
        })}
      </div>
    </div>
  )
}

function TeamHistory({ api, team, people }: { api: AdminApi; team: Team; people: Person[] }) {
  const assignments = useQuery(() => api.assignments(team.id!, false, today()), [api, team.id])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const visible = (assignments.data ?? []).flatMap((assignment: Assignment) => {
    const person = people.find((candidate) => candidate.userId === assignment.userId)
    return person?.id ? [{ assignment, person }] : []
  })
  const selected = visible.find(({ person }) => person.id === selectedId)?.person
  return (
    <>
      <div className="admin-panel">
        <div className="panel-toolbar">
          <div>
            <h2>{team.name || 'Time sem nome'}</h2>
            <p>Vínculos vigentes hoje. O acesso a cada pessoa é conferido novamente pela API.</p>
          </div>
          <button className="secondary-button" onClick={assignments.reload}>
            Atualizar vínculos
          </button>
        </div>
        <QueryError error={assignments.error} retry={assignments.reload} />
        {assignments.pending ? (
          <Loading />
        ) : !assignments.error && visible.length === 0 ? (
          <Empty title="Nenhuma pessoa associada visível">
            <p>Um vínculo de time não garante que a conta esteja associada às duas fontes.</p>
          </Empty>
        ) : (
          <div className="user-person-list">
            {visible.map(({ assignment, person }) => (
              <button
                key={assignment.id ?? person.id}
                className="person-choice"
                type="button"
                aria-pressed={selected?.id === person.id}
                onClick={() => setSelectedId(person.id!)}
              >
                <strong>
                  {person.displayName || assignment.userDisplayName || 'Pessoa sem nome'}
                </strong>
                <small>
                  {person.email || assignment.userEmail || 'E-mail indisponível'} ·{' '}
                  {assignment.role === 'manager' ? 'Líder' : 'Membro'}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
      {selected && (
        <HistoryView key={selected.id} api={api} person={selected} title="Histórico da pessoa" />
      )}
    </>
  )
}

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
  const [page, setPage] = useState<Page>('mine')
  const notifications = useNotificationApi(client)
  useOpenInbox(() => setPage('notifications'))
  const [teamId, setTeamId] = useState<string | null>(null)
  const logout = useAction()
  const self = people.data?.find((person) => person.userId === session.user.id)
  const managed = teams.data ?? []
  const selectedTeam = managed.find((team) => team.id === teamId) ?? null
  const navigation = [
    { id: 'mine' as const, label: 'Minha jornada', icon: History },
    ...(managed.length ? [{ id: 'teams' as const, label: 'Meus times', icon: UsersRound }] : []),
    { id: 'sync' as const, label: 'Atualização', icon: RefreshCw },
    { id: 'notifications' as const, label: 'Minhas notificações', icon: History },
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
              <strong>{navigation.find((item) => item.id === activePage)?.label}</strong>
            </span>
          </div>
          <div className="admin-account">
            <span className="avatar">
              {session.user.displayName?.slice(0, 1).toUpperCase() || 'M'}
            </span>
            <div>
              <strong>{session.user.displayName || 'Membro'}</strong>
              <span>{managed.length ? 'Visão pessoal e gestão dos times' : 'Visão pessoal'}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sair da conta"
              title="Sair da conta"
              disabled={logout.pending}
              onClick={() =>
                void logout.run(async () => {
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
          <FormNotice error={logout.error} />
          {activePage === 'mine' && (
            <>
              <PageHeading
                title="Minha jornada"
                description="Consulte seus registros brutos e a situação da última atualização solicitada por você."
              />
              <div className="admin-panel">
                <h2>Situação das fontes</h2>
                <LatestSources api={api} />
              </div>
              <QueryError error={people.error} retry={people.reload} />
              {people.pending ? (
                <Loading text="Localizando sua associação…" />
              ) : !people.error && !self ? (
                <div className="admin-panel">
                  <Empty title="Seus registros ainda não estão disponíveis">
                    <p>
                      Não encontramos uma pessoa associada à sua conta dentro do vínculo vigente.
                      Isso não significa zero horas. Peça ao coordenador para conferir a associação
                      e seu acesso.
                    </p>
                  </Empty>
                </div>
              ) : (
                self && <HistoryView api={api} person={self} title="Meu histórico" />
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
          {activePage === 'sync' && <SyncPage api={api} allowFull={false} />}
          {activePage === 'notifications' && <Inbox api={notifications} />}
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
