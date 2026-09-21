import type { WorkforceSync, WorkforceSyncSource } from "../model/types";
import { formatDate, formatDateTime, formatSource, formatSyncStatus } from "../formatters";
import { ClockIcon, DatabaseIcon, RefreshIcon } from "../../../components/Icons";
import { EmptyState, ErrorPanel, LoadingBlock, StatusBadge } from "../../../components/Feedback";

type Props = {
  latest: WorkforceSync | null;
  loading: boolean;
  error: unknown;
  syncing: boolean;
  onRetry(): void;
  onSynchronize(): void;
  onFullSync(): void;
};

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="source-metric"><strong>{value.toLocaleString("pt-BR")}</strong><span>{label}</span></div>;
}

function SourceCard({ source }: { source: WorkforceSyncSource }) {
  return (
    <article className="source-card">
      <div className="source-card__header">
        <span className={`source-logo source-logo--${source.source}`}>{source.source === "monday" ? "M" : "VR"}</span>
        <div><h3>{formatSource(source.source)}</h3><p>{source.completeSnapshot ? "Retrato completo" : "Atualização incremental"}</p></div>
        <StatusBadge status={source.status} label={formatSyncStatus(source.status)} />
      </div>
      <div className="coverage">
        <span>Cobertura da fonte</span>
        <strong>{source.coverageFrom && source.coverageTo ? `${formatDate(source.coverageFrom)} — ${formatDate(source.coverageTo)}` : "Ainda não informada"}</strong>
      </div>
      <div className="metrics-grid">
        <Metric value={source.receivedCount} label="identidades recebidas" />
        <Metric value={source.createdCount} label="novas identidades" />
        <Metric value={source.updatedCount} label="identidades atualizadas" />
        <Metric value={source.deactivatedCount} label="desativadas" />
      </div>
      <div className="record-strip">
        <DatabaseIcon size={18} />
        <span><strong>{source.timeRecordReceivedCount.toLocaleString("pt-BR")}</strong> registros recebidos</span>
        <span>{source.timeRecordCreatedCount} criados</span>
        <span>{source.timeRecordUpdatedCount} atualizados</span>
        <span>{source.timeRecordRemovedCount} removidos</span>
      </div>
      {source.errorMessage && <div className="inline-alert inline-alert--danger"><strong>{source.errorMessage}</strong>{source.errorCode && <small>Código: {source.errorCode}</small>}</div>}
      <footer>Início {formatDateTime(source.startedAt)} · Término {formatDateTime(source.completedAt)}</footer>
    </article>
  );
}

export function OverviewTab({ latest, loading, error, syncing, onRetry, onSynchronize, onFullSync }: Props) {
  if (loading) return <LoadingBlock label="Consultando a última sincronização…" />;
  if (error && !latest) return <ErrorPanel error={error} onRetry={onRetry} />;
  if (!latest) {
    return (
      <EmptyState
        title="Nenhuma sincronização executada"
        description="Inicie a primeira sincronização para importar os últimos 60 dias do Monday e do VR Mais."
        action={<button className="button button--primary" disabled={syncing} onClick={onSynchronize}><RefreshIcon size={18} /> Sincronizar agora</button>}
      />
    );
  }

  return (
    <div className="overview-stack">
      {error !== null && <ErrorPanel error={error} onRetry={onRetry} />}
      <section className="sync-summary card">
        <div className="sync-summary__status">
          <span className={`summary-icon summary-icon--${latest.status}`}><ClockIcon size={24} /></span>
          <div>
            <span className="section-kicker">Última sincronização</span>
            <h2>{formatSyncStatus(latest.status)}</h2>
            <p>Iniciada em {formatDateTime(latest.startedAt)}{latest.completedAt ? ` · concluída em ${formatDateTime(latest.completedAt)}` : ""}</p>
          </div>
        </div>
        <div className="sync-summary__actions">
          <StatusBadge status={latest.status} label={formatSyncStatus(latest.status)} />
          <button className="button button--ghost" disabled={syncing || latest.status === "running"} onClick={onFullSync}>Reprocessar últimos 60 dias</button>
        </div>
      </section>

      {latest.status === "partiallySucceeded" && (
        <div className="inline-alert inline-alert--warning" role="alert"><strong>A sincronização terminou parcialmente.</strong><span>Consulte os cartões abaixo para identificar qual fonte precisa de atenção.</span></div>
      )}

      <section className="source-grid" aria-label="Resultados por fonte">
        {(latest.sources ?? []).map((source) => <SourceCard key={source.source} source={source} />)}
      </section>
    </div>
  );
}
