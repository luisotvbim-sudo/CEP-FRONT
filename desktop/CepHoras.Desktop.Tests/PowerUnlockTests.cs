using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CepHoras.Control.Protocol;
using CepHoras.Desktop;

internal static class PowerUnlockTests
{
    // Fixture only: never use the production PIN or a real Windows power operation.
    private const string FixturePin = "012345";
    private static readonly Uri Api = new("https://power-fixture.invalid");
    private static readonly object User = new { id = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), role = "user" };
    private static readonly JsonElement Login = JsonSerializer.SerializeToElement(new { email = "fixture@example.invalid", password = "fixture-only" });
    private static HttpResponseMessage Ok(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };
    private static HttpResponseMessage Error(int status, string code) => new((HttpStatusCode)status)
    { Content = JsonContent.Create(new { code, correlationId = "power-fixture-correlation" }) };
    private static HttpResponseMessage Tokens() => Ok(new {
        accessToken = "fixture-access", refreshToken = "fixture-refresh",
        accessTokenExpiresAt = DateTimeOffset.UtcNow.AddHours(1), refreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(1), user = User
    });
    private static JsonElement Unlock(string pin) => JsonSerializer.SerializeToElement(new {
        method = "POST", path = "/me/time-control/power-action-unlock", body = new { pin }
    });
    private static JsonElement Schedule(string action) => JsonSerializer.SerializeToElement(new {
        requestId = Guid.NewGuid(), action, delaySeconds = 10,
        // A renderer's invented authorization must not override the fresh API result.
        authorization = new { kind = "api", check = new { decision = "allowed", @override = true } }
    });
    private static async Task<ApiFailure> Failure(Task<object?> operation) {
        try { await operation; } catch (ApiFailure error) { return error; }
        throw new InvalidOperationException("Expected API rejection");
    }
    private static async Task Rejected(Task<object> operation) {
        try { await operation; } catch (PowerBridgeFailure) { return; } catch (ApiFailure) { return; }
        throw new InvalidOperationException("Native action was unexpectedly allowed");
    }
    internal static async Task Run(Action<bool, string> check, string root)
    {
        var now = DateTimeOffset.Parse("2026-10-01T12:00:00Z");
        DateTimeOffset? until = null;
        var checks = new List<string>();
        var commands = new List<ControlRequest>();
        var directory = Path.Combine(root, "power-unlock");
        using (var session = new ApiSession(Api, new Handler(async request => {
            switch (request.RequestUri!.AbsolutePath) {
                case "/api/v1/auth/login": return Tokens();
                case "/api/v1/me": return Ok(User);
                case "/api/v1/auth/logout": return Ok(new { });
                case "/api/v1/me/time-control/power-action-unlock":
                    check(request.Method == HttpMethod.Post && request.RequestUri.Query == "", "PIN must use exact POST body route");
                    var input = JsonDocument.Parse(await request.Content!.ReadAsStringAsync()).RootElement;
                    check(input.EnumerateObject().Count() == 1 && input.GetProperty("pin").GetString() == FixturePin, "PIN body changed");
                    until = now.AddMinutes(5);
                    return Ok(new { @override = true, unlockedUntil = until, serverTime = now });
                case "/api/v1/me/time-control/power-action-check":
                    check(request.Headers.Authorization?.Parameter == "fixture-access", "Host revalidation lost session");
                    var action = JsonDocument.Parse(await request.Content!.ReadAsStringAsync()).RootElement.GetProperty("action").GetString()!;
                    checks.Add(action);
                    var active = until is not null && now < until;
                    return Ok(new { action, decision = active ? "allowed" : "blocked", code = active ? "administrative_override" : "above_tolerance",
                        message = "Fixture decision", analysis = (object?)null, @override = active, unlockedUntil = active ? until : null });
                default: return Error(503, "power_pin_not_configured");
            }
        }), directory)) {
            await session.Execute("login", Login);
            var result = (JsonElement)(await session.Execute("api", Unlock(FixturePin)))!;
            check(result.GetProperty("unlockedUntil").GetDateTimeOffset() - result.GetProperty("serverTime").GetDateTimeOffset() == TimeSpan.FromMinutes(5), "Server duration changed");
            var host = new PowerBridgeHandler(session, request => {
                commands.Add(request);
                return Task.FromResult(request.Operation == "cancel"
                    ? new ControlResponse("cancelled", "fixture", Cancelled: true)
                    : new ControlResponse("scheduled", "fixture", RequestId: request.RequestId, Action: request.Action, ExecuteAt: DateTimeOffset.UtcNow.AddSeconds(10)));
            });
            foreach (var action in new[] { "shutdown", "restart", "hibernate" }) {
                await host.Execute("schedule", Schedule(action));
                await host.CancelCurrent();
            }
            check(checks.SequenceEqual(new[] { "shutdown", "restart", "hibernate" }), "Every native action needs fresh API revalidation");
            check(commands.Count(x => x.Operation == "schedule") == 3, "Three actions must reach the fake service");
            check(!JsonSerializer.Serialize(commands).Contains(FixturePin) && !JsonSerializer.Serialize(commands).Contains("pin", StringComparison.OrdinalIgnoreCase), "PIN crossed into service");
            var entropy = SHA256.HashData(Encoding.UTF8.GetBytes(Api.GetLeftPart(UriPartial.Authority)));
            var store = new ProtectedJsonFile(Path.Combine(directory, Convert.ToHexString(entropy) + ".dat"), entropy);
            var persisted = (await store.ReadAsync<JsonElement>()).GetRawText();
            check(!persisted.Contains(FixturePin) && !persisted.Contains("pin", StringComparison.OrdinalIgnoreCase), "PIN persisted with session");
            now = until!.Value;
            var before = commands.Count;
            await Rejected(host.Execute("schedule", Schedule("shutdown")));
            check(commands.Count == before && checks.Count == 4, "Expired override must be denied by host revalidation");
            await session.Execute("logout", default);
            await Rejected(host.Execute("schedule", Schedule("restart")));
            check(session.CurrentUserId is null && !store.Exists && commands.Count == before, "Logout retained authorization");
        }

        foreach (var (status, code) in new[] { (403, "invalid_admin_pin"), (429, "power_unlock_rate_limited"), (503, "power_pin_not_configured") }) {
            var serviceCalls = 0;
            using var session = new ApiSession(Api, new Handler(request => Task.FromResult(request.RequestUri!.AbsolutePath switch {
                "/api/v1/auth/login" => Tokens(), "/api/v1/me" => Ok(User), _ => Error(status, code)
            })), Path.Combine(root, "power-unlock-error-" + status));
            await session.Execute("login", Login);
            var failure = await Failure(session.Execute("api", Unlock("654321")));
            check(failure.Status == status && failure.Code == code && !failure.TransportFailure, "HTTP PIN error became transport failure");
            check(!await session.IsApiUnreachable(), "HTTP reply became offline");
            var host = new PowerBridgeHandler(session, _ => { serviceCalls++; throw new InvalidOperationException("Service must not be called"); });
            await Rejected(host.Execute("schedule", Schedule("hibernate")));
            check(serviceCalls == 0, "HTTP rejection bypassed fresh host check");
        }

        using (var session = new ApiSession(Api, new Handler(request => Task.FromResult(request.RequestUri!.AbsolutePath switch {
            "/api/v1/auth/login" => Tokens(), "/api/v1/me" => Ok(User),
            _ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new BrokenBody() }
        })), Path.Combine(root, "power-broken-body"))) {
            await session.Execute("login", Login);
            var failure = await Failure(session.Execute("api", Unlock(FixturePin)));
            check(!failure.TransportFailure && failure.Status == 502, "HTTP body failure became offline");
            check(!await session.IsApiUnreachable(), "HTTP headers must prove reachability even if body fails");
        }

        using (var session = new ApiSession(Api, new Handler(request => {
            var path = request.RequestUri!.AbsolutePath;
            return path switch {
                "/api/v1/auth/login" => Task.FromResult(Tokens()), "/api/v1/me" => Task.FromResult(Ok(User)),
                _ => throw new HttpRequestException("Fixture transport unavailable")
            };
        }), Path.Combine(root, "power-transport"))) {
            await session.Execute("login", Login);
            var failure = await Failure(session.Execute("api", Unlock(FixturePin)));
            check(failure.TransportFailure && await session.IsApiUnreachable(), "Real transport failure not identified");
            var serviceCalls = 0;
            var host = new PowerBridgeHandler(session, request => {
                serviceCalls++;
                return Task.FromResult(new ControlResponse("scheduled", "fixture", RequestId: request.RequestId, Action: request.Action, ExecuteAt: DateTimeOffset.UtcNow.AddSeconds(10)));
            });
            await host.Execute("schedule", Schedule("shutdown"));
            check(serviceCalls == 1, "Existing transport-only contingency was lost");
        }
    }
    private sealed class BrokenBody : HttpContent {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => throw new HttpRequestException("Fixture body interrupted");
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }
}
