import { formatDuration, invitationState, isHttpsUrl, recentPeriod, validateHistoryPeriod } from ".";
import type { WorkforcePerson } from "../model/types";

function person(overrides: Partial<WorkforcePerson> = {}): WorkforcePerson {
  const identity = { id: "1", source: "monday" as const, externalId: "x", displayName: "Ana", email: null, isActive: true, lastSeenAt: "2026-09-20T10:00:00Z", workforcePersonId: "p" };
  return {
    id: "p", userId: null, displayName: "Ana", email: "ana@example.com",
    monday: identity, vrMais: { ...identity, id: "2", source: "vrMais" },
    invitationId: "i", invitationExpiresAt: "2026-09-22T10:00:00Z", invitationAcceptedAt: null,
    createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z", ...overrides,
  };
}

describe("formatadores", () => {
  it("formata durações acima de 24 horas", () => expect(formatDuration(99_015)).toBe("27:30:15"));
  it("não transforma duração desconhecida em zero", () => expect(formatDuration(null)).toBe("—"));
  it("omite segundos quando forem zero", () => expect(formatDuration(27_000)).toBe("07:30"));
  it("aceita apenas links HTTPS", () => {
    expect(isHttpsUrl("https://monday.com/boards/1")).toBe(true);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("http://example.com")).toBe(false);
  });
});

describe("período do histórico", () => {
  it("aceita exatamente 60 dias inclusivos", () => expect(validateHistoryPeriod("2026-01-01", "2026-03-01")).toBeNull());
  it("recusa mais de 60 dias", () => expect(validateHistoryPeriod("2026-01-01", "2026-03-02")).toContain("60 dias"));
  it("recusa datas invertidas", () => expect(validateHistoryPeriod("2026-09-20", "2026-09-01")).toContain("posterior"));
  it("gera sete dias inclusivos", () => {
    const period = recentPeriod(7);
    const days = (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000 + 1;
    expect(days).toBe(7);
  });
});

describe("estado do convite", () => {
  const now = new Date("2026-09-21T00:00:00Z");
  it("considera usuário vinculado como concluído", () => expect(invitationState(person({ userId: "u" }), now)).toBe("completed"));
  it("identifica convite pendente", () => expect(invitationState(person(), now)).toBe("pending"));
  it("identifica convite expirado", () => expect(invitationState(person({ invitationExpiresAt: "2026-09-20T00:00:00Z" }), now)).toBe("expired"));
});
