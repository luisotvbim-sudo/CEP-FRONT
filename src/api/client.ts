import type { ApiProblem, AuthSession, LoginInput } from "../features/auth/model/types";

const SESSION_KEY = "cep-admin-session-v1";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly errors?: Record<string, string[]>;

  constructor(problem: ApiProblem, status = 0) {
    super(problem.detail || problem.title || "Não foi possível concluir a solicitação.");
    this.name = "ApiError";
    this.status = problem.status ?? status;
    this.code = problem.code;
    this.correlationId = problem.correlationId;
    this.errors = problem.errors;
  }
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AuthSession>;
  return Boolean(candidate.accessToken && candidate.refreshToken && candidate.user?.id);
}

function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAuthSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function parseProblem(response: Response): Promise<ApiProblem> {
  try {
    const value = (await response.json()) as ApiProblem;
    return { ...value, status: value.status ?? response.status };
  } catch {
    return {
      status: response.status,
      title: response.statusText || "Erro na comunicação com a API",
    };
  }
}

type RequestOptions = RequestInit & {
  authenticated?: boolean;
  retryOnUnauthorized?: boolean;
};

export class ApiClient {
  private session: AuthSession | null = readStoredSession();
  private refreshPromise: Promise<AuthSession> | null = null;
  private listeners = new Set<(session: AuthSession | null) => void>();

  getSession() {
    return this.session;
  }

  subscribe(listener: (session: AuthSession | null) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateSession(session: AuthSession | null) {
    this.session = session;
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
    this.listeners.forEach((listener) => listener(session));
  }

  private async refreshSession() {
    if (!this.session?.refreshToken) throw new ApiError({ title: "Sessão encerrada" }, 401);
    if (!this.refreshPromise) {
      this.refreshPromise = this.request<AuthSession>("/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: this.session.refreshToken }),
        authenticated: false,
        retryOnUnauthorized: false,
      })
        .then((session) => {
          this.updateSession(session);
          return session;
        })
        .catch((error) => {
          this.updateSession(null);
          throw error;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return this.refreshPromise;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      authenticated = true,
      retryOnUnauthorized = true,
      headers: optionHeaders,
      ...requestOptions
    } = options;
    const headers = new Headers(optionHeaders);
    headers.set("Accept", "application/json");
    if (requestOptions.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (authenticated && this.session?.accessToken) {
      headers.set("Authorization", `Bearer ${this.session.accessToken}`);
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, { ...requestOptions, headers });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(
        { code: "network_error", title: "A API está indisponível", detail: "Verifique sua conexão e tente novamente." },
        0,
      );
    }

    if (response.status === 401 && authenticated && retryOnUnauthorized && this.session?.refreshToken) {
      await this.refreshSession();
      return this.request<T>(path, { ...options, retryOnUnauthorized: false });
    }

    if (!response.ok) throw new ApiError(await parseProblem(response), response.status);
    if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
    return (await response.json()) as T;
  }

  async login(input: LoginInput) {
    const session = await this.request<AuthSession>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        client: { type: "web-admin", version: __APP_VERSION__ },
      }),
      authenticated: false,
      retryOnUnauthorized: false,
    });
    this.updateSession(session);
    return session;
  }

  async restore() {
    if (!this.session) return null;
    const user = await this.request<AuthSession["user"]>("/api/v1/me");
    const session = { ...this.session, user };
    this.updateSession(session);
    return session;
  }

  async logout() {
    const refreshToken = this.session?.refreshToken;
    try {
      if (refreshToken) {
        await this.request<void>("/api/v1/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
          retryOnUnauthorized: false,
        });
      }
    } finally {
      this.updateSession(null);
    }
  }
}

declare const __APP_VERSION__: string;

export const apiClient = new ApiClient();

export function getErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "Ocorreu um erro inesperado. Tente novamente.";
  if (error.status === 403) return "Você não tem permissão para acessar esta área.";
  if (error.status === 429) return "Muitas solicitações em pouco tempo. Aguarde e tente novamente.";
  return error.message;
}
