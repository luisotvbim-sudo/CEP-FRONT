import { useState } from 'react'
import { useQuery } from '../hooks/async'
import { type AdminApi, type Assignment, type Person, type Team } from '../admin/api'
import { today } from '../admin/format'
import { Empty, Loading, QueryError } from '../admin/ui'
import { HistoryView } from './HistoryView'

export function TeamHistory({ api, team, people }: { api: AdminApi; team: Team; people: Person[] }) {
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
        <HistoryView
          key={selected.id}
          api={api}
          person={selected}
          title="Histórico da pessoa"
          nested
        />
      )}
    </>
  )
}
