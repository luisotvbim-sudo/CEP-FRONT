import { useState } from 'react'
import { ArrowRight, Plus, RefreshCw } from 'lucide-react'
import type { AdminApi, Person } from './api'
import { invitationState, timestamp } from './format'
import {
  Badge,
  Empty,
  Loading,
  PageHeading,
  Pagination,
  QueryError,
  SearchBox,
  useQuery,
} from './ui'

export function PeoplePage({
  api,
  onAssociate,
  onHistory,
}: {
  api: AdminApi
  onAssociate(): void
  onHistory(person: Person): void
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const list = useQuery(() => api.people(search, page), [api, search, page])
  const invitations = useQuery(() => api.invitations(), [api])
  return (
    <>
      <PageHeading
        title="Pessoas"
        description="Conecte as identidades do Monday e do VR Mais às pessoas da sua organização."
        action={
          <button className="primary-button compact" onClick={onAssociate}>
            <Plus size={17} /> Associar e convidar
          </button>
        }
      />
      <div className="admin-panel">
        <div className="panel-toolbar">
          <SearchBox
            onSearch={(v) => {
              setSearch(v)
              setPage(1)
            }}
            initial={search}
          />
          <button
            className="secondary-button"
            onClick={() => {
              list.reload()
              invitations.reload()
            }}
            disabled={list.pending}
          >
            <RefreshCw size={15} /> Atualizar
          </button>
        </div>
        <QueryError error={list.error} retry={list.reload} />
        {invitations.error && (
          <div className="inline-info">
            O estado complementar dos convites não pôde ser consultado. As associações continuam
            disponíveis.
            <QueryError error={invitations.error} retry={invitations.reload} />
          </div>
        )}
        {list.pending ? (
          <Loading />
        ) : (
          !list.error &&
          (!list.data?.items?.length ? (
            <Empty
              title={search ? 'Nenhuma pessoa encontrada' : 'Sua lista de pessoas começa aqui'}
            >
              <p>
                {search
                  ? 'Tente outro nome ou e-mail.'
                  : 'Sincronize os perfis das fontes e confirme as correspondências para convidar as pessoas.'}
              </p>
              <button className="text-button" onClick={onAssociate}>
                Associar a primeira pessoa <ArrowRight size={14} />
              </button>
            </Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Monday</th>
                    <th>VR Mais</th>
                    <th>Convite</th>
                    <th>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((person, index) => {
                    const invitation = invitations.data?.find((i) => i.id === person.invitationId)
                    const status = invitationState(person, invitation)
                    return (
                      <tr key={person.id ?? index}>
                        <td>
                          <strong>{person.displayName || 'Nome indisponível'}</strong>
                          <small>{person.email || 'E-mail indisponível'}</small>
                        </td>
                        <td>
                          {person.monday?.displayName || 'Indisponível'}
                          <small>
                            ID externo: {person.monday?.externalId || '—'}
                            {person.monday?.isActive === false ? ' · Inativo' : ''}
                          </small>
                        </td>
                        <td>
                          {person.vrMais?.displayName || 'Indisponível'}
                          <small>
                            ID externo: {person.vrMais?.externalId || '—'}
                            {person.vrMais?.isActive === false ? ' · Inativo' : ''}
                          </small>
                        </td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {person.invitationExpiresAt && (
                            <small>Validade: {timestamp(person.invitationExpiresAt)}</small>
                          )}
                        </td>
                        <td>
                          <button className="text-button" onClick={() => onHistory(person)}>
                            Ver histórico <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
        {list.data && (
          <Pagination page={page} total={list.data.total ?? 0} size={12} onPage={setPage} />
        )}
      </div>
      <p className="page-footnote">
        Horários em São Paulo. Convite pendente indica aceite ainda não registrado; não confirma
        entrega do e-mail.
      </p>
    </>
  )
}
