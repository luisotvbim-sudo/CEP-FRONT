import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, LoaderCircle, Mail, X } from 'lucide-react'
import { AuthError, errorMessage, type AuthClient } from '../auth/auth-client'
import { FormNotice } from './FormNotice'

export function RecoveryDialog({
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
  const [pending, setPending] = useState(false)
  const [stage, setStage] = useState<'request' | 'reset' | 'done'>('request')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<AuthError | null>(null)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => {
    if (stage === 'reset') dialog.current?.querySelector<HTMLInputElement>('#reset-code')?.focus()
  }, [stage])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    if (stage === 'reset' && newPassword !== confirmation) {
      setError(new AuthError('As senhas não coincidem. Confira a confirmação.'))
      return
    }
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      if (stage === 'request') {
        await client.requestPasswordReset(email)
        setStage('reset')
      } else {
        await client.resetPassword({ email, code, newPassword })
        setNewPassword('')
        setConfirmation('')
        setCode('')
        setStage('done')
      }
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
      aria-labelledby="recovery-title"
      onCancel={(event) => {
        if (pending) event.preventDefault()
      }}
      onClose={() => {
        if (!dialog.current?.open) onClose()
      }}
    >
      <button
        className="dialog-close icon-button"
        type="button"
        aria-label="Fechar recuperação de senha"
        onClick={() => dialog.current?.close()}
        disabled={pending}
      >
        <X size={20} />
      </button>
      <div className="form-symbol">
        {stage === 'done' ? <Check size={24} /> : <Mail size={24} />}
      </div>
      <h2 id="recovery-title">
        {stage === 'done'
          ? 'Senha atualizada'
          : stage === 'reset'
            ? 'Confira seu e-mail'
            : 'Vamos recuperar seu acesso'}
      </h2>
      {stage === 'done' ? (
        <>
          <p>Agora você pode acessar sua conta com a nova senha.</p>
          <button className="primary-button" onClick={() => dialog.current?.close()}>
            Voltar para o login <ArrowRight size={18} />
          </button>
        </>
      ) : (
        <>
          <p>
            {stage === 'request'
              ? 'Informe o e-mail da sua conta para receber as instruções de recuperação.'
              : 'Se houver uma conta elegível para esse e-mail, você receberá um código. Confira também a pasta de spam.'}
          </p>
          <form onSubmit={submit} aria-busy={pending}>
            {stage === 'request' ? (
              <>
                <label htmlFor="recovery-email">E-mail corporativo</label>
                <div className="input-wrap">
                  <Mail size={19} aria-hidden="true" />
                  <input
                    id="recovery-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={320}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={pending}
                    placeholder="voce@empresa.com.br"
                    autoFocus
                  />
                </div>
              </>
            ) : (
              <>
                <label htmlFor="reset-code">Código recebido por e-mail</label>
                <div className="input-wrap">
                  <input
                    id="reset-code"
                    autoComplete="one-time-code"
                    required
                    maxLength={50}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    disabled={pending}
                  />
                </div>
                <label htmlFor="new-password">Nova senha</label>
                <div className="input-wrap">
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={200}
                    placeholder="Pelo menos 12 caracteres"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={pending}
                  />
                </div>
                <label htmlFor="confirm-password">Confirme a nova senha</label>
                <div className="input-wrap">
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={200}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={pending}
                  />
                </div>
              </>
            )}
            <FormNotice error={error} />
            <button type="submit" className="primary-button" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="spin" size={18} /> Enviando…
                </>
              ) : (
                <>
                  {stage === 'request' ? 'Enviar instruções' : 'Salvar nova senha'}{' '}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            {stage === 'reset' && (
              <button
                className="text-button recovery-back"
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null)
                  setStage('request')
                }}
              >
                Corrigir e-mail ou solicitar outro código
              </button>
            )}
          </form>
        </>
      )}
    </dialog>
  )
}
