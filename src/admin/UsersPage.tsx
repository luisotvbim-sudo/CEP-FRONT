import { useState, type FormEvent } from 'react'
import type { AdminApi, User } from './api'
import { FormNotice } from '../components/FormNotice'
import { Badge, Empty, Loading, PageHeading, Pagination, QueryError, SearchBox, useAction, useQuery } from './ui'

type Role = 'user' | 'organizationAdmin'
type Status = 'active' | 'suspended' | 'archived'
const roleLabel = (value?: string) => value === 'organizationAdmin' ? 'Coordenador' : value === 'user' ? 'Membro / Líder' : value || 'Indisponível'
const statusLabel = (value?: string) => value === 'active' ? 'Ativo' : value === 'suspended' ? 'Suspenso' : value === 'archived' ? 'Arquivado' : 'Indisponível'

function UserEditor({ api, user, onSaved }: { api: AdminApi; user: User; onSaved(value: User): void }) {
  const [name, setName] = useState(user.displayName ?? '')
  const [role, setRole] = useState<Role>(user.role === 'organizationAdmin' ? 'organizationAdmin' : 'user')
  const [status, setStatus] = useState<Status>(user.status ?? 'active')
  const [confirmed, setConfirmed] = useState(false)
  const action = useAction()
  const accessChanged = role !== user.role || status !== user.status
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user.id || !name.trim() || (accessChanged && !confirmed)) return
    void action.run(async () => {
      const updated = await api.updateUser(user.id!, {
        displayName: name.trim(), role, status,
        products: user.products ?? null,
      })
      setConfirmed(false)
      onSaved(updated)
    })
  }
  return <form className="admin-panel" onSubmit={save}>
    <h2>Editar usuário</h2>
    <p>{user.email || 'E-mail indisponível'}</p>
    <fieldset className="unframed" disabled={action.pending}>
      <div className="form-grid three">
        <div><label htmlFor="user-name">Nome</label><input id="user-name" value={name} required onChange={(event) => setName(event.target.value)} /></div>
        <div><label htmlFor="user-role">Papel na organização</label><select id="user-role" value={role} onChange={(event) => { setRole(event.target.value as Role); setConfirmed(false) }}>
          <option value="user">Membro / Líder</option><option value="organizationAdmin">Coordenador</option>
        </select></div>
        <div><label htmlFor="user-status">Situação da conta</label><select id="user-status" value={status} onChange={(event) => { setStatus(event.target.value as Status); setConfirmed(false) }}>
          <option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="archived">Arquivado</option>
        </select></div>
      </div>
      <p className="muted">Os produtos atuais são preservados: {user.products?.join(', ') || 'nenhum'}. Líder é um vínculo vigente de time, não um papel de usuário editado aqui.</p>
      {accessChanged && <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>Entendo que mudar papel ou situação revoga as sessões existentes deste usuário.</span>
      </label>}
      <FormNotice error={action.error} />
      <button className="primary-button compact" type="submit" disabled={!name.trim() || (accessChanged && !confirmed) || action.pending}>{action.pending ? 'Salvando…' : 'Salvar usuário'}</button>
    </fieldset>
  </form>
}

export function UsersPage({ api }: { api: AdminApi }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Status | ''>('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('organizationAdmin')
  const [notice, setNotice] = useState('')
  const query = useQuery(() => api.organizationUsers(search, status || undefined, page), [api, search, status, page])
  const invite = useAction()

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim()
    if (!value) return
    setNotice('')
    void invite.run(async () => {
      await api.inviteUser({ email: value, role: inviteRole, products: [] })
      setEmail('')
      setNotice('Convite criado e enfileirado. Isso não confirma a entrega do e-mail nem o aceite.')
    })
  }

  return <>
    <PageHeading title="Usuários e coordenadores" description="Gerencie contas e papéis da organização. O vínculo de Líder é administrado em Times." />
    <div className="admin-panel">
      <div className="panel-toolbar"><div><h2>Contas da organização</h2><p>Alterações de papel ou situação revogam sessões existentes.</p></div><SearchBox label="Pesquisar usuário" onSearch={(value) => { setSearch(value); setPage(1); setSelected(null) }} /></div>
      <label htmlFor="user-filter-status">Filtrar situação</label>
      <select id="user-filter-status" value={status} onChange={(event) => { setStatus(event.target.value as Status | ''); setPage(1); setSelected(null) }}>
        <option value="">Todas</option><option value="active">Ativos</option><option value="suspended">Suspensos</option><option value="archived">Arquivados</option>
      </select>
      <QueryError error={query.error} retry={query.reload} />
      {query.pending ? <Loading /> : !query.error && !query.data?.items?.length ? <Empty title="Nenhum usuário encontrado"><p>Revise a busca ou os filtros.</p></Empty> : !query.error && <>
        <div className="table-scroll"><table><thead><tr><th>Nome e e-mail</th><th>Papel</th><th>Situação</th><th>Produtos</th><th>Ação</th></tr></thead><tbody>
          {query.data?.items?.map((user, index) => <tr key={user.id ?? index}>
            <td><strong>{user.displayName || 'Nome indisponível'}</strong><small>{user.email || 'E-mail indisponível'}</small></td>
            <td>{roleLabel(user.role)}</td><td><Badge tone={user.status === 'active' ? 'good' : 'warning'}>{statusLabel(user.status)}</Badge></td>
            <td>{user.products?.join(', ') || 'Nenhum'}</td>
            <td><button className="secondary-button" disabled={!user.id || user.role === 'systemAdmin'} onClick={() => setSelected(user)}>Gerenciar</button></td>
          </tr>)}</tbody></table></div>
        <Pagination page={page} total={query.data?.total ?? 0} size={20} onPage={(value) => { setPage(value); setSelected(null) }} />
      </>}
    </div>
    {selected && <UserEditor key={selected.id} api={api} user={selected} onSaved={(updated) => { setSelected(updated); setNotice('Usuário atualizado. Confira o acesso e as sessões antes de continuar.'); query.reload() }} />}
    <form className="admin-panel" onSubmit={submitInvite}>
      <h2>Convidar conta administrativa</h2>
      <p>O convite é enfileirado por 48 horas. Envio e aceite precisam ser conferidos separadamente.</p>
      <fieldset className="unframed" disabled={invite.pending}>
        <div className="form-grid three">
          <div><label htmlFor="admin-invite-email">E-mail corporativo</label><input id="admin-invite-email" type="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></div>
          <div><label htmlFor="admin-invite-role">Papel do convite</label><select id="admin-invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}><option value="organizationAdmin">Coordenador</option><option value="user">Membro / Líder</option></select></div>
          <button className="primary-button compact" type="submit">{invite.pending ? 'Criando…' : 'Criar convite'}</button>
        </div>
      </fieldset>
      <FormNotice error={invite.error} />
      {notice && <div className="inline-info" role="status">{notice}</div>}
    </form>
  </>
}
