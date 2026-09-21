import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../../api/client";
import { GridIcon, HistoryIcon, LinkIcon, LogOutIcon, RefreshIcon, UsersIcon } from "../../../components/Icons";
import { useAuth } from "../../auth/AuthProvider";
import { workforceApi } from "../api/workforceApi";
import type { WorkforceSync } from "../model/types";
import { HistoryTab } from "../components/HistoryTab";
import { MatchingTab } from "../components/MatchingTab";
import { OverviewTab } from "../components/OverviewTab";
import { PeopleTab } from "../components/PeopleTab";

type TabId = "overview" | "matching" | "people" | "history";

const tabs = [
  { id: "overview" as const, label: "Visão geral", icon: GridIcon },
  { id: "matching" as const, label: "Correspondências", icon: LinkIcon },
  { id: "people" as const, label: "Pessoas", icon: UsersIcon },
  { id: "history" as const, label: "Histórico", icon: HistoryIcon },
];

export function AdminWorkforcePage() {
  const { session, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [latest, setLatest] = useState<WorkforceSync | null>(null);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState<unknown>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLatest = useCallback(async (signal?: AbortSignal) => {
    try {
      const value = await workforceApi.latestSynchronization(signal);
      setLatest(value);
      setLatestError(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof ApiError && error.status === 404 && error.code === "sync_not_found") {
        setLatest(null);
        setLatestError(null);
      } else {
        setLatestError(error);
      }
    } finally {
      if (!signal?.aborted) setLatestLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLatest(controller.signal);
    return () => controller.abort();
  }, [loadLatest]);

  useEffect(() => {
    if (latest?.status !== "running") return;
    const controller = new AbortController();
    const interval = window.setInterval(async () => {
      try {
        const value = await workforceApi.synchronization(latest.id, controller.signal);
        setLatest(value);
        if (value.status !== "running") {
          setRefreshKey((key) => key + 1);
          setNotice("Sincronização concluída. Os dados das abas foram atualizados.");
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLatestError(error);
      }
    }, 2_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [latest?.id, latest?.status]);

  async function handleSynchronize(full = false) {
    if (full && !window.confirm("Reprocessar os últimos 60 dias? Esta operação pode consumir mais tempo e chamadas externas.")) return;
    setSyncing(true);
    setNotice(null);
    try {
      const value = await workforceApi.synchronize(full);
      setLatest(value);
      setLatestError(null);
      setRefreshKey((key) => key + 1);
      setNotice(full ? "Reprocessamento concluído." : "Sincronização concluída.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === "sync_already_running") {
        setNotice("Já existe uma sincronização em andamento. O progresso foi carregado.");
        await loadLatest();
      } else {
        setLatestError(error);
      }
    } finally {
      setSyncing(false);
    }
  }

  const initials = (session?.user.displayName || session?.user.email || "AD")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="admin-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><span>C</span></span>
          <span><strong>CEP</strong><small>Horas</small></span>
        </div>
        <div className="topbar__context">
          <span>Administração</span><i aria-hidden="true" /> <strong>Integrações e pessoas</strong>
        </div>
        <div className="user-menu">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="user-menu__copy"><strong>{session?.user.displayName || "Administrador"}</strong><small>Administrador da organização</small></span>
          <button className="icon-button" title="Sair" aria-label="Sair" onClick={() => void logout()}><LogOutIcon /></button>
        </div>
      </header>

      <main className="admin-main">
        <section className="page-heading">
          <div>
            <span className="eyebrow">Controle de ponto</span>
            <h1>Integrações e pessoas</h1>
            <p>Sincronize as fontes, confirme correspondências e acompanhe os dados da sua organização.</p>
          </div>
          {activeTab !== "history" && (
            <button className="button button--primary" disabled={syncing || latest?.status === "running"} onClick={() => void handleSynchronize(false)}>
              {syncing || latest?.status === "running" ? <><span className="spinner spinner--light" /> Sincronizando…</> : <><RefreshIcon size={18} /> Sincronizar agora</>}
            </button>
          )}
        </section>

        {notice && <div className="notice" role="status">{notice}<button aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}

        <nav className="tabs" aria-label="Seções administrativas">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeTab === id ? "is-active" : ""} aria-current={activeTab === id ? "page" : undefined} onClick={() => setActiveTab(id)}>
              <Icon size={18} />{label}
            </button>
          ))}
        </nav>

        <div className="tab-content">
          {activeTab === "overview" && (
            <OverviewTab
              latest={latest}
              loading={latestLoading}
              error={latestError}
              syncing={syncing}
              onRetry={() => void loadLatest()}
              onSynchronize={() => void handleSynchronize(false)}
              onFullSync={() => void handleSynchronize(true)}
            />
          )}
          {activeTab === "matching" && <MatchingTab refreshKey={refreshKey} onInvited={(message) => { setNotice(message); setRefreshKey((key) => key + 1); }} />}
          {activeTab === "people" && <PeopleTab refreshKey={refreshKey} onNotice={setNotice} />}
          {activeTab === "history" && <HistoryTab refreshKey={refreshKey} />}
        </div>
      </main>

      <div className="sr-only" aria-live="polite">{notice}</div>
    </div>
  );
}
