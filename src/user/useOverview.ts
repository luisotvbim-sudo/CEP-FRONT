import { useEffect, useState } from 'react'
import { errorMessage, type AuthError } from '../auth/auth-client'
import type { Overview, OverviewApi, OverviewPeriod } from './overview-api'

export function useOverview(api: OverviewApi) {
  const [period, setPeriod] = useState<OverviewPeriod>('daily')
  const [version, setVersion] = useState(0)
  const [retryAt, setRetryAt] = useState(0)
  const [periods, setPeriods] = useState<NonNullable<Overview['periods']>>([])
  const [state, setState] = useState<{
    data?: Overview
    pending: boolean
    error: AuthError | null
  }>({ pending: true, error: null })
  useEffect(() => {
    let active = true
    setState((previous) => ({
      data: previous.data?.period === period ? previous.data : undefined,
      pending: true,
      error: null,
    }))
    const timer = setTimeout(() => {
      void api.load(period).then(
        (data) => {
          if (active) {
            setPeriods(data.periods!)
            setState({ data, pending: false, error: null })
          }
        },
        (failure) => {
          if (!active) return
          const error = errorMessage(failure)
          if (error.status === 429) setRetryAt(Date.now() + (error.retryAfterSeconds ?? 60) * 1000)
          setState((previous) => ({ ...previous, pending: false, error }))
        },
      )
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [api, period, version])
  useEffect(() => {
    if (!retryAt) return
    const timer = setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()))
    return () => clearTimeout(timer)
  }, [retryAt])
  return {
    ...state,
    period,
    periods,
    setPeriod,
    retryAt,
    reload: () => setVersion((value) => value + 1),
  }
}
