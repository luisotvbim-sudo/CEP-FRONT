import type { ReactNode } from "react";
import { ApiError, getErrorMessage } from "../api/client";
import { AlertIcon, DatabaseIcon } from "./Icons";

export function LoadingBlock({ label = "Carregando dados…" }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><DatabaseIcon size={24} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const correlationId = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <div className="error-panel" role="alert">
      <AlertIcon size={20} />
      <div>
        <strong>{getErrorMessage(error)}</strong>
        {correlationId && (
          <p>
            Código para suporte: <code>{correlationId}</code>
          </p>
        )}
      </div>
      {onRetry && <button className="button button--small button--ghost" onClick={onRetry}>Tentar novamente</button>}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const normalized = ["succeeded", "completed", "active"].includes(status)
    ? "success"
    : ["partiallySucceeded", "pending", "running"].includes(status)
      ? "warning"
      : ["failed", "expired", "inactive"].includes(status)
        ? "danger"
        : "neutral";
  return <span className={`status-badge status-badge--${normalized}`}><i aria-hidden="true" />{label}</span>;
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange(page: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginação">
      <button className="button button--small button--ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
      <span>Página {page} de {pages}</span>
      <button className="button button--small button--ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</button>
    </nav>
  );
}
