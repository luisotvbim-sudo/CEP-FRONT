import { useState } from 'react'
import { Search } from 'lucide-react'
import { DailyHistory } from './DailyHistory'
import { AuthError } from '../auth/auth-client'
import { FormNotice } from '../components/FormNotice'
import type { AdminApi, History, Person, Source } from './api'
import { date, timestamp, today, validatePeriod } from './format'
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

export function HistoryPage({
  api,
  initialPerson,
}: {
  api: AdminApi
  initialPerson?: Person | null
}) {
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [source, setSource] = useState<Source | ''>('')
  const [person, setPerson] = useState<Person | null>(initialPerson || null)
  const [search, setSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [page, setPage] = useState(1)
  const [showPicker, setShowPicker] = useState(false)
  const [result, setResult] = useState<History | null>(null)
  const [validation, setValidation] = useState<AuthError | null>(null)
  const people = useQuery(() => api.people(search, page), [api, search, page])
  const action = useAction()
  function changed() {
    setResult(null)
    setValidation(null)
    action.clear()
  }
  return (
    <>
      <PageHeading
        title="Histórico"
        description="Consulte os totais importados por dia e expanda para conferir os registros de cada fonte."
      />
      <div className="admin-panel history-filters">
        <div className="panel-toolbar">
          <div>
            <h2>Pessoa consultada</h2>
            <p>
              {person
                ? `${person.displayName} · ${person.email}`
                : 'Todas as pessoas associadas da organização'}
            </p>
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={action.pending}
              onClick={() => setShowPicker(!showPicker)}
            >
              {showPicker ? 'Fechar seleção' : 'Selecionar pessoa'}
            </button>
            {person && (
              <button
                className="text-button"
                disabled={action.pending}
                onClick={() => {
                  setPerson(null)
                  changed()
                }}
              >
                Limpar pessoa
              </button>
            )}
          </div>
        </div>
        {showPicker && (
          <section aria-label="Selecionar pessoa do histórico" className="history-person-picker">
            <SearchBox
              label="Buscar pessoa do histórico"
              onSearch={(v) => {
                setSearch(v)
                setPage(1)
              }}
            />
            <QueryError error={people.error} retry={people.reload} />
            {people.pending ? (
              <Loading />
            ) : (
              !people.error &&
              (!people.data?.items?.length ? (
                <p>Nenhuma pessoa associada encontrada.</p>
              ) : (
                <div className="user-options">
                  {people.data.items.map((p, i) => (
                    <button
                      type="button"
                      className="person-choice"
                      key={p.id ?? i}
                      disabled={!p.id || action.pending}
                      onClick={() => {
                        setPerson(p)
                        setShowPicker(false)
                        changed()
                      }}
                    >
                      <strong>{p.displayName}</strong>
                      <small>{p.email}</small>
                    </button>
                  ))}
                </div>
              ))
            )}
            {people.data && (
              <Pagination page={page} total={people.data.total ?? 0} size={12} onPage={setPage} />
            )}
          </section>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const message = validatePeriod(from, to)
            setValidation(message ? new AuthError(message) : null)
            if (message) return
            setResult(null)
            void action.run(async () =>
              setResult(
                await api.history({
                  from,
                  to,
                  source: source || undefined,
                  workforcePersonId: person?.id,
                  search: historySearch.trim() || undefined,
                }),
              ),
            )
          }}
        >
          <fieldset className="unframed" disabled={action.pending}>
            <label htmlFor="history-search">Filtrar histórico por nome ou e-mail</label>
            <input
              id="history-search"
              type="search"
              value={historySearch}
              onChange={(e) => {
                setHistorySearch(e.target.value)
                changed()
              }}
            />
            <div className="form-grid history-fields">
              <div>
                <label htmlFor="history-from">De</label>
                <input
                  id="history-from"
                  type="date"
                  required
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value)
                    changed()
                  }}
                />
              </div>
              <div>
                <label htmlFor="history-to">Até</label>
                <input
                  id="history-to"
                  type="date"
                  required
                  min={from}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value)
                    changed()
                  }}
                />
              </div>
              <div>
                <label htmlFor="history-source">Fonte</label>
                <select
                  id="history-source"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as Source | '')
                    changed()
                  }}
                >
                  <option value="">Todas as fontes</option>
                  <option value="monday">Monday</option>
                  <option value="vrMais">VR Mais</option>
                </select>
              </div>
              <button className="primary-button compact" type="submit">
                <Search size={16} />
                {action.pending ? 'Consultando…' : 'Consultar histórico'}
              </button>
            </div>
          </fieldset>
          <p className="muted">
            Até 90 dias inclusivos. Datas e horários apresentados em São Paulo.
          </p>
          <FormNotice error={validation || action.error} />
        </form>
      </div>
      {action.pending ? (
        <Loading text="Consultando registros importados…" />
      ) : !result ? (
        <div className="admin-panel">
          <Empty title="Escolha o período da consulta">
            <p>Filtre por pessoa e fonte para inspecionar os registros disponíveis.</p>
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
          {!result.people?.some((p) => p.records?.length) && (
            <div className="admin-panel">
              <Empty title="Nenhum registro importado neste período">
                <p>
                  A ausência de registros não significa zero horas. Confira a cobertura e o
                  resultado da sincronização.
                </p>
              </Empty>
            </div>
          )}
          {result.people
            ?.filter((p) => p.records?.length)
            .map((p, i) => (
              <section className="admin-panel" key={p.workforcePersonId ?? i}>
                <div className="person-history-heading">
                  <div>
                    <h2>{p.displayName}</h2>
                    <p>{p.email}</p>
                  </div>
                  <Badge>{p.records?.length} registros</Badge>
                </div>
                <DailyHistory person={p} source={source} />
              </section>
            ))}
          <p className="page-footnote">
            Duração indisponível não foi convertida em zero. Os totais refletem os registros importados; não são saldo oficial. Não há
            justificativas ou aprovação nesta consulta.
          </p>
        </>
      )}
    </>
  )
}
