import { useCallback } from 'react'
import { useAction } from '../hooks/async'
import type { AuthClient } from './auth-client'

export function useLogout(client: Pick<AuthClient, 'logout'>, onLogout: () => void) {
  const { pending, error, run } = useAction()
  const logout = useCallback(() => {
    void run(async () => {
      await client.logout()
      onLogout()
    })
  }, [client, onLogout, run])
  return { pending, error, logout }
}
