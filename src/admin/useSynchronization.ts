import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthError, errorMessage } from '../auth/auth-client'
import type { AdminApi, Sync } from './api'

export function useSynchronization(
  api: Pick<AdminApi, 'latest' | 'syncStatus' | 'synchronize'>,
  allowFull: boolean,
  onCompleted?: () => void,
) {
  const [batch, setBatch] = useState<Sync | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [full, setFull] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [pollError, setPollError] = useState<AuthError | null>(null)
  const notifiedBatch = useRef<string | undefined>(undefined)
  const completion = useRef(onCompleted)
  useEffect(() => { completion.current = onCompleted }, [onCompleted])
  useEffect(() => {
    if (!batch?.id || batch.status === 'running' || batch.id === notifiedBatch.current) return
    notifiedBatch.current = batch.id
    if (batch.sources?.some((source) => source.status === 'succeeded' || source.status === 'partiallySucceeded')) completion.current?.()
  }, [batch])
  const active = useRef(true)
  const inFlight = useRef(false)
  const batchId = useRef<string | undefined>(undefined)
  const previousBatch = useRef<string | undefined>(undefined)
  const revision = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++revision.current
    try {
      const result = batchId.current ? await api.syncStatus(batchId.current) : await api.latest()
      if (current !== revision.current) return
      if (result.id && result.id === previousBatch.current) return
      if (active.current) {
        batchId.current = result.id
        setBatch(result)
        setPollError(null)
      }
    } catch (failure) {
      if (!active.current || current !== revision.current) return
      if (failure instanceof AuthError && failure.code === 'sync_not_found') {
        setBatch(null)
        setPollError(null)
      } else setPollError(errorMessage(failure))
    } finally {
      if (active.current && current === revision.current) setLoading(false)
    }
  }, [api])
  useEffect(() => {
    active.current = true
    void refresh()
    return () => {
      active.current = false
    }
  }, [refresh])
  const running = starting || batch?.status === 'running'
  useEffect(() => {
    if (!running) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refresh()
      if (!disposed) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 1200)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [running, refresh])

  async function start() {
    if (inFlight.current || running) return
    inFlight.current = true
    revision.current++
    setStarting(true)
    setError(null)
    previousBatch.current = batch?.id
    setBatch(null)
    batchId.current = undefined
    try {
      const result = await api.synchronize(allowFull && full)
      revision.current++
      previousBatch.current = undefined
      if (active.current) {
        batchId.current = result.id
        setBatch(result)
      }
    } catch (failure) {
      revision.current++
      previousBatch.current = undefined
      if (active.current) {
        const problem = errorMessage(failure)
        setError(problem)
        // A member's /latest only exposes their own batches. A conflict may belong to
        // somebody else, so showing their previous batch as the current one is misleading.
        if (!allowFull && problem.code === 'sync_already_running') {
          setBatch(null)
          setLoading(false)
        } else await refresh()
      }
    } finally {
      inFlight.current = false
      if (active.current) setStarting(false)
    }
  }

  function reloadLatest() {
    batchId.current = undefined
    void refresh()
  }

  return { batch, loading, full, setFull, error, pollError, running, refresh, start, reloadLatest }
}
