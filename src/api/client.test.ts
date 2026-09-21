import { ApiClient, ApiError } from "./client";

describe("ApiClient", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("preserva código e correlationId de application/problem+json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 409,
      title: "Conflito",
      code: "external_identity_already_mapped",
      correlationId: "corr-123",
    }), { status: 409, headers: { "Content-Type": "application/problem+json" } })));
    const client = new ApiClient();

    const error = await client.request("/api/test", { authenticated: false }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "external_identity_already_mapped", correlationId: "corr-123" });
  });

  it("converte falha de rede em erro compreensível", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const client = new ApiClient();

    const error = await client.request("/api/test", { authenticated: false }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0, code: "network_error" });
  });

  it("envia JSON e devolve a resposta tipada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();

    await expect(client.request<{ ok: boolean }>("/api/test", {
      method: "POST",
      body: JSON.stringify({ name: "Ana" }),
      authenticated: false,
    })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Ana" }),
    }));
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
