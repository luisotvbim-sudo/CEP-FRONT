import { useEffect, useState } from 'react'
import { Check, LoaderCircle, LogOut } from 'lucide-react'
import logo from './assets/conceito-logo.png'
import { errorMessage, type AuthClient, type AuthError, type AuthSession } from './auth/auth-client'
import { BrandPanel } from './components/BrandPanel'
import { LoginForm } from './components/LoginForm'
import { FormNotice } from './components/FormNotice'
import { AdminShell } from './admin/AdminShell'
import { SystemAdminShell } from './admin/SystemAdminShell'
import { UserShell } from './user/UserShell'

export function App({ client }: { client: AuthClient }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [notice, setNotice] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    let active = true
    const stop = client.onExpired((failure) => {
      if (active) {
        setSession(null)
        setNotice(
          'Sua sessão expirou ou foi encerrada. Entre novamente.' +
            (failure?.correlationId ? ` Código para suporte: ${failure.correlationId}` : ''),
        )
        setRestoring(false)
      }
    })
    client
      .restore()
      .then(
        (value) => {
          if (active) setSession(value)
        },
        (failure) => {
          if (active) {
            const error = errorMessage(failure)
            setNotice(
              error.message +
                (error.correlationId ? ` Código para suporte: ${error.correlationId}` : ''),
            )
          }
        },
      )
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => {
      active = false
      stop()
    }
  }, [client])

  useEffect(() => {
    document.title = session ? 'CEP Horas' : 'Entrar · CEP Horas'
  }, [session, client])

  async function logout() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await client.logout()
      setSession(null)
      setNotice('Você saiu da sua conta com segurança.')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  if (restoring)
    return (
      <div className="startup-loading" role="status">
        <LoaderCircle className="spin" /> Verificando sua sessão…
      </div>
    )
  if (session?.user.role === 'systemAdmin')
    return <SystemAdminShell client={client} session={session} onLogout={() => setSession(null)} />
  if (session?.user.role === 'organizationAdmin' && session.user.organizationId)
    return (
      <AdminShell
        client={client}
        session={session}
        onLogout={() => {
          setSession(null)
          setNotice('Você saiu da sua conta com segurança.')
        }}
      />
    )
  if (session?.user.role === 'user' && session.user.organizationId)
    return (
      <UserShell
        client={client}
        session={session}
        onLogout={() => {
          setSession(null)
          setNotice('Você saiu da sua conta com segurança.')
        }}
      />
    )
  return (
    <div className="app-shell">
      <header className="page-header">
        <img src={logo} alt="Conceito Engenharia" width="1174" height="376" />
        <div className="header-product">
          <span className="header-divider" />
          <span>
            CEP <strong>Horas</strong>
          </span>
        </div>
        <span className="header-caption">PORTAL DO COLABORADOR</span>
      </header>
      <main className="login-layout">
        <BrandPanel />
        <section className="form-panel" aria-label="Acesso ao CEP Horas">
          {session ? (
            <div className="login-content success-content" role="status">
              <div className="form-symbol">
                <Check size={26} />
              </div>
              <div className="eyebrow">ACESSO CONFIRMADO</div>
              <h2>Olá, {session.user.displayName || 'bem-vindo'}.</h2>
              <p>Você está conectado ao CEP Horas.</p>
              <div className="account-summary">
                <span>Conta conectada</span>
                <strong>{session.user.email}</strong>
              </div>
              <p className="small-copy">
                A área de membro e líder ainda não está disponível nesta versão. A área de
                coordenação exige o papel Coordenador da organização.
              </p>
              <FormNotice error={error} />
              <button className="primary-button" onClick={logout} disabled={pending}>
                {pending ? (
                  <>
                    <LoaderCircle className="spin" size={18} /> Saindo…
                  </>
                ) : (
                  <>
                    Sair da conta <LogOut size={18} />
                  </>
                )}
              </button>
            </div>
          ) : (
            <LoginForm
              client={client}
              onLogin={(value) => {
                setNotice(undefined)
                setError(null)
                setSession(value)
              }}
              notice={notice}
            />
          )}
        </section>
      </main>
      <footer className="page-footer">
        <span>© {new Date().getFullYear()} Conceito Engenharia</span>
        <span>Feito para conectar pessoas, projetos e tempo.</span>
      </footer>
    </div>
  )
}
