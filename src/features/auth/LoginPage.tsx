import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, getErrorMessage } from "../../api/client";
import { CheckIcon } from "../../components/Icons";
import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const session = await login({ email: email.trim(), password });
      if (session.user.role !== "organizationAdmin") {
        setError(new ApiError({ title: "Você não tem permissão para acessar esta área." }, 403));
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story" aria-labelledby="login-title">
        <div className="brand brand--light">
          <span className="brand__mark" aria-hidden="true"><span>C</span></span>
          <span><strong>CEP</strong><small>Horas</small></span>
        </div>
        <div className="login-story__content">
          <span className="eyebrow eyebrow--light">Administração segura</span>
          <h1 id="login-title">Pessoas certas.<br />Dados conectados.</h1>
          <p>Gerencie as integrações do Monday e VR Mais em um único lugar, com rastreabilidade e confirmação humana.</p>
          <ul className="feature-list">
            <li><CheckIcon size={18} /> Sincronização independente por fonte</li>
            <li><CheckIcon size={18} /> Correspondências sempre confirmadas</li>
            <li><CheckIcon size={18} /> Histórico bruto protegido</li>
          </ul>
        </div>
        <small className="login-story__footer">CEP Horas · Ambiente administrativo</small>
      </section>

      <section className="login-panel" aria-label="Acesso administrativo">
        <div className="login-card">
          <span className="eyebrow">Acesso restrito</span>
          <h2>Entre na sua organização</h2>
          <p className="muted">Use as credenciais de administrador cadastradas na CEP API.</p>

          <form onSubmit={handleSubmit} className="form-stack">
            <label className="field">
              <span>E-mail</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@empresa.com"
                required
              />
            </label>
            <label className="field">
              <span>Senha</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite sua senha"
                required
              />
            </label>

            {error !== null && (
              <div className="inline-alert inline-alert--danger" role="alert">
                <strong>{getErrorMessage(error)}</strong>
                {error instanceof ApiError && error.correlationId && <small>Suporte: {error.correlationId}</small>}
              </div>
            )}

            <button className="button button--primary button--wide" disabled={loading} type="submit">
              {loading ? <><span className="spinner spinner--light" /> Entrando…</> : "Entrar na administração"}
            </button>
          </form>

          <p className="security-note">Sua sessão é mantida apenas nesta aba do navegador. Tokens de Monday e VR Mais nunca são enviados para o front-end.</p>
        </div>
      </section>
    </main>
  );
}
