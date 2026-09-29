import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AuthError, errorMessage, type AuthClient } from '../auth/auth-client'
import { FormNotice } from './FormNotice'

export function InvitationDialog({
  client,
  initialEmail,
  onClose,
}: {
  client: AuthClient
  initialEmail: string
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    if (password !== confirmation) {
      setError(new AuthError('As senhas não coincidem.'))
      return
    }
    if (!name.trim() || !code.trim()) {
      setError(new AuthError('Informe seu nome e o código do convite.'))
      return
    }
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      await client.activateInvitation({ email, code, displayName: name, password })
      setPassword('')
      setConfirmation('')
      setCode('')
      setDone(true)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="recovery-dialog"
      aria-labelledby="invitation-title"
      onCancel={(event) => {
        if (pending) event.preventDefault()
      }}
      onClose={() => {
        if (!dialog.current?.open) onClose()
      }}
    >
      <button
        type="button"
        className="dialog-close icon-button"
        aria-label="Fechar ativação"
        disabled={pending}
        onClick={() => dialog.current?.close()}
      >
        ×
      </button>
      <h2 id="invitation-title">{done ? 'Conta ativada' : 'Ative sua conta'}</h2>
      {done ? (
        <>
          <p role="status">
            Seu convite foi aceito. Entre com seu e-mail e a senha que acabou de criar.
          </p>
          <button className="primary-button" onClick={() => dialog.current?.close()}>
            Voltar para entrar
          </button>
        </>
      ) : (
        <>
          <p>Use o código enviado por e-mail. Ele serve para ativar sua conta, não para entrar.</p>
          <form onSubmit={submit} aria-label="Ativar conta" aria-busy={pending}>
            <label htmlFor="activation-email">E-mail do convite</label>
            <div className="input-wrap">
              <input
                id="activation-email"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                disabled={pending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <label htmlFor="activation-name">Seu nome</label>
            <div className="input-wrap">
              <input
                id="activation-name"
                autoComplete="name"
                required
                maxLength={200}
                disabled={pending}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <label htmlFor="activation-code">Código do convite</label>
            <div className="input-wrap">
              <input
                id="activation-code"
                autoComplete="one-time-code"
                required
                maxLength={50}
                disabled={pending}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <label htmlFor="activation-password">Crie sua senha (mínimo 12 caracteres)</label>
            <div className="input-wrap">
              <input
                id="activation-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
                disabled={pending}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <label htmlFor="activation-confirmation">Confirme sua senha</label>
            <div className="input-wrap">
              <input
                id="activation-confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
                disabled={pending}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>
            <FormNotice error={error} />
            <button className="primary-button" disabled={pending}>
              {pending ? 'Ativando…' : 'Ativar minha conta'}
            </button>
          </form>
          <p>
            Convite expirado? Solicite um novo ao administrador. Já ativou sua conta? Volte para
            entrar ou recuperar sua senha.
          </p>
        </>
      )}
    </dialog>
  )
}
