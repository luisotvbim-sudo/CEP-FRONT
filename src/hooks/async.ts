import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, type AuthError } from '../auth/auth-client'

export function useQuery<T>(load: () => Promise<T>, keys: unknown[]) {
  const [state, setState] = useState<{ data?: T; pending: boolean; error: AuthError | null }>({
    pending: true,
    error: null,
  })
  const [version, setVersion] = useState(0)
  const loader = useRef(load)
  loader.current = load
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  useEffect(() => {
    let active = true
    setState({ pending: true, error: null })
    const currentLoad = loader.current
    Promise.resolve()
      .then(() => {
        if (active) return currentLoad()
      })
      .then(
        (data) => {
          if (active) setState({ data, pending: false, error: null })
        },
        (failure) => {
          if (active) setState({ pending: false, error: errorMessage(failure) })
        },
      )
    return () => {
      active = false
    }
    // Explicit invalidation keys; changing a render's loader alone does not issue a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...keys, version])
  return { ...state, reload }
}

export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const busy = useRef(false)
  const clear = useCallback(() => setError(null), [])
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      busy.current = false
      setPending(false)
    }
  }, [])
  return { pending, error, run, clear, setError }
}
