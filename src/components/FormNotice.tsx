import { CircleAlert } from 'lucide-react'
import type { AuthError } from '../auth/auth-client'

export function FormNotice({ error }: { error: AuthError | null }) {
  if (!error) return null
  return (
    <div className="form-notice" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <div>
        {error.message}
        {error.correlationId && (
          <span className="support-code">Código para suporte: {error.correlationId}</span>
        )}
      </div>
    </div>
  )
}
