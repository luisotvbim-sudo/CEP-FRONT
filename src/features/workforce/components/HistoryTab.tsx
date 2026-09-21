import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { HistoryQuery, WorkforceAdminHistory, WorkforcePerson } from "../model/types";
import { workforceApi } from "../api/workforceApi";
import { formatDate, formatDateTime, formatDuration, formatSource, isHttpsUrl, recentPeriod, validateHistoryPeriod } from "../formatters";
import { ExternalLinkIcon, SearchIcon } from "../../../components/Icons";
import { EmptyState, ErrorPanel, LoadingBlock, StatusBadge } from "../../../components/Feedback";

type Props = { refreshKey: number };

function DetailsJson({ value }: { value: string | null }) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return null;
    return <details className="json-details"><summary>Dados da fonte</summary><pre>{JSON.stringify(parsed, null, 2)}</pre></details>;
  } catch {
    return <small className="muted">Detalhes da fonte indisponíveis.</small>;
  }
}

export function HistoryTab({ refreshKey }: Props) {
  const initialPeriod = recentPeriod(7);
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [personId, setPersonId] = useState("");
  const [source, setSource] = useState<"" | "monday" | "vrMais">("");
  const [search, setSearch] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<HistoryQuery>(initialPeriod);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [data, setData] = useState<WorkforceAdminHistory | null>(null);
  const [people, setPeople] = useState<WorkforcePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const loadHistory = useCallback(async (query: HistoryQuery, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await workforceApi.history(query, signal);
      setData(result);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(submittedQuery, controller.signal);
    return () => controller.abort();
  }, [loadHistory, refreshKey, submittedQuery]);

  useEffect(() => {
    const controller = new AbortController();
    workforceApi.people({ page: 1, pageSize: 200 }, controller.signal)
      .then((result) => setPeople(result.items ?? []))
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setPeople([]);
      });
    return () => controller.abort();
  }, [refreshKey]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = validateHistoryPeriod(from, to);
    setValidationError(message);
    if (message) return;
    setSubmittedQuery({
      from,
      to,
      workforcePersonId: personId || undefined,
      source: source || undefined,
      search: search.trim() || undefined,
    });
  }

  const historyPeople = data?.people ?? [];

  return (
    <section className="history-section" aria-labelledby="history-title">
      <div className="section-heading">
        <div><span className="section-kicker">Registros persistidos</span><h2 id="history-title">Histórico bruto</h2><p>Consulte até 60 dias. Estes dados não representam cálculo trabalhista.</p></div>
        {data && <small className="generated-at">Gerado em {formatDateTime(data.generatedAt)}</small>}
      </div>

      <form className="filter-card" onSubmit={submit}>
        <label className="field"><span>De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
        <label className="field"><span>Até</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        <label className="field"><span>Pessoa</span><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Todas as pessoas</option>{people.map((person) => <option key={person.id} value={person.id}>{person.displayName || person.email || person.id}</option>)}</select></label>
        <label className="field"><span>Fonte</span><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="">Todas</option><option value="monday">Monday</option><option value="vrMais">VR Mais</option></select></label>
        <label className="field filter-card__search"><span>Nome ou e-mail</span><div className="input-with-icon"><SearchIcon size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pessoa" /></div></label>
        <button className="button button--primary" disabled={loading} type="submit">Consultar</button>
        {validationError && <div className="field-error" role="alert">{validationError}</div>}
      </form>

      {error !== null && !data && <ErrorPanel error={error} onRetry={() => void loadHistory(submittedQuery)} />}
      {loading && !data && <LoadingBlock label="Consultando histórico…" />}
      {error !== null && data && <ErrorPanel error={error} onRetry={() => void loadHistory(submittedQuery)} />}

      {!loading && !error && historyPeople.length === 0 ? (
        <EmptyState title="Nenhum registro no período" description="Não foram encontrados registros para os filtros informados. Ajuste o período ou sincronize as fontes." />
      ) : (
        <div className="history-groups">
          {historyPeople.map((person) => (
            <article className="history-person card" key={person.workforcePersonId}>
              <header>
                <div className="person-cell"><span className="avatar avatar--small">{(person.displayName || "?").slice(0, 1).toUpperCase()}</span><span><strong>{person.displayName || "Nome não informado"}</strong><small>{person.email || "E-mail não informado"}</small></span></div>
                <span className="count-pill">{(person.records ?? []).length} registros</span>
              </header>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Data</th><th>Fonte</th><th>Atividade / registro</th><th>Início</th><th>Fim</th><th>Duração</th><th>Estado</th><th>Sincronizado</th></tr></thead>
                  <tbody>
                    {(person.records ?? []).map((record) => (
                      <tr key={record.id}>
                        <td>{formatDate(record.workDate)}</td>
                        <td><span className={`source-tag source-tag--${record.source}`}>{formatSource(record.source)}</span></td>
                        <td className="record-title"><strong>{record.title || "Sem título"}</strong>{isHttpsUrl(record.url) && <a href={record.url!} target="_blank" rel="noreferrer">Abrir fonte <ExternalLinkIcon size={13} /></a>}<DetailsJson value={record.detailsJson} /></td>
                        <td>{formatDateTime(record.startedAt)}</td>
                        <td>{formatDateTime(record.endedAt)}</td>
                        <td><strong>{formatDuration(record.durationSeconds)}</strong></td>
                        <td><StatusBadge status="neutral" label={record.state || "Desconhecido"} /></td>
                        <td>{formatDateTime(record.lastSyncedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
