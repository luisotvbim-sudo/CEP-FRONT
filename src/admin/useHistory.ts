import { useEffect, useRef, useState } from 'react'
import { AuthError } from '../auth/auth-client'
import { useAction } from '../hooks/async'
import type { AdminApi, History, Source } from './api'
import { today, validatePeriod } from './format'

export function useHistory(api: AdminApi, initialFrom?: string, retainOnFilterChange = false) {
  const [from, setFrom] = useState(() => initialFrom ?? `${today().slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [source, setSource] = useState<Source | ''>('')
  const [result, setResult] = useState<History | null>(null)
  const [resultSource, setResultSource] = useState<Source | ''>('')
  const [resultPersonId, setResultPersonId] = useState<string | undefined>()
  const [dirty, setDirty] = useState(false)
  const [validation, setValidation] = useState<AuthError | null>(null)
  const revision = useRef(0)
  const action = useAction()
  useEffect(
    () => () => {
      revision.current++
    },
    [api],
  )

  function changed() {
    revision.current++
    if (!retainOnFilterChange) setResult(null)
    setDirty(true)
    setValidation(null)
    action.clear()
  }
  function submit(personId?: string, search?: string) {
    const message = validatePeriod(from, to)
    setValidation(message ? new AuthError(message) : null)
    if (message) return
    void action.run(async () => {
      const current = ++revision.current
      if (!retainOnFilterChange) setResult(null)
      try {
        const data = await api.history({
          from,
          to,
          source: source || undefined,
          workforcePersonId: personId,
          search: search?.trim() || undefined,
        })
        if (current === revision.current) {
          setResult(data)
          setResultSource(source)
          setResultPersonId(personId)
          setDirty(false)
        }
      } catch (failure) {
        if (current === revision.current) throw failure
      }
    })
  }
  return {
    from,
    setFrom,
    to,
    setTo,
    source,
    setSource,
    result,
    resultSource,
    resultPersonId,
    dirty,
    validation,
    action,
    changed,
    submit,
  }
}
