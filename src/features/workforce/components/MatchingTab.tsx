import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExternalWorkforceIdentity, PagedResponse, WorkforceSource } from "../model/types";
import { workforceApi } from "../api/workforceApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { formatDateTime, formatSource } from "../formatters";
import { ApiError, getErrorMessage } from "../../../api/client";
import { CheckIcon, LinkIcon, SearchIcon } from "../../../components/Icons";
import { EmptyState, ErrorPanel, LoadingBlock, Pagination, StatusBadge } from "../../../components/Feedback";

type Props = { refreshKey: number; onInvited(message: string): void };
type SourceState = { data: PagedResponse<ExternalWorkforceIdentity> | null; loading: boolean; error: unknown };

const initialSourceState: SourceState = { data: null, loading: true, error: null };

const businessMessages: Record<string, string> = {
  external_identities_required: "Selecione uma pessoa no Monday e outra no VR Mais.",
  invalid_display_name: "Informe o nome da pessoa.",
  email_domain_not_allowed: "O domínio deste e-mail não está autorizado.",
  external_identity_not_found: "Uma das identidades não está mais disponível. Atualize a lista.",
  external_identity_inactive: "Uma das identidades está inativa. Sincronize novamente.",
  external_identity_already_mapped: "Uma das identidades já foi associada por outro administrador.",
  email_unavailable: "Este e-mail já possui usuário ou convite pendente.",
};

function IdentityList({
  source,
  state,
  selected,
  search,
  page,
  onSearch,
  onPage,
  onSelect,
  onRetry,
}: {
  source: WorkforceSource;
  state: SourceState;
  selected: ExternalWorkforceIdentity | null;
  search: string;
  page: number;
  onSearch(value: string): void;
  onPage(page: number): void;
  onSelect(identity: ExternalWorkforceIdentity): void;
  onRetry(): void;
}) {
  const items = state.data?.items ?? [];
  return (
    <section className="identity-panel" aria-labelledby={`${source}-title`}>
      <header className="identity-panel__header">
        <span className={`source-logo source-logo--${source}`}>{source === "monday" ? "M" : "VR"}</span>
        <div><h2 id={`${source}-title`}>{formatSource(source)}</h2><p>Identidades ainda não associadas</p></div>
        {state.data && <span className="count-pill">{state.data.total}</span>}
      </header>
      <label className="search-field">
        <SearchIcon size={17} />
        <span className="sr-only">Buscar no {formatSource(source)}</span>
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por nome, e-mail ou ID" />
      </label>
      <div className="identity-list">
        {state.loading && !state.data && <LoadingBlock label={`Carregando ${formatSource(source)}…`} />}
        {state.error !== null && !state.data && <ErrorPanel error={state.error} onRetry={onRetry} />}
        {!state.loading && !state.error && items.length === 0 && (
          <EmptyState title={search ? "Nenhum resultado" : "Tudo associado"} description={search ? "Tente outro nome, e-mail ou identificador." : `Não há identidades pendentes no ${formatSource(source)}.`} />
        )}
        {state.error !== null && state.data && <ErrorPanel error={state.error} onRetry={onRetry} />}
        {items.map((identity) => {
          const isSelected = selected?.id === identity.id;
          return (
            <button key={identity.id} type="button" className={`identity-item ${isSelected ? "is-selected" : ""}`} onClick={() => onSelect(identity)} aria-pressed={isSelected}>
              <span className="identity-item__avatar">{(identity.displayName || "?").slice(0, 1).toUpperCase()}</span>
              <span className="identity-item__copy">
                <strong>{identity.displayName || "Nome não informado"}</strong>
                <span>{identity.email || "E-mail não informado"}</span>
                <small>ID externo: {identity.externalId || "—"} · visto {formatDateTime(identity.lastSeenAt)}</small>
              </span>
              <span className="identity-item__check" aria-hidden="true">{isSelected && <CheckIcon size={16} />}</span>
            </button>
          );
        })}
      </div>
      {state.data && <Pagination page={page} pageSize={state.data.pageSize} total={state.data.total} onChange={onPage} />}
    </section>
  );
}

export function MatchingTab({ refreshKey, onInvited }: Props) {
  const [monday, setMonday] = useState<SourceState>(initialSourceState);
  const [vrMais, setVrMais] = useState<SourceState>(initialSourceState);
  const [mondaySearch, setMondaySearch] = useState("");
  const [vrSearch, setVrSearch] = useState("");
  const [mondayPage, setMondayPage] = useState(1);
  const [vrPage, setVrPage] = useState(1);
  const [selectedMonday, setSelectedMonday] = useState<ExternalWorkforceIdentity | null>(null);
  const [selectedVr, setSelectedVr] = useState<ExternalWorkforceIdentity | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<unknown>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const debouncedMondaySearch = useDebouncedValue(mondaySearch);
  const debouncedVrSearch = useDebouncedValue(vrSearch);

  const loadSource = useCallback(async (
    source: WorkforceSource,
    search: string,
    page: number,
    signal?: AbortSignal,
  ) => {
    const setter = source === "monday" ? setMonday : setVrMais;
    setter((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await workforceApi.identities({ source, activeOnly: true, mapped: false, search, page, pageSize: 50 }, signal);
      setter({ data, loading: false, error: null });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setter((current) => ({ ...current, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSource("monday", debouncedMondaySearch, mondayPage, controller.signal);
    return () => controller.abort();
  }, [debouncedMondaySearch, loadSource, localRefresh, mondayPage, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSource("vrMais", debouncedVrSearch, vrPage, controller.signal);
    return () => controller.abort();
  }, [debouncedVrSearch, loadSource, localRefresh, refreshKey, vrPage]);

  const divergence = useMemo(() => ({
    name: Boolean(selectedMonday?.displayName && selectedVr?.displayName && selectedMonday.displayName.localeCompare(selectedVr.displayName, "pt-BR", { sensitivity: "base" }) !== 0),
    email: Boolean(selectedMonday?.email && selectedVr?.email && selectedMonday.email.toLowerCase() !== selectedVr.email.toLowerCase()),
  }), [selectedMonday, selectedVr]);

  function selectIdentity(identity: ExternalWorkforceIdentity) {
    const nextMonday = identity.source === "monday" ? identity : selectedMonday;
    const nextVr = identity.source === "vrMais" ? identity : selectedVr;
    if (identity.source === "monday") setSelectedMonday(identity);
    else setSelectedVr(identity);
    setDisplayName(nextMonday?.displayName || nextVr?.displayName || "");
    setEmail(nextMonday?.email || nextVr?.email || "");
    setInviteError(null);
  }

  async function invite() {
    if (!selectedMonday || !selectedVr || !displayName.trim() || !email.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      await workforceApi.invite({
        email: email.trim(),
        displayName: displayName.trim(),
        mondayIdentityId: selectedMonday.id,
        vrMaisIdentityId: selectedVr.id,
      });
      setSelectedMonday(null);
      setSelectedVr(null);
      setDisplayName("");
      setEmail("");
      setLocalRefresh((value) => value + 1);
      onInvited("Pessoa associada e convite enviado com sucesso.");
    } catch (error) {
      setInviteError(error);
      if (error instanceof ApiError && ["external_identity_not_found", "external_identity_inactive", "external_identity_already_mapped"].includes(error.code ?? "")) {
        setLocalRefresh((value) => value + 1);
      }
    } finally {
      setInviting(false);
    }
  }

  const inviteMessage = inviteError instanceof ApiError && inviteError.code
    ? businessMessages[inviteError.code] ?? getErrorMessage(inviteError)
    : inviteError ? getErrorMessage(inviteError) : null;

  return (
    <div className="matching-layout">
      <div className="matching-intro">
        <div><span className="section-kicker">Correspondência manual</span><h2>Selecione uma identidade de cada fonte</h2><p>O sistema nunca associa pessoas automaticamente por nome ou e-mail.</p></div>
        <StatusBadge status="neutral" label="Confirmação humana obrigatória" />
      </div>

      <div className="identity-columns">
        <IdentityList
          source="monday" state={monday} selected={selectedMonday} search={mondaySearch} page={mondayPage}
          onSearch={(value) => { setMondaySearch(value); setMondayPage(1); }} onPage={setMondayPage} onSelect={selectIdentity}
          onRetry={() => void loadSource("monday", debouncedMondaySearch, mondayPage)}
        />
        <div className="match-connector" aria-hidden="true"><LinkIcon /></div>
        <IdentityList
          source="vrMais" state={vrMais} selected={selectedVr} search={vrSearch} page={vrPage}
          onSearch={(value) => { setVrSearch(value); setVrPage(1); }} onPage={setVrPage} onSelect={selectIdentity}
          onRetry={() => void loadSource("vrMais", debouncedVrSearch, vrPage)}
        />
      </div>

      <section className={`confirmation-panel ${selectedMonday && selectedVr ? "is-ready" : ""}`} aria-labelledby="confirmation-title">
        <div className="confirmation-panel__heading">
          <span className="confirmation-icon"><LinkIcon /></span>
          <div><span className="section-kicker">Etapa final</span><h2 id="confirmation-title">Confirmar associação e convite</h2><p>Revise as identidades e ajuste os dados sugeridos antes de continuar.</p></div>
        </div>

        {!selectedMonday || !selectedVr ? (
          <div className="selection-placeholder"><span>1</span> Selecione uma identidade em cada lista para habilitar a confirmação.</div>
        ) : (
          <div className="confirmation-grid">
            <div className="selected-pair">
              {[selectedMonday, selectedVr].map((identity) => (
                <article key={identity.id}>
                  <span className={`source-logo source-logo--${identity.source}`}>{identity.source === "monday" ? "M" : "VR"}</span>
                  <div><small>{formatSource(identity.source)}</small><strong>{identity.displayName || "Nome não informado"}</strong><span>{identity.email || "E-mail não informado"}</span></div>
                </article>
              ))}
              {(divergence.name || divergence.email) && <div className="inline-alert inline-alert--warning"><strong>Dados divergentes</strong><span>Confirme manualmente {divergence.name && divergence.email ? "nome e e-mail" : divergence.name ? "o nome" : "o e-mail"} antes de enviar.</span></div>}
            </div>
            <form className="invite-form" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
              <label className="field"><span>Nome para o convite</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
              <label className="field"><span>E-mail para o convite</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              {inviteMessage && <div className="inline-alert inline-alert--danger" role="alert"><strong>{inviteMessage}</strong>{inviteError instanceof ApiError && inviteError.correlationId && <small>Suporte: {inviteError.correlationId}</small>}</div>}
              <button className="button button--primary button--wide" disabled={inviting || !displayName.trim() || !email.trim()} type="submit">
                {inviting ? <><span className="spinner spinner--light" /> Enviando convite…</> : "Associar e enviar convite"}
              </button>
              <small className="form-help">Serão enviados somente os IDs internos selecionados acima.</small>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
