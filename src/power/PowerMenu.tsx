import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Power } from 'lucide-react'
import { errorMessage, type AuthClient } from '../auth/auth-client'
import { actionLabels, PowerApi, type PowerAction, type PowerCheck } from './api'
import {
  mayVerifyOffline,
  nativePower,
  NativePowerUncertain,
  type NativePower,
  type ScheduledPower,
} from './native'
import './power.css'

const decisions = {
  allowed: 'Liberado',
  blocked: 'Bloqueado',
  indeterminate: 'Não foi possível determinar',
}
export function AuthenticatedLayout({
  client,
  children,
}: {
  client: AuthClient
  children: ReactNode
}) {
  return (
    <div className="authenticated-layout">
      {children}
      <PowerMenu client={client} />
    </div>
  )
}

export function PowerMenu({ client }: { client: AuthClient }) {
  const api = useMemo(() => new PowerApi(client), [client])
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const [notice, setNotice] = useState('')
  const [check, setCheck] = useState<PowerCheck | null>(null)
  const [scheduled, setScheduled] = useState<ScheduledPower | null>(null)
  const [remaining, setRemaining] = useState(10)
  const [uncertain, setUncertain] = useState(false)
  const active = useRef<{ host: NativePower; requestId: string } | null>(null)
  const mounted = useRef(true)
  const cancelButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const current = active.current
      if (current) void current.host.cancel(current.requestId).catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (!scheduled) return
    cancelButton.current?.focus()
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((Date.parse(scheduled.executeAt) - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 100)
    return () => clearInterval(timer)
  }, [scheduled])

  async function run(action?: PowerAction) {
    if (busy.current || active.current) return
    busy.current = true
    setPending(true)
    setNotice('')
    setCheck(null)
    const host = nativePower()
    try {
      let authorization: Parameters<NativePower['schedule']>[1]
      try {
        const result = action ? await api.check(action) : await api.status()
        if (!mounted.current) return
        setCheck(result)
        if (!action || result.decision !== 'allowed') return
        authorization = { kind: 'api', check: result }
      } catch (error) {
        if (!action || !host || !mayVerifyOffline(error) || !(await host.verifyApiUnreachable()))
          throw error
        authorization = { kind: 'api-unreachable' }
        if (mounted.current)
          setNotice('API inacessível, confirmado pelo aplicativo. Ação permitida em contingência.')
      }
      if (!action || !mounted.current) return
      if (!host) {
        setNotice(
          window.__CEP_DESKTOP__
            ? 'O menu de energia ainda depende da integração nativa deste aplicativo.'
            : 'A execução está disponível no aplicativo Windows.',
        )
        return
      }
      const job = await host.schedule(action, authorization)
      if (!mounted.current) {
        await host.cancel(job.requestId)
        return
      }
      active.current = { host, requestId: job.requestId }
      setScheduled(job)
    } catch (error) {
      if (error instanceof NativePowerUncertain && host && mounted.current) {
        active.current = { host, requestId: error.requestId }
        setUncertain(true)
      }
      const failure = errorMessage(error)
      if (mounted.current)
        setNotice(
          failure.message +
            (failure.correlationId ? ` Código para suporte: ${failure.correlationId}` : ''),
        )
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  async function cancel() {
    if (busy.current || !active.current) return
    busy.current = true
    setPending(true)
    try {
      await active.current.host.cancel(active.current.requestId)
      active.current = null
      setScheduled(null)
      setUncertain(false)
      setNotice('Ação cancelada pelo aplicativo.')
    } catch (error) {
      setNotice(errorMessage(error).message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <section className="power-menu" aria-label="Energia do computador">
      <details>
        <summary>
          <Power size={14} aria-hidden="true" /> Energia do computador
        </summary>
        <div className="power-actions" role="group" aria-label="Ações de energia">
          {(Object.keys(actionLabels) as PowerAction[]).map((action) => (
            <button
              key={action}
              disabled={pending || !!scheduled || uncertain}
              onClick={() => void run(action)}
            >
              {actionLabels[action]}
            </button>
          ))}
          <button disabled={pending || !!scheduled || uncertain} onClick={() => void run()}>
            Verificar status
          </button>
        </div>
      </details>
      <div aria-live="polite" aria-atomic="true">
        {pending && <p>Consultando…</p>}
        {check && (
          <p>
            <strong>{decisions[check.decision]}.</strong> {check.message}
            {check.analysis && <> Tolerância: {check.analysis.toleranceMinutes} minutos.</>}
          </p>
        )}
        {notice && <p>{notice}</p>}
        {scheduled && (
          <p>
            {remaining > 0
              ? `${actionLabels[scheduled.action]} em ${remaining} ${remaining === 1 ? 'segundo' : 'segundos'}.`
              : 'Prazo do agendamento atingido. A execução é controlada pelo aplicativo Windows.'}
          </p>
        )}
      </div>
      {(scheduled || uncertain) && (
        <button
          className="power-cancel"
          ref={cancelButton}
          disabled={pending}
          onClick={() => void cancel()}
        >
          Cancelar
        </button>
      )}
    </section>
  )
}
