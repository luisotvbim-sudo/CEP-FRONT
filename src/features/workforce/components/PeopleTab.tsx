import { useCallback, useEffect, useState } from "react";
import type { PagedResponse, WorkforcePerson } from "../model/types";
import { workforceApi } from "../api/workforceApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { formatDateTime, invitationState, invitationStateLabel } from "../formatters";
import { ChevronIcon, SearchIcon } from "../../../components/Icons";
import { EmptyState, ErrorPanel, LoadingBlock, Pagination, StatusBadge } from "../../../components/Feedback";

type Props = { refreshKey: number; onNotice(message: string): void };

export function PeopleTab({ refreshKey, onNotice }: Props) {
  const [data, setData] = useState<PagedResponse<WorkforcePerson> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const debouncedSearch = useDebouncedValue(search);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await workforceApi.people({ search: debouncedSearch, page, pageSize: 50 }, signal);
      setData(result);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, localRefresh, refreshKey]);

  async function resend(person: WorkforcePerson) {
    if (!person.invitationId) return;
    if (!window.confirm(`Reenviar o convite para ${person.email || "esta pessoa"}?`)) return;
    setResending(person.id);
    try {
      await workforceApi.resendInvitation(person.invitationId);
      onNotice("Convite reenviado com sucesso.");
      setLocalRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setResending(null);
    }
  }

  const people = data?.items ?? [];

  return (
    <section className="people-section" aria-labelledby="people-title">
      <div className="section-heading">
        <div><span className="section-kicker">Cadastros associados</span><h2 id="people-title">Pessoas</h2><p>Acompanhe identidades vinculadas, contas e convites.</p></div>
        <label className="search-field search-field--wide"><SearchIcon size={17} /><span className="sr-only">Buscar pessoas</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por nome ou e-mail" /></label>
      </div>

      {error !== null && !data && <ErrorPanel error={error} onRetry={() => void load()} />}
      {loading && !data && <LoadingBlock label="Carregando pessoas…" />}
      {error !== null && data && <ErrorPanel error={error} onRetry={() => void load()} />}

      {!loading && !error && people.length === 0 ? (
        <EmptyState title={search ? "Nenhuma pessoa encontrada" : "Nenhuma pessoa associada"} description={search ? "Tente buscar por outro nome ou e-mail." : "As pessoas aparecerão aqui depois que uma correspondência for confirmada e o convite enviado."} />
      ) : data && (
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Pessoa</th><th>Monday</th><th>VR Mais</th><th>Convite</th><th>Criado em</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {people.map((person) => {
                  const state = invitationState(person);
                  const isExpanded = expanded === person.id;
                  return [
                    <tr key={person.id} className={isExpanded ? "is-expanded" : ""}>
                      <td><div className="person-cell"><span className="avatar avatar--small">{(person.displayName || "?").slice(0, 1).toUpperCase()}</span><span><strong>{person.displayName || "Nome não informado"}</strong><small>{person.email || "E-mail não informado"}</small></span></div></td>
                      <td><strong>{person.monday.displayName || "—"}</strong><small className="table-subline">{person.monday.externalId || "Sem ID externo"}</small></td>
                      <td><strong>{person.vrMais.displayName || "—"}</strong><small className="table-subline">{person.vrMais.externalId || "Sem ID externo"}</small></td>
                      <td><StatusBadge status={state} label={invitationStateLabel(state)} /></td>
                      <td>{formatDateTime(person.createdAt)}</td>
                      <td><button className="button button--small button--ghost details-button" onClick={() => setExpanded(isExpanded ? null : person.id)} aria-expanded={isExpanded}>Detalhes <ChevronIcon size={15} /></button></td>
                    </tr>,
                    isExpanded && (
                      <tr className="details-row" key={`${person.id}-details`}>
                        <td colSpan={6}>
                          <div className="person-details">
                            <dl>
                              <div><dt>ID interno</dt><dd>{person.id}</dd></div>
                              <div><dt>Conta</dt><dd>{person.userId ? `Ativa · ${person.userId}` : "Ainda não criada"}</dd></div>
                              <div><dt>Convite expira</dt><dd>{formatDateTime(person.invitationExpiresAt)}</dd></div>
                              <div><dt>Convite aceito</dt><dd>{formatDateTime(person.invitationAcceptedAt)}</dd></div>
                              <div><dt>Última atualização</dt><dd>{formatDateTime(person.updatedAt)}</dd></div>
                            </dl>
                            {state === "expired" && person.invitationId && <button className="button button--secondary" disabled={resending === person.id} onClick={() => void resend(person)}>{resending === person.id ? "Reenviando…" : "Reenviar convite"}</button>}
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </div>
      )}
    </section>
  );
}
