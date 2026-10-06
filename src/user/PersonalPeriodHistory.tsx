import type { AuthError } from '../auth/auth-client'
import type { AdminApi } from '../admin/api'
import { DailyHistory } from '../admin/DailyHistory'
import { date, timestamp } from '../admin/format'
import { Empty, Loading, QueryError } from '../admin/ui'
import { useQuery } from '../hooks/async'

function PeriodRecords({
  api,
  personId,
  from,
  to,
}: {
  api: AdminApi
  personId: string
  from: string
  to: string
}) {
  const history = useQuery(
    () => api.history({ from, to, workforcePersonId: personId }),
    [api, personId, from, to],
  )
  const person = history.data?.people?.find((entry) => entry.workforcePersonId === personId)
  const records = person?.records ?? []

  return (
    <>
      {history.pending && !history.data && <Loading text="Consultando registros importados…" />}
      <QueryError error={history.error} retry={history.reload} />
      {history.data && (
        <>
          <p className="muted">Consulta gerada em {timestamp(history.data.generatedAt)}.</p>
          {records.length ? (
            person && <DailyHistory key={`${from}:${to}`} person={person} source="" />
          ) : (
            <Empty title="Nenhum registro importado neste período">
              <p>Isso não significa zero horas. Confira a atualização das fontes em Meu histórico.</p>
            </Empty>
          )}
        </>
      )}
    </>
  )
}

export function PersonalPeriodHistory({
  api,
  personId,
  associationPending,
  associationError,
  retryAssociation,
  from,
  to,
}: {
  api: AdminApi
  personId?: string | null
  associationPending: boolean
  associationError: AuthError | null
  retryAssociation(): void
  from: string
  to: string
}) {
  return (
    <section className="admin-panel overview-history" aria-label="Histórico do período">
      <h2>Histórico do período</h2>
      <p className="muted">
        Registros importados de Monday e VR Mais de {date(from)} a {date(to)}. A conferência acima
        lê as fontes agora; este histórico pode ter outro horário de atualização.
      </p>
      {associationPending ? (
        <Loading text="Localizando sua associação…" />
      ) : associationError ? (
        <QueryError error={associationError} retry={retryAssociation} />
      ) : personId ? (
        <PeriodRecords api={api} personId={personId} from={from} to={to} />
      ) : (
        <Empty title="Seus registros ainda não estão disponíveis">
          <p>Não encontramos uma pessoa associada à sua conta. Peça ao coordenador para conferir.</p>
        </Empty>
      )}
    </section>
  )
}
