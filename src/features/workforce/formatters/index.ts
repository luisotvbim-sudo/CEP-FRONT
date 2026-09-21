import type { WorkforcePerson } from "../model/types";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T12:00:00-03:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date).replace(" de ", " ");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date).replace(" de ", " ");
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const sign = seconds < 0 ? "−" : "";
  const absolute = Math.abs(Math.trunc(seconds));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const remainder = absolute % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return `${sign}${base}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`;
}

export function formatSource(source: "monday" | "vrMais") {
  return source === "monday" ? "Monday" : "VR Mais";
}

export function formatSyncStatus(status: string) {
  const labels: Record<string, string> = {
    running: "Em andamento",
    succeeded: "Concluída",
    partiallySucceeded: "Sucesso parcial",
    failed: "Falhou",
  };
  return labels[status] ?? status;
}

export function invitationState(person: WorkforcePerson, now = new Date()) {
  if (person.userId || person.invitationAcceptedAt) return "completed" as const;
  if (!person.invitationExpiresAt) return "notSent" as const;
  return new Date(person.invitationExpiresAt).getTime() < now.getTime()
    ? ("expired" as const)
    : ("pending" as const);
}

export function invitationStateLabel(state: ReturnType<typeof invitationState>) {
  return {
    completed: "Cadastro concluído",
    pending: "Convite pendente",
    expired: "Convite expirado",
    notSent: "Sem convite",
  }[state];
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date) ? null : date;
}

export function validateHistoryPeriod(from: string, to: string) {
  const fromTime = parseDateOnly(from);
  const toTime = parseDateOnly(to);
  if (fromTime === null || toTime === null) return "Informe as duas datas do período.";
  if (fromTime > toTime) return "A data inicial não pode ser posterior à data final.";
  const inclusiveDays = Math.round((toTime - fromTime) / 86_400_000) + 1;
  if (inclusiveDays > 60) return "O histórico permite consultar no máximo 60 dias.";
  return null;
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function recentPeriod(days = 7) {
  const to = todayInSaoPaulo();
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - Math.max(days - 1, 0));
  return { from: start.toISOString().slice(0, 10), to };
}

export function isHttpsUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
