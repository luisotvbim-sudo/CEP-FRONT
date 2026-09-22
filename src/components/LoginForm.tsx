import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import {
  errorMessage,
  type AuthClient,
  type AuthError,
  type AuthSession,
} from '../auth/auth-client'
import { FormNotice } from './FormNotice'
import { RecoveryDialog } from './RecoveryDialog'

export function LoginForm({
  client,
  onLogin,
  notice,
}: {
  client: AuthClient
  onLogin(session: AuthSession): void
  notice?: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [recovering, setRecovering] = useState(false)
  const inFlight = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const session = await client.login({ email, password })
      setPassword('')
      onLogin(session)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="login-content">
      <div className="form-symbol">
        <KeyRound size={24} strokeWidth={1.6} aria-hidden="true" />
      </div>
      <div className="form-heading">
        <div className="eyebrow">BEM-VINDO AO CEP HORAS</div>
        <h2>Bom ter você aqui.</h2>
        <p>Acesse sua conta para acompanhar sua jornada.</p>
      </div>
      {notice && (
        <p role="status" className="session-notice">
          {notice}
        </p>
      )}
      <form onSubmit={submit} aria-label="Entrar na sua conta" aria-busy={pending}>
        <label htmlFor="email">E-mail corporativo</label>
        <div className="input-wrap">
          <Mail size={19} strokeWidth={1.6} aria-hidden="true" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="voce@empresa.com.br"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={320}
            disabled={pending}
          />
        </div>
        <label htmlFor="password">Senha</label>
        <div className="input-wrap">
          <LockKeyhole size={19} strokeWidth={1.6} aria-hidden="true" />
          <input
            id="password"
            name="password"
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Digite sua senha"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={200}
            disabled={pending}
          />
          <button
            className="icon-button password-toggle"
            type="button"
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
            disabled={pending}
          >
            {visible ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </div>
        <div className="form-options">
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={() => setRecovering(true)}
          >
            Esqueci minha senha
          </button>
        </div>
        <FormNotice error={error} />
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle size={19} className="spin" /> Entrando…
            </>
          ) : (
            <>
              Entrar na minha conta <ArrowRight size={19} />
            </>
          )}
        </button>
      </form>
      <div className="access-note">
        <span className="note-rule" />
        <p>
          Ainda não tem acesso?
          <br />
          <span>Solicite um convite ao administrador da sua organização.</span>
        </p>
      </div>
      <div className="privacy-note">
        <LockKeyhole size={13} aria-hidden="true" />
        <span>Seu acesso é pessoal. Não compartilhe sua senha.</span>
      </div>
      {recovering && (
        <RecoveryDialog client={client} initialEmail={email} onClose={() => setRecovering(false)} />
      )}
    </div>
  )
}
