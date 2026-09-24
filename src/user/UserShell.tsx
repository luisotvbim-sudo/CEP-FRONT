import { useMemo, useState, type FormEvent } from 'react'
import { History, LogOut, RefreshCw, UsersRound } from 'lucide-react'
import logo from '../assets/conceito-logo.png'
import { AuthError, type AuthClient, type AuthSession } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import { AdminApi, type Assignment, type History as WorkforceHistory, type Person, type Source, type Team } from '../admin/api'
import { RecordDetails } from '../admin/HistoryPage'
import { SyncPage } from '../admin/SyncPage'
import { date, duration, sourceLabel, syncLabels, timestamp, today, validatePeriod } from '../admin/format'
import { Badge, Empty, Loading, PageHeading, QueryError, useAction, useQuery } from '../admin/ui'
import '../admin/admin.css'

type Page = 'mine' | 'teams' | 'sync'

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
    return <p className="muted">Você ainda não solicitou uma atualização. Isso não informa a cobertura histórica das fontes.</p>
  return (
    <div className="user-source-status">
      <p className="muted">Última tentativa solicitada por você: {timestamp(latest.data.startedAt)}. Esta data não é necessariamente o último sucesso de cada fonte.</p>
      <div className="button-row">
        {(['monday', 'vrMais'] as const).map((source) => {
          const item = latest.data?.sources?.find((entry) => entry.source === source)
          return <Badge key={source} tone={item?.status === 'succeeded' ? 'good' : item?.status === 'failed' || item?.status === 'partiallySucceeded' ? 'warning' : 'neutral'}>
            {sourceLabel(source)}: {syncLabels[item?.status ?? ''] || 'Sem resultado'}
          </Badge>
        })}
      </div>
    </div>
  )
}

function HistoryView({ api, person, title }: { api: AdminApi; person: Person; title: string }) {
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [source, setSource] = useState<Source | ''>('')
  const [result, setResult] = useState<WorkforceHistory | null>(null)
  const [validation, setValidation] = useState<AuthError | null>(null)
  const action = useAction()
  const states: Record<string, string> = {
    closed: 'Finalizado', running: 'Em andamento', reported: 'Informado pela fonte',
    missing: 'Sem registro', unrecognized: 'Não reconhecido',
  }

  function change() {
    setResult(null)
    setValidation(null)
    action.clear()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = validatePeriod(from, to)
    setValidation(message ? new AuthError(message) : null)
    if (message || !person.id) return
    setResult(null)
    void action.run(async () => setResult(await api.history({
      from, to, workforcePersonId: person.id, source: source || undefined,
    })))
  }

  const entry = result?.people?.find((value) => value.workforcePersonId === person.id)
  const records = entry?.records ?? []
  return <>
    <PageHeading title={title} description="Registros brutos das fontes; ainda não há conciliação nem saldo oficial." />
    <div className="admin-panel history-filters">
      <h2>{person.displayName || person.email || 'Pessoa associada'}</h2>
      <p className="muted">{person.email || 'E-mail indisponível'}</p>
      <form onSubmit={submit}>
        <fieldset className="unframed" disabled={action.pending}>
          <div className="form-grid history-fields">
            <div><label htmlFor="user-history-from">De</label><input id="user-history-from" type="date" required value={from} onChange={(e) => { setFrom(e.target.value); change() }} /></div>
            <div><label htmlFor="user-history-to">Até</label><input id="user-history-to" type="date" required min={from} value={to} onChange={(e) => { setTo(e.target.value); change() }} /></div>
            <div><label htmlFor="user-history-source">Fonte</label><select id="user-history-source" value={source} onChange={(e) => { setSource(e.target.value as Source | ''); change() }}>
              <option value="">Todas as fontes</option><option value="monday">Monday</option><option value="vrMais">VR Mais</option>
            </select></div>
            <button className="primary-button compact" type="submit">{action.pending ? 'Consultando…' : 'Consultar histórico'}</button>
          </div>
        </fieldset>
        <p className="muted">Até 90 dias inclusivos. A atualização normal recarrega somente os últimos 7 dias.</p>
        <FormNotice error={validation || action.error} />
      </form>
    </div>
    {action.pending ? <Loading text="Consultando registros…" /> : !result ? (
      <div className="admin-panel"><Empty title="Escolha o período da consulta"><p>Os dados exibidos respeitam o acesso vigente no servidor.</p></Empty></div>
    ) : <>
      <div className="history-summary"><span>{date(result.from)} a {date(result.to)}</span><span>Consulta gerada em {timestamp(result.generatedAt)}</span></div>
      {records.length === 0 ? <div className="admin-panel"><Empty title="Nenhum registro importado neste período"><p>Isso não significa zero horas. Confira a associação e a atualização das fontes.</p></Empty></div> : (
        <section className="admin-panel">
          <h2>Registros de {entry?.displayName || person.displayName || 'pessoa associada'}</h2>
          <div className="table-scroll"><table><thead><tr><th>Data</th><th>Fonte / atividade</th><th>Duração</th><th>Situação da fonte</th><th>Origem e horários</th></tr></thead><tbody>
            {records.map((record, index) => <tr key={record.id ?? index}>
              <td>{date(record.workDate)}</td>
              <td><strong>{sourceLabel(record.source)}</strong><small>{record.title || 'Sem título informado'}</small></td>
              <td className="duration-cell">{duration(record.durationSeconds)}</td>
              <td><Badge tone={record.state === 'running' || record.durationSeconds == null ? 'warning' : 'neutral'}>{states[record.state || ''] || record.state || 'Indisponível'}</Badge></td>
              <td><RecordDetails record={record} /></td>
            </tr>)}
          </tbody></table></div>
        </section>
      )}
      <p className="page-footnote">Duração indisponível não foi convertida em zero. Não há conclusão trabalhista ou comparação oficial nesta consulta.</p>
    </>}
  </>
}

function TeamHistory({ api, team, people }: { api: AdminApi; team: Team; people: Person[] }) {
  const assignments = useQuery(() => api.assignments(team.id!, false, today()), [api, team.id])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const visible = (assignments.data ?? []).flatMap((assignment: Assignment) => {
    const person = people.find((candidate) => candidate.userId === assignment.userId)
    return person?.id ? [{ assignment, person }] : []
  })
  const selected = visible.find(({ person }) => person.id === selectedId)?.person
  return <>
    <div className="admin-panel">
      <div className="panel-toolbar"><div><h2>{team.name || 'Time sem nome'}</h2><p>Vínculos vigentes hoje. O acesso a cada pessoa é conferido novamente pela API.</p></div>
        <button className="secondary-button" onClick={assignments.reload}>Atualizar vínculos</button>
      </div>
      <QueryError error={assignments.error} retry={assignments.reload} />
      {assignments.pending ? <Loading /> : !assignments.error && visible.length === 0 ? (
        <Empty title="Nenhuma pessoa associada visível"><p>Um vínculo de time não garante que a conta esteja associada às duas fontes.</p></Empty>
      ) : <div className="user-person-list">{visible.map(({ assignment, person }) => <button key={assignment.id ?? person.id} className="person-choice" type="button" aria-pressed={selected?.id === person.id} onClick={() => setSelectedId(person.id!)}>
        <strong>{person.displayName || assignment.userDisplayName || 'Pessoa sem nome'}</strong>
        <small>{person.email || assignment.userEmail || 'E-mail indisponível'} · {assignment.role === 'manager' ? 'Líder' : 'Membro'}</small>
      </button>)}</div>}
    </div>
    {selected && <HistoryView key={selected.id} api={api} person={selected} title="Histórico da pessoa" />}
  </>
}

export function UserShell({ client, session, onLogout }: { client: AuthClient; session: AuthSession; onLogout(): void }) {
  const api = useMemo(() => new AdminApi(client), [client])
  const people = useQuery(() => api.visiblePeople(), [api])
  const teams = useQuery(() => api.teams(false, today()), [api])
  const [page, setPage] = useState<Page>('mine')
  const [teamId, setTeamId] = useState<string | null>(null)
  const logout = useAction()
  const self = people.data?.find((person) => person.userId === session.user.id)
  const managed = teams.data ?? []
  const selectedTeam = managed.find((team) => team.id === teamId) ?? null
  const navigation = [
    { id: 'mine' as const, label: 'Minha jornada', icon: History },
    ...(managed.length ? [{ id: 'teams' as const, label: 'Meus times', icon: UsersRound }] : []),
    { id: 'sync' as const, label: 'Atualização', icon: RefreshCw },
  ]
  const activePage = page === 'teams' && !managed.length ? 'mine' : page

  return <div className="admin-app user-app">
    <aside className="admin-sidebar">
      <img src={logo} alt="Conceito Engenharia" />
      <div className="admin-product"><span className="product-mark">C</span><div><strong>CEP Horas</strong><span>{managed.length ? 'Membro e Líder' : 'Membro'}</span></div></div>
      <div className="nav-label">JORNADA</div>
      <nav aria-label="Navegação de membro e líder">{navigation.map((item) => <button key={item.id} aria-current={activePage === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); window.scrollTo({ top: 0 }) }}>
        <item.icon size={18} strokeWidth={1.6} />{item.label}
      </button>)}</nav>
      <div className="sidebar-bottom">A API limita os dados à sua pessoa e aos times que você lidera atualmente.</div>
    </aside>
    <div className="admin-main">
      <header className="admin-header"><div><span className="breadcrumb">CEP Horas <span>/</span> <strong>{navigation.find((item) => item.id === activePage)?.label}</strong></span></div>
        <div className="admin-account"><span className="avatar">{session.user.displayName?.slice(0, 1).toUpperCase() || 'M'}</span><div><strong>{session.user.displayName || 'Membro'}</strong><span>{managed.length ? 'Visão pessoal e gestão dos times' : 'Visão pessoal'}</span></div>
          <button className="icon-button" aria-label="Sair da conta" title="Sair da conta" disabled={logout.pending} onClick={() => void logout.run(async () => { await client.logout(); onLogout() })}><LogOut size={19} /></button>
        </div>
      </header>
      <main className="admin-content">
        <FormNotice error={logout.error} />
        {activePage === 'mine' && <>
          <PageHeading title="Minha jornada" description="Consulte seus registros brutos e a situação da última atualização solicitada por você." />
          <div className="admin-panel"><h2>Situação das fontes</h2><LatestSources api={api} /></div>
          <QueryError error={people.error} retry={people.reload} />
          {people.pending ? <Loading text="Localizando sua associação…" /> : !people.error && !self ? (
            <div className="admin-panel"><Empty title="Seus registros ainda não estão disponíveis"><p>Não encontramos uma pessoa associada à sua conta dentro do vínculo vigente. Isso não significa zero horas. Peça ao coordenador para conferir a associação e seu acesso.</p></Empty></div>
          ) : self && <HistoryView api={api} person={self} title="Meu histórico" />}
        </>}
        {activePage === 'teams' && <>
          <PageHeading title="Meus times" description="Somente times que você lidera com vínculo vigente. Sua jornada pessoal permanece em Minha jornada." />
          <QueryError error={teams.error} retry={teams.reload} />
          {teams.pending ? <Loading text="Consultando times geridos…" /> : !teams.error && <>
            <div className="admin-panel"><h2>Selecionar time gerido</h2><div className="button-row">{managed.map((team) => <button key={team.id} type="button" className="secondary-button" aria-pressed={selectedTeam?.id === team.id} onClick={() => setTeamId(team.id!)}>{team.name || 'Time sem nome'}</button>)}</div></div>
            {people.error ? <QueryError error={people.error} retry={people.reload} /> : people.pending ? <Loading text="Consultando pessoas autorizadas…" /> : selectedTeam ? <TeamHistory key={selectedTeam.id} api={api} team={selectedTeam} people={people.data ?? []} /> : <div className="admin-panel"><Empty title="Escolha um time"><p>O histórico é consultado por pessoa e continua sujeito ao escopo validado pelo servidor.</p></Empty></div>}
          </>}
        </>}
        {activePage === 'sync' && <SyncPage api={api} allowFull={false} />}
      </main>
      <footer className="admin-footer"><span>CEP Horas · Conceito Engenharia</span><span>Fuso de apresentação: America/Sao_Paulo</span></footer>
    </div>
  </div>
}
