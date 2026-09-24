import { useState } from 'react'
import { ArrowLeft, Plus, Users } from 'lucide-react'
import { FormNotice } from '../components/FormNotice'
import type { AdminApi, Assignment, Team, User } from './api'
import { date, today } from './format'
import {
  Badge,
  Empty,
  Loading,
  PageHeading,
  Pagination,
  QueryError,
  SearchBox,
  useAction,
  useQuery,
} from './ui'

export function TeamsPage({ api }: { api: AdminApi }) {
  const [includeInactive, setIncludeInactive] = useState(false)
  const [asOf, setAsOf] = useState(today)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Team | null>(null)
  const list = useQuery(() => api.teams(includeInactive, asOf), [api, includeInactive, asOf])
  const action = useAction()
  if (selected)
    return (
      <TeamDetail
        api={api}
        team={selected}
        onBack={() => {
          setSelected(null)
          list.reload()
        }}
      />
    )
  return (
    <>
      <PageHeading
        title="Times"
        description="Organize membros e líderes, preservando a vigência de cada vínculo."
      />
      <form
        className="admin-panel create-team"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          void action.run(async () => {
            await api.createTeam(name.trim())
            setName('')
            list.reload()
          })
        }}
      >
        <div>
          <label htmlFor="team-name">Nome do novo time</label>
          <input
            id="team-name"
            required
            maxLength={120}
            placeholder="Ex.: Projetos estruturais"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={action.pending}
          />
        </div>
        <button className="primary-button compact" disabled={action.pending || !name.trim()}>
          <Plus size={17} />
          {action.pending ? 'Cadastrando…' : 'Cadastrar time'}
        </button>
        <FormNotice error={action.error} />
      </form>
      <div className="admin-panel">
        <div className="panel-toolbar">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />{' '}
            Incluir times inativos
          </label>
          <label className="date-inline">
            Vínculos em{' '}
            <input
              aria-label="Data de referência dos times"
              type="date"
              required
              value={asOf}
              onChange={(e) => {
                if (e.target.value) setAsOf(e.target.value)
              }}
            />
          </label>
        </div>
        <QueryError error={list.error} retry={list.reload} />
        {list.pending ? (
          <Loading />
        ) : (
          !list.error &&
          (!list.data?.length ? (
            <Empty title="Nenhum time cadastrado">
              <p>Cadastre um time para organizar os vínculos.</p>
            </Empty>
          ) : (
            <div className="team-grid">
              {list.data.map((team, i) => (
                <button
                  className="team-card"
                  key={team.id ?? i}
                  onClick={() => setSelected(team)}
                  disabled={!team.id}
                >
                  <span className="team-icon">
                    <Users size={22} />
                  </span>
                  <strong>{team.name}</strong>
                  <Badge tone={team.isActive ? 'good' : 'neutral'}>
                    {team.isActive ? 'Ativa' : 'Inativa'}
                  </Badge>
                  <span>
                    {team.activeMembers ?? 0} membros · {team.activeManagers ?? 0} líderes em{' '}
                    {date(asOf)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  )
}

function TeamDetail({ api, team, onBack }: { api: AdminApi; team: Team; onBack(): void }) {
  const [name, setName] = useState(team.name || '')
  const [enabled, setEnabled] = useState(team.isActive === true)
  const [savedActive, setSavedActive] = useState(team.isActive === true)
  const [history, setHistory] = useState(true)
  const [asOf, setAsOf] = useState(today)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<'member' | 'manager'>('member')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState('')
  const [ending, setEnding] = useState<Assignment | null>(null)
  const [endDate, setEndDate] = useState(today)
  const [notice, setNotice] = useState('')
  const list = useQuery(
    () => api.assignments(team.id!, history, asOf),
    [api, team.id, history, asOf],
  )
  const users = useQuery(() => api.users(search, page), [api, search, page])
  const edit = useAction(),
    assign = useAction(),
    end = useAction()
  return (
    <>
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={15} /> Todos os times
      </button>
      <PageHeading
        title={team.name || 'Time'}
        description="Gerencie as informações do time e a vigência de membros e líderes."
      />
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      <form
        className="admin-panel team-edit"
        onSubmit={(e) => {
          e.preventDefault()
          void edit.run(async () => {
            const result = await api.updateTeam(team.id!, name.trim(), enabled)
            setSavedActive(result.isActive === true)
            setNotice('Time atualizado.')
            list.reload()
          })
        }}
      >
        <div>
          <label htmlFor="edit-team-name">Nome do time</label>
          <input
            id="edit-team-name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={edit.pending}
          />
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={edit.pending}
          />{' '}
          Time ativo
        </label>
        <button className="secondary-button" disabled={edit.pending || !name.trim()}>
          {edit.pending ? 'Salvando…' : 'Salvar time'}
        </button>
        <FormNotice error={edit.error} />
      </form>
      <div className="admin-panel">
        <div className="panel-toolbar">
          <h2>Vínculos</h2>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => setHistory(e.target.checked)}
            />{' '}
            Incluir histórico e vínculos futuros
          </label>
          {!history && (
            <label className="date-inline">
              Em{' '}
              <input
                type="date"
                aria-label="Data dos vínculos"
                required
                value={asOf}
                onChange={(e) => {
                  if (e.target.value) setAsOf(e.target.value)
                }}
              />
            </label>
          )}
        </div>
        <QueryError error={list.error} retry={list.reload} />
        {list.pending ? (
          <Loading />
        ) : (
          !list.error &&
          (!list.data?.length ? (
            <Empty title="Nenhum vínculo encontrado">
              <p>Adicione uma pessoa com conta ativa abaixo.</p>
            </Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Função no time</th>
                    <th>Início</th>
                    <th>Fim inclusivo</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((a, i) => (
                    <tr key={a.id ?? i}>
                      <td>
                        <strong>{a.userDisplayName}</strong>
                        <small>{a.userEmail}</small>
                      </td>
                      <td>{a.role === 'manager' ? 'Líder' : 'Membro'}</td>
                      <td>{date(a.effectiveFrom)}</td>
                      <td>{a.effectiveTo ? date(a.effectiveTo) : 'Sem data de fim'}</td>
                      <td>
                        {!a.effectiveTo && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setEnding(a)
                              setEndDate(
                                (a.effectiveFrom || '') > today() ? a.effectiveFrom! : today(),
                              )
                              end.clear()
                            }}
                          >
                            Encerrar vínculo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
      {ending && (
        <form
          className="admin-panel"
          onSubmit={(e) => {
            e.preventDefault()
            void end.run(async () => {
              await api.endAssignment(team.id!, ending.id!, endDate)
              setEnding(null)
              setNotice('Vínculo encerrado na data informada.')
              list.reload()
            })
          }}
        >
          <h2>Encerrar vínculo de {ending.userDisplayName}</h2>
          <p>
            A pessoa permanece vinculada até a data de fim, inclusive. O histórico será preservado.
          </p>
          <label htmlFor="end-date">Data de fim</label>
          <input
            id="end-date"
            className="date-field"
            type="date"
            required
            min={ending.effectiveFrom}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={end.pending}
          />
          <FormNotice error={end.error} />
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={end.pending}
              onClick={() => setEnding(null)}
            >
              Cancelar
            </button>
            <button className="primary-button compact" disabled={end.pending}>
              {end.pending ? 'Encerrando…' : 'Confirmar encerramento'}
            </button>
          </div>
        </form>
      )}
      <section className="admin-panel">
        <h2>Adicionar membro ou líder</h2>
        {!savedActive ? (
          <p className="inline-info">Ative e salve o time para adicionar vínculos.</p>
        ) : (
          <>
            <SearchBox
              label="Pesquisar conta da organização"
              onSearch={(v) => {
                setSearch(v)
                setPage(1)
              }}
            />
            <QueryError error={users.error} retry={users.reload} />
            {users.pending ? (
              <Loading />
            ) : (
              !users.error &&
              (!users.data?.items?.length ? (
                <Empty title="Nenhuma conta ativa encontrada">
                  <p>A pessoa precisa aceitar o convite antes de receber um vínculo.</p>
                </Empty>
              ) : (
                <div className="user-options">
                  {users.data.items.map((u, i) => (
                    <label className="identity-option" key={u.id ?? i}>
                      <input
                        type="radio"
                        name="team-user"
                        checked={!!u.id && user?.id === u.id}
                        onChange={() => setUser(u)}
                        disabled={!u.id || assign.pending}
                      />
                      <span>
                        <strong>{u.displayName}</strong>
                        <small>{u.email}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ))
            )}
            {users.data && (
              <Pagination page={page} total={users.data.total ?? 0} size={12} onPage={setPage} />
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!user?.id || (to && to < from)) return
                void assign.run(async () => {
                  await api.assign(team.id!, {
                    userId: user.id!,
                    role,
                    effectiveFrom: from,
                    effectiveTo: to || null,
                  })
                  setNotice(`Vínculo criado para ${user.displayName}.`)
                  setUser(null)
                  list.reload()
                })
              }}
            >
              <p className="selection-note">
                Pessoa selecionada: <strong>{user?.displayName || 'Nenhuma'}</strong>
              </p>
              <fieldset className="unframed" disabled={assign.pending}>
                <div className="form-grid three">
                  <div>
                    <label htmlFor="assignment-role">Função no time</label>
                    <select
                      id="assignment-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'member' | 'manager')}
                    >
                      <option value="member">Membro</option>
                      <option value="manager">Líder</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="assignment-from">Início da vigência</label>
                    <input
                      id="assignment-from"
                      type="date"
                      required
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="assignment-to">Fim da vigência (opcional)</label>
                    <input
                      id="assignment-to"
                      type="date"
                      min={from}
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </div>
                </div>
                <p className="muted">
                  O vínculo de líder vigente já limita o acesso a times, pessoas e histórico na API.
                  As telas operacionais de gestão são apresentadas apenas a quem lidera um time.
                </p>
                <FormNotice error={assign.error} />
                <button className="primary-button compact" disabled={!user?.id || assign.pending}>
                  {assign.pending ? 'Salvando vínculo…' : 'Adicionar vínculo'}
                </button>
              </fieldset>
            </form>
          </>
        )}
      </section>
    </>
  )
}
