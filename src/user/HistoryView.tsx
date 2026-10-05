import type { AdminApi, Person, Source } from '../admin/api'
import { DailyHistory } from '../admin/DailyHistory'
import { useHistory } from '../admin/useHistory'
import { date, timestamp } from '../admin/format'
import { Empty, Loading, PageHeading } from '../admin/ui'
import { FormNotice } from '../components/FormNotice'

export function HistoryView({
  api,
  person,
  title,
  nested = false,
}: {
  api: AdminApi
  person: Person
  title: string
  nested?: boolean
}) {
  const {
    from,
    setFrom,
    to,
    setTo,
    source,
    setSource,
    result,
    validation,
    action,
    changed: change,
    submit,
  } = useHistory(api)
  const entry = result?.people?.find((value) => value.workforcePersonId === person.id)
  const records = entry?.records ?? []
  return (
    <>
      <PageHeading
        eyebrow="JORNADA"
        level={nested ? 'h2' : 'h1'}
        title={title}
        description="Totais importados por dia. Expanda uma data para conferir as atividades e os registros de ponto."
      />
      <div className="admin-panel history-filters">
        <h2>{person.displayName || person.email || 'Pessoa associada'}</h2>
        <p className="muted">{person.email || 'E-mail indisponível'}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (person.id) submit(person.id)
          }}
        >
          <fieldset className="unframed" disabled={action.pending}>
            <div className="form-grid history-fields">
              <div>
                <label htmlFor="user-history-from">De</label>
                <input
                  id="user-history-from"
                  type="date"
                  required
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value)
                    change()
                  }}
                />
              </div>
              <div>
                <label htmlFor="user-history-to">Até</label>
                <input
                  id="user-history-to"
                  type="date"
                  required
                  min={from}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value)
                    change()
                  }}
                />
              </div>
              <div>
                <label htmlFor="user-history-source">Fonte</label>
                <select
                  id="user-history-source"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as Source | '')
                    change()
                  }}
                >
                  <option value="">Todas as fontes</option>
                  <option value="monday">Monday</option>
                  <option value="vrMais">VR Mais</option>
                </select>
              </div>
              <button className="primary-button compact" type="submit">
                {action.pending ? 'Consultando…' : 'Consultar histórico'}
              </button>
            </div>
          </fieldset>
          <p className="muted">
            Até 90 dias inclusivos. A atualização normal recarrega somente os últimos 7 dias.
          </p>
          <FormNotice error={validation || action.error} />
        </form>
      </div>
      {action.pending ? (
        <Loading text="Consultando registros…" />
      ) : !result ? (
        <div className="admin-panel">
          <Empty title="Escolha o período da consulta">
            <p>Os dados exibidos respeitam o acesso vigente no servidor.</p>
          </Empty>
        </div>
      ) : (
        <>
          <div className="history-summary">
            <span>
              {date(result.from)} a {date(result.to)}
            </span>
            <span>Consulta gerada em {timestamp(result.generatedAt)}</span>
          </div>
          {records.length === 0 ? (
            <div className="admin-panel">
              <Empty title="Nenhum registro importado neste período">
                <p>
                  Isso não significa zero horas. Confira a associação e a atualização das fontes.
                </p>
              </Empty>
            </div>
          ) : (
            <section className="admin-panel">
              <h2>Registros de {entry?.displayName || person.displayName || 'pessoa associada'}</h2>
              {entry && <DailyHistory person={entry} source={source} />}
            </section>
          )}
          <p className="page-footnote">
            Duração indisponível não foi convertida em zero. Não há conclusão trabalhista ou
            comparação oficial nesta consulta.
          </p>
        </>
      )}
    </>
  )
}
