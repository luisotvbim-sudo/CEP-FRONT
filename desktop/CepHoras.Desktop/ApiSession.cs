using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CepHoras.Desktop;

internal sealed class ApiFailure(int status, string? code, string? correlationId = null, bool transportFailure = false, int? retryAfterSeconds = null) : Exception
{
    public int Status { get; } = status;
    public string? Code { get; } = code;
    public string? CorrelationId { get; } = correlationId;
    public bool TransportFailure { get; } = transportFailure;
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
}

internal sealed class ApiSession : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly string sessionFile;
    private readonly ProtectedJsonFile storedSession;
    private readonly FileStream instanceLock;
    private string? accessToken, refreshToken;
    private DateTimeOffset accessExpiry;
    private JsonElement user;
    private long generation;
    internal Guid? CurrentUserId => accessToken is not null && user.ValueKind == JsonValueKind.Object && user.TryGetProperty("id", out var id) && id.TryGetGuid(out var value) ? value : null;
    internal string NotificationStorePath(Guid userId) => sessionFile + "." + userId.ToString("N") + ".notifications";
    internal async Task<JsonElement> NotificationRequest(string method, string path, object? body = null)
    {
        var result = await Request(JsonSerializer.SerializeToElement(new { method, path, body }, Json));
        return result is JsonElement value ? value : default;
    }

    internal async Task<JsonElement> PowerActionCheck(string action)
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            method = "POST",
            path = "/me/time-control/power-action-check",
            body = new { action }
        }, Json);
        var result = await Request(payload);
        return result is JsonElement value && value.ValueKind == JsonValueKind.Object
            ? value
            : throw new ApiFailure(502, "invalid_power_response");
    }

    internal async Task<bool> IsApiUnreachable()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/ready");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            return false; // Any HTTP response means the API transport is reachable.
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return true;
        }
    }

    public ApiSession(Uri api) : this(api, null, SessionDirectory()) { }

    internal ApiSession(Uri api, HttpMessageHandler? handler, string directory)
    {
        http = handler is null ? new HttpClient() : new HttpClient(handler);
        http.BaseAddress = api;
        http.Timeout = Timeout.InfiniteTimeSpan;
        var entropy = SHA256.HashData(Encoding.UTF8.GetBytes(api.GetLeftPart(UriPartial.Authority)));
        Directory.CreateDirectory(directory);
        sessionFile = Path.Combine(directory, Convert.ToHexString(entropy) + ".dat");
        storedSession = new ProtectedJsonFile(sessionFile, entropy);
        // Prevent two executable instances from rotating the same stored session.
        instanceLock = new FileStream(sessionFile + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }

    private static string SessionDirectory()
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras", "Sessions");
#if DEBUG
        directory = Environment.GetEnvironmentVariable("CEP_SESSION_DIR") ?? directory;
#endif
        return directory;
    }

    public async Task<object?> Execute(string? operation, JsonElement payload) => operation switch
    {
        "login" => await Login(payload), "restore" => await Restore(), "logout" => await Logout(),
        "forgot" => await Anonymous("/auth/password/forgot", new { email = payload.GetProperty("email").GetString()?.Trim() }),
        "reset" => await Anonymous("/auth/password/reset", new { email = payload.GetProperty("email").GetString()?.Trim(), code = payload.GetProperty("code").GetString()?.Trim(), newPassword = payload.GetProperty("newPassword").GetString() }),
        "api" => await Request(payload),
        "activate-invitation" => await Anonymous("/auth/invitations/activate", new { email = payload.GetProperty("email").GetString()?.Trim(), code = payload.GetProperty("code").GetString()?.Trim(), displayName = payload.GetProperty("displayName").GetString()?.Trim(), password = payload.GetProperty("password").GetString() }),
        _ => throw new ApiFailure(400, "unsupported_operation")
    };

    private async Task<object> Login(JsonElement payload)
    {
        await gate.WaitAsync();
        try
        {
            var result = await Send("POST", "/auth/login", new { email = payload.GetProperty("email").GetString()?.Trim(), password = payload.GetProperty("password").GetString(), client = new { type = "cep-horas-desktop", version = "0.2.0" } });
            generation++;
            await Accept(result);
            user = await Send("GET", "/me", token: accessToken);
            return Metadata();
        }
        catch { Clear(); throw; }
        finally { gate.Release(); }
    }

    private async Task<object?> Restore()
    {
        await gate.WaitAsync();
        try
        {
            if (accessToken is not null) return Metadata();
            if (!storedSession.Exists) return null;
            if (!System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable())
                throw new ApiFailure(503, "connection_failed");
            try
            {
                var stored = await storedSession.ReadAsync<JsonElement>();
                if (stored.GetProperty("expiresAt").GetDateTimeOffset() <= DateTimeOffset.UtcNow) { Clear(); return null; }
                refreshToken = stored.GetProperty("token").GetString();
            }
            catch (Exception exception) when (exception is CryptographicException or JsonException or InvalidOperationException) { Clear(); return null; }
            await RefreshUnsafe();
            user = await Send("GET", "/me", token: accessToken);
            return Metadata();
        }
        catch (ApiFailure failure) when (failure.Status == 503 && failure.Code == "connection_failed") { throw; }
        catch (Exception exception) { Clear(); throw new ApiFailure(401, "session_expired", (exception as ApiFailure)?.CorrelationId); }
        finally { gate.Release(); }
    }

    private object Metadata() => new { user, expiresAt = accessExpiry };

    private async Task Accept(JsonElement result)
    {
        var access = result.GetProperty("accessToken").GetString();
        var refresh = result.GetProperty("refreshToken").GetString();
        var expires = result.GetProperty("accessTokenExpiresAt").GetDateTimeOffset();
        var refreshExpires = result.GetProperty("refreshTokenExpiresAt").GetDateTimeOffset();
        if (string.IsNullOrWhiteSpace(access) || string.IsNullOrWhiteSpace(refresh) || expires <= DateTimeOffset.UtcNow)
            throw new ApiFailure(401, "session_expired");
        await storedSession.WriteAsync(new { token = refresh, expiresAt = refreshExpires });
        accessToken = access; refreshToken = refresh; accessExpiry = expires; user = result.GetProperty("user").Clone();
    }

    private async Task RefreshUnsafe()
    {
        var token = refreshToken;
        refreshToken = null;
        // Remove the old persisted token before rotating. After a lost response or
        // process interruption, require login instead of replaying an old token.
        storedSession.Delete();
        try
        {
            if (token is null) throw new ApiFailure(401, "session_expired");
            await Accept(await Send("POST", "/auth/refresh", new { refreshToken = token }));
        }
        catch (Exception exception)
        {
            Clear();
            throw new ApiFailure(401, "session_expired", (exception as ApiFailure)?.CorrelationId);
        }
    }

    private async Task<string> Access(string? rejectedToken = null)
    {
        await gate.WaitAsync();
        try
        {
            if (accessToken is null || accessExpiry <= DateTimeOffset.UtcNow.AddSeconds(30) || rejectedToken is not null && accessToken == rejectedToken)
                await RefreshUnsafe();
            return accessToken!;
        }
        finally { gate.Release(); }
    }

    private async Task<object?> Request(JsonElement payload)
    {
        var method = payload.GetProperty("method").GetString() ?? "";
        var path = payload.GetProperty("path").GetString() ?? "";
        if (!ApiRoutePolicy.Allows(method, path)) throw new ApiFailure(403, "unsupported_route");
        object? body = payload.TryGetProperty("body", out var value) && value.ValueKind != JsonValueKind.Null ? value.Clone() : null;
        var token = await Access();
        var currentGeneration = generation;
        JsonElement result;
        try { result = await Send(method, path, body, token); }
        catch (ApiFailure failure) when (failure.Status == 401)
        {
            if (currentGeneration != generation) throw new ApiFailure(401, "session_expired");
            token = await Access(token);
            try { result = await Send(method, path, body, token); }
            catch (ApiFailure retry) when (retry.Status == 401)
            {
                await gate.WaitAsync();
                try { if (currentGeneration == generation) Clear(); }
                finally { gate.Release(); }
                throw new ApiFailure(401, "session_expired", retry.CorrelationId);
            }
        }
        if (currentGeneration != generation) throw new ApiFailure(401, "session_expired");
        return result.ValueKind == JsonValueKind.Undefined ? null : result;
    }

    private async Task<object?> Logout()
    {
        await gate.WaitAsync();
        try { if (refreshToken is not null) await Send("POST", "/auth/logout", new { refreshToken }); Clear(); return null; }
        finally { gate.Release(); }
    }

    private async Task<object?> Anonymous(string path, object body) { await Send("POST", path, body); return null; }

    private async Task<JsonElement> Send(string method, string path, object? body = null, string? token = null)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), "/api/v1" + path);
        if (body is not null) request.Content = JsonContent.Create(body, options: Json);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(method == "POST" && path.StartsWith("/organization/time-control/synchronizations", StringComparison.Ordinal) ? 180 :
            method == "GET" && path.Split('?')[0] == "/me/time-control/overview" ? 100 : 20));
        HttpResponseMessage response;
        try { response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token); }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            throw new ApiFailure(503, "connection_failed", transportFailure: true);
        }
        using (response)
        {
        JsonElement result = default;
        try { using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token)); result = document.RootElement.Clone(); }
        catch (JsonException) { }
        catch (Exception error) when (error is TaskCanceledException or HttpRequestException) { throw new ApiFailure(502, "invalid_api_response"); }
        if (!response.IsSuccessStatusCode)
        {
            string? Read(string name) => result.ValueKind == JsonValueKind.Object && result.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;
            var retry = response.Headers.RetryAfter;
            var seconds = retry?.Delta?.TotalSeconds ?? (retry?.Date - DateTimeOffset.UtcNow)?.TotalSeconds;
            throw new ApiFailure((int)response.StatusCode, Read("code"), Read("correlationId"),
                retryAfterSeconds: seconds is { } delay ? (int)Math.Clamp(Math.Ceiling(delay), 1, int.MaxValue) : null);
        }
        return result;
        }
    }

    private void Clear() { generation++; accessToken = null; refreshToken = null; accessExpiry = default; storedSession.Delete(); }
    public void Dispose() { accessToken = null; refreshToken = null; http.Dispose(); instanceLock.Dispose(); }
}
