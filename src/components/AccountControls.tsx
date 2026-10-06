import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'

/** Presentation only: session and logout failures remain owned by the shell. */
export function AccountControls({
  displayName,
  fallbackName,
  fallbackInitial,
  roleLabel,
  pending,
  onLogout,
  children,
}: {
  displayName?: string | null
  fallbackName: string
  fallbackInitial: string
  roleLabel: string
  pending: boolean
  onLogout(): void
  children?: ReactNode
}) {
  return (
    <div className="admin-account">
      {children}
      <span className="avatar">
        {displayName?.slice(0, 1).toUpperCase() || fallbackInitial}
      </span>
      <div>
        <strong>{displayName || fallbackName}</strong>
        <span>{roleLabel}</span>
      </div>
      <button
        className="icon-button"
        aria-label="Sair da conta"
        title="Sair da conta"
        disabled={pending}
        onClick={onLogout}
      >
        <LogOut size={19} />
      </button>
    </div>
  )
}
