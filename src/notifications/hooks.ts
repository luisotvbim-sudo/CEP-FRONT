import { useEffect, useMemo, useRef } from 'react'
import type { AuthClient } from '../auth/auth-client'
import { NotificationApi } from './api'

export function useNotificationApi(client: AuthClient, organizationId?: string) {
  return useMemo(() => new NotificationApi(client, organizationId), [client, organizationId])
}
export function useOpenInbox(open: () => void) {
  const callback = useRef(open)
  callback.current = open
  useEffect(() => {
    const listener = () => {
      callback.current()
    }
    window.addEventListener('cep-open-notifications', listener)
    if (window.__CEP_INBOX_INTENT__) listener()
    return () => window.removeEventListener('cep-open-notifications', listener)
  }, [])
}
