import { useState } from 'react'
import { AdminApi } from '../admin/api'
import { NotificationApi, periodLabels, type Period } from './api'
import { AnalysisDetails } from './AnalysisDetails'
import { issueLabels } from './labels'
import { timestamp } from '../admin/format'
import { Empty, Loading, PageHeading, Pagination, QueryError } from '../admin/ui'
import { useQuery } from '../hooks/async'

export function Analyses({
  api,
  peopleApi,
  ownUserId,
}: {
  api: NotificationApi
  peopleApi: AdminApi
  ownUserId?: string
}) {
  const [period, setPeriod] = useState<Period>('daily')
  const [personId, setPersonId] = useState('')
  const [day, setDay] = useState('')
  const [issue, setIssue] = useState('')
  const [page, setPage] = useState(1)
  const people = useQuery(() => peopleApi.visiblePeople(), [peopleApi])
  const own = people.data?.find((person) => person.userId === ownUserId)
  const result = useQuery(
    async () =>
      ownUserId && !own?.id
        ? { items: [], total: 0 }
        : api.reports(period, page, ownUserId ? own?.id : personId, day, issue),
    [api, period, page, personId, ownUserId, own?.id, day, issue],
  )
  return (
    <>
      <PageHeading
        title={ownUserId ? 'Minha análise' : 'Análises e relatórios de erros'}
        description="Resultados calculados pelo backend, com corte e qualidade das fontes. Esta consulta não executa uma nova importação."
        action={
          <button className="secondary-button" onClick={result.reload}>
            Atualizar consulta
          </button>
        }
      />
      <section className="admin-panel notification-form analysis-reports">
        <label>
          Período
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as Period)
              setPage(1)
            }}
          >
            {Object.entries(periodLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!ownUserId && (
          <label>
            Pessoa
            <select
              value={personId}
              onChange={(e) => {
                setPersonId(e.target.value)
                setPage(1)
              }}
            >
              <option value="">Todas do escopo</option>
              {people.data?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Dia da ocorrência (opcional)
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <label>
          Tipo de ocorrência
          <select
            value={issue}
            onChange={(e) => {
              setIssue(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Todos</option>
            {Object.entries(issueLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <QueryError error={people.error} retry={people.reload} />
        <QueryError error={result.error} retry={result.reload} />
        {people.pending || result.pending ? (
          <Loading />
        ) : (
          result.data?.items?.map((row) => (
            <article key={row.id}>
              <h2>{row.displayName}</h2>
              <p>Gerado em {timestamp(row.createdAt)}</p>
              <AnalysisDetails value={row.analysis} />
            </article>
          ))
        )}
        {!people.pending && !result.pending && result.data?.total === 0 && (
          <Empty title="Nenhuma análise disponível">
            <p>
              O processamento diário e os envios geram análises. Ausência de resultado não significa
              horas corretas ou zero horas.
            </p>
          </Empty>
        )}
        <Pagination
          page={page}
          total={result.data?.total ?? 0}
          size={20}
          onPage={setPage}
          pending={result.pending}
        />
      </section>
    </>
  )
}
