import { buildExternalIdentityQuery, buildHistoryQuery, buildPeopleQuery } from "./query";

describe("serialização de filtros", () => {
  it("serializa filtros de identidades sem valores vazios", () => {
    expect(buildExternalIdentityQuery({ source: "monday", activeOnly: true, mapped: false, search: "  Ana Silva  ", page: 2, pageSize: 50 }))
      .toBe("?source=monday&activeOnly=true&mapped=false&search=Ana+Silva&page=2&pageSize=50");
  });

  it("preserva false como valor válido", () => {
    expect(buildExternalIdentityQuery({ activeOnly: false })).toBe("?activeOnly=false");
  });

  it("codifica o histórico e omite filtros ausentes", () => {
    expect(buildHistoryQuery({ from: "2026-09-01", to: "2026-09-20", source: "vrMais", search: "Luís & Cia" }))
      .toBe("?from=2026-09-01&to=2026-09-20&source=vrMais&search=Lu%C3%ADs+%26+Cia");
  });

  it("serializa paginação de pessoas", () => {
    expect(buildPeopleQuery({ page: 3, pageSize: 25 })).toBe("?page=3&pageSize=25");
  });
});
