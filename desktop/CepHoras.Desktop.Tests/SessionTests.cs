using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using CepHoras.Desktop;

internal static class SessionTests
{
    private static readonly object User = new { id = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), role = "organizationAdmin" };
    private static readonly JsonElement Login = JsonSerializer.SerializeToElement(new { email = "fixture@example.invalid", password = "fixture-only" });
    private static readonly JsonElement Request = JsonSerializer.SerializeToElement(new { method = "GET", path = "/organization/time-control/people" });
    private static readonly Uri Api = new("https://fixture.invalid");

    private static HttpResponseMessage Ok(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };
    private static HttpResponseMessage Error(HttpStatusCode status, string code, string correlationId = "fixture-correlation") => new(status)
    {
        Content = JsonContent.Create(new { code, correlationId, detail = "Private server details must not cross the bridge." }),
    };
    private static HttpResponseMessage Tokens(int lifetime = 3600, string access = "fixture-access", string refresh = "fixture-refresh") => Ok(new
    {
        accessToken = access, refreshToken = refresh,
        accessTokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(lifetime),
        refreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(7), user = User,
    });

    private static async Task<ApiFailure> Failure(Task<object?> operation)
    {
        try { await operation; }
        catch (ApiFailure failure) { return failure; }
        throw new InvalidOperationException("Expected native API failure.");
    }

    public static async Task Run(Action<bool, string> check, string root)
    {
        string DirectoryFor(string name) => Path.Combine(root, name);

        var refreshes = 0;
        var reads = 0;
        using (var session = new ApiSession(Api, new Handler(async request =>
        {
            switch (request.RequestUri!.AbsolutePath)
            {
                case "/api/v1/auth/login": return Tokens(10);
                case "/api/v1/me": return Ok(User);
                case "/api/v1/auth/refresh":
                    Interlocked.Increment(ref refreshes);
                    await Task.Delay(10);
                    return Tokens(access: "rotated-access", refresh: "rotated-refresh");
                default:
                    check(request.Headers.Authorization?.Parameter == "rotated-access", "Concurrent request used an expired token");
                    Interlocked.Increment(ref reads);
                    return Ok(new { items = Array.Empty<object>() });
            }
        }), DirectoryFor("concurrent")))
        {
            var metadata = JsonSerializer.Serialize(await session.Execute("login", Login));
            check(!metadata.Contains("fixture-access") && !metadata.Contains("fixture-refresh"), "Native metadata exposed tokens");
            await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => session.Execute("api", Request)));
            check(refreshes == 1 && reads == 12, "Concurrent expiry did not rotate exactly once");
            var forbidden = await Failure(session.Execute("api", JsonSerializer.SerializeToElement(new { method = "POST", path = "/auth/logout" })));
            check(forbidden.Code == "unsupported_route" && reads == 12, "Bridge bypassed native auth route policy");
        }

        var failedDirectory = DirectoryFor("lost-refresh");
        refreshes = 0;
        using (var session = new ApiSession(Api, new Handler(request =>
        {
            if (request.RequestUri!.AbsolutePath == "/api/v1/auth/login") return Task.FromResult(Tokens(10));
            if (request.RequestUri.AbsolutePath == "/api/v1/me") return Task.FromResult(Ok(User));
            Interlocked.Increment(ref refreshes);
            throw new HttpRequestException("Disposable lost response");
        }), failedDirectory))
        {
            await session.Execute("login", Login);
            var failure = await Failure(session.Execute("api", Request));
            check(failure.Code == "session_expired" && failure.Status == 401, "Lost refresh did not expire the session");
            check(!System.IO.Directory.EnumerateFiles(failedDirectory, "*.dat").Any(), "Lost refresh left a replayable token");
            check(await session.Execute("restore", default) is null, "Lost refresh restored an uncertain session");
            await Failure(session.Execute("api", Request));
            check(refreshes == 1, "Lost refresh was sent twice");
        }

        var logouts = 0;
        var logoutDirectory = DirectoryFor("logout-retry");
        using (var session = new ApiSession(Api, new Handler(request => Task.FromResult(request.RequestUri!.AbsolutePath switch
        {
            "/api/v1/auth/login" => Tokens(),
            "/api/v1/me" => Ok(User),
            "/api/v1/auth/logout" when ++logouts == 1 => Error(HttpStatusCode.ServiceUnavailable, "unavailable"),
            _ => new HttpResponseMessage(HttpStatusCode.NoContent),
        })), logoutDirectory))
        {
            await session.Execute("login", Login);
            var failure = await Failure(session.Execute("logout", default));
            check(failure.Status == 503 && failure.CorrelationId == "fixture-correlation", "Logout failure lost support metadata");
            check(session.CurrentUserId is not null && System.IO.Directory.EnumerateFiles(logoutDirectory, "*.dat").Any(), "Failed revocation erased the retryable session");
            await session.Execute("logout", default);
            check(logouts == 2 && session.CurrentUserId is null && !System.IO.Directory.EnumerateFiles(logoutDirectory, "*.dat").Any(), "Successful logout did not clear the session");
        }

        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using (var session = new ApiSession(Api, new Handler(async request =>
        {
            switch (request.RequestUri!.AbsolutePath)
            {
                case "/api/v1/auth/login": return Tokens();
                case "/api/v1/me": return Ok(User);
                case "/api/v1/auth/logout": return new HttpResponseMessage(HttpStatusCode.NoContent);
                default:
                    started.SetResult();
                    await release.Task;
                    return Ok(new { items = new[] { "late-data" } });
            }
        }), DirectoryFor("late-response")))
        {
            await session.Execute("login", Login);
            var pending = session.Execute("api", Request);
            await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await session.Execute("logout", default);
            release.SetResult();
            check((await Failure(pending)).Code == "session_expired", "Late data crossed a logged-out session boundary");
        }

        refreshes = 0;
        reads = 0;
        using (var session = new ApiSession(Api, new Handler(request =>
        {
            switch (request.RequestUri!.AbsolutePath)
            {
                case "/api/v1/auth/login": return Task.FromResult(Tokens());
                case "/api/v1/me": return Task.FromResult(Ok(User));
                case "/api/v1/auth/refresh":
                    refreshes++;
                    return Task.FromResult(Tokens(access: "replacement-access"));
                default:
                    reads++;
                    return Task.FromResult(Error(HttpStatusCode.Unauthorized, "rejected"));
            }
        }), DirectoryFor("rejected-retry")))
        {
            await session.Execute("login", Login);
            var failure = await Failure(session.Execute("api", Request));
            check(reads == 2 && refreshes == 1, "401 recovery retried more than once");
            check(failure.Code == "session_expired" && failure.CorrelationId == "fixture-correlation" && session.CurrentUserId is null, "Repeated rejection did not revoke local state");
        }
    }

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }
}
