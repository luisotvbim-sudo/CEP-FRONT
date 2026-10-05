import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, type AuthError } from '../auth/auth-client'

type QueryState<T> = {
  keys: unknown[]
  data?: T
  pending: boolean
  error: AuthError | null
}

function sameKeys(left: unknown[], right: unknown[]) {
  return left.length === right.length && left.every((key, index) => Object.is(key, right[index]))
}

export function useQuery<T>(load: () => Promise<T>, keys: unknown[]) {
  const [state, setState] = useState<QueryState<T>>(() => ({
    keys: [...keys],
    pending: true,
    error: null,
  }))
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  useEffect(() => {
    let active = true
    const requestedKeys = [...keys]
    setState((previous) => ({
      keys: requestedKeys,
      data: sameKeys(previous.keys, requestedKeys) ? previous.data : undefined,
      pending: true,
      error: null,
    }))
    const currentLoad = load
    Promise.resolve()
      .then(() => {
        if (active) return currentLoad()
      })
      .then(
        (data) => {
          if (active) setState({ keys: requestedKeys, data, pending: false, error: null })
        },
        (failure) => {
          if (active)
            setState((previous) => ({
              keys: requestedKeys,
              data: sameKeys(previous.keys, requestedKeys) ? previous.data : undefined,
              pending: false,
              error: errorMessage(failure),
            }))
        },
      )
    return () => {
      active = false
    }
    // Explicit invalidation keys; changing a render's loader alone does not issue a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...keys, version])
  // Key changes hide old scope synchronously, before passive-effect cleanup. Only
  // a reload of the same query may retain its last successful result.
  const visible = sameKeys(state.keys, keys)
    ? state
    : { data: undefined, pending: true, error: null }
  return {
    data: visible.data,
    pending: visible.pending,
    error: visible.error,
    initialLoading: visible.pending && visible.data === undefined,
    refreshing: visible.pending && visible.data !== undefined,
    reload,
  }
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
