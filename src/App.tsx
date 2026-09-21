import { AuthProvider, useAuth } from "./features/auth/AuthProvider";
import { LoginPage } from "./features/auth/LoginPage";
import { AdminWorkforcePage } from "./features/workforce/pages/AdminWorkforcePage";

function AppContent() {
  const { session, initializing, logout } = useAuth();

  if (initializing) {
    return (
      <main className="app-initializing" role="status">
        <span className="brand__mark" aria-hidden="true"><span>C</span></span>
        <span className="spinner" />
        <p>Validando sua sessão…</p>
      </main>
    );
  }

  if (!session) return <LoginPage />;
  if (session.user.role !== "organizationAdmin") {
    return (
      <main className="access-denied">
        <span className="eyebrow">Acesso restrito</span>
        <h1>Você não tem permissão para acessar esta área.</h1>
        <p>A administração de integrações está disponível somente para administradores da organização.</p>
        <button className="button button--primary" onClick={() => void logout()}>Voltar ao login</button>
      </main>
    );
  }
  return <AdminWorkforcePage />;
}

export function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}
