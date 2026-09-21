export type UserRole = "systemAdmin" | "organizationAdmin" | "user";
export type UserStatus = "active" | "suspended" | "archived";

export type AuthUser = {
  id: string;
  displayName: string | null;
  email: string | null;
  organizationId: string | null;
  role: UserRole;
  status: UserStatus;
  products: ("revit" | "zwcad")[] | null;
};

export type AuthSession = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: AuthUser;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type ApiProblem = {
  status?: number;
  title?: string;
  detail?: string;
  code?: string;
  correlationId?: string;
  errors?: Record<string, string[]>;
};
