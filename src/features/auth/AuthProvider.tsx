import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { ApiError, apiClient } from "../../api/client";
import type { AuthSession, LoginInput } from "./model/types";

type AuthContextValue = {
  session: AuthSession | null;
  initializing: boolean;
  login(input: LoginInput): Promise<AuthSession>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(() => apiClient.getSession());
  const [initializing, setInitializing] = useState(Boolean(apiClient.getSession()));

  useEffect(() => apiClient.subscribe(setSession), []);

  useEffect(() => {
    if (!apiClient.getSession()) {
      setInitializing(false);
      return;
    }
    apiClient.restore().catch((error: unknown) => {
      if (!(error instanceof ApiError) || error.status !== 401) {
        // A sessão permanece disponível para uma nova tentativa em falhas transitórias.
      }
    }).finally(() => setInitializing(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      initializing,
      login: (input) => apiClient.login(input),
      logout: () => apiClient.logout(),
    }),
    [initializing, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return context;
}
