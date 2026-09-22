using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CepHoras.Desktop;

internal sealed class ApiFailure(int status, string? code, string? correlationId = null) : Exception
{
    public int Status { get; } = status;
    public string? Code { get; } = code;
    public string? CorrelationId { get; } = correlationId;
}

internal sealed class ApiSession : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly string sessionFile;
    private readonly byte[] entropy;
    private readonly FileStream instanceLock;
    private string? accessToken, refreshToken;
    private DateTimeOffset accessExpiry;
    private JsonElement user;
    private long generation;

    public ApiSession(Uri api)
    {
        http = new HttpClient { BaseAddress = api, Timeout = Timeout.InfiniteTimeSpan };
        entropy = SHA256.HashData(Encoding.UTF8.GetBytes(api.GetLeftPart(UriPartial.Authority)));
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras", "Sessions");
#if DEBUG
        directory = Environment.GetEnvironmentVariable("CEP_SESSION_DIR") ?? directory;
#endif
        Directory.CreateDirectory(directory);
        sessionFile = Path.Combine(directory, Convert.ToHexString(entropy) + ".dat");
        // Prevent two executable instances from rotating the same stored session.
        instanceLock = new FileStream(sessionFile + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }

    public async Task<object?> Execute(string? operation, JsonElement payload) => operation switch
    {
        "login" => await Login(payload), "restore" => await Restore(), "logout" => await Logout(),
        "forgot" => await Anonymous("/auth/password/forgot", new { email = payload.GetProperty("email").GetString()?.Trim() }),
        "reset" => await Anonymous("/auth/password/reset", new { email = payload.GetProperty("email").GetString()?.Trim(), code = payload.GetProperty("code").GetString()?.Trim(), newPassword = payload.GetProperty("newPassword").GetString() }),
        "api" => await Request(payload),
        _ => throw new ApiFailure(400, "unsupported_operation")
    };

    private async Task<object> Login(JsonElement payload)
    {
        await gate.WaitAsync();
        try
        {
            var result = await Send("POST", "/auth/login", new { email = payload.GetProperty("email").GetString()?.Trim(), password = payload.GetProperty("password").GetString(), client = new { type = "cep-horas-desktop", version = "0.2.0" } });
            generation++;
            Accept(result);
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
            if (!File.Exists(sessionFile)) return null;
            try
            {
                var data = ProtectedData.Unprotect(File.ReadAllBytes(sessionFile), entropy, DataProtectionScope.CurrentUser);
                try
                {
                    using var stored = JsonDocument.Parse(data);
                    if (stored.RootElement.GetProperty("expiresAt").GetDateTimeOffset() <= DateTimeOffset.UtcNow) { Clear(); return null; }
                    refreshToken = stored.RootElement.GetProperty("token").GetString();
                }
                finally { CryptographicOperations.ZeroMemory(data); }
            }
            catch (Exception exception) when (exception is CryptographicException or JsonException or InvalidOperationException) { Clear(); return null; }
            await RefreshUnsafe();
            user = await Send("GET", "/me", token: accessToken);
            return Metadata();
        }
        catch (Exception exception) { Clear(); throw new ApiFailure(401, "session_expired", (exception as ApiFailure)?.CorrelationId); }
        finally { gate.Release(); }
    }

    private object Metadata() => new { user, expiresAt = accessExpiry };

    private void Accept(JsonElement result)
    {
        var access = result.GetProperty("accessToken").GetString();
        var refresh = result.GetProperty("refreshToken").GetString();
        var expires = result.GetProperty("accessTokenExpiresAt").GetDateTimeOffset();
        var refreshExpires = result.GetProperty("refreshTokenExpiresAt").GetDateTimeOffset();
        if (string.IsNullOrWhiteSpace(access) || string.IsNullOrWhiteSpace(refresh) || expires <= DateTimeOffset.UtcNow)
            throw new ApiFailure(401, "session_expired");
        var data = JsonSerializer.SerializeToUtf8Bytes(new { token = refresh, expiresAt = refreshExpires }, Json);
        try
        {
            File.WriteAllBytes(sessionFile + ".tmp", ProtectedData.Protect(data, entropy, DataProtectionScope.CurrentUser));
            File.Move(sessionFile + ".tmp", sessionFile, true);
        }
        finally { CryptographicOperations.ZeroMemory(data); }
        accessToken = access; refreshToken = refresh; accessExpiry = expires; user = result.GetProperty("user").Clone();
    }

    private async Task RefreshUnsafe()
    {
        var token = refreshToken;
        refreshToken = null;
        // Remove the old persisted token before rotating. After a lost response or
        // process interruption, require login instead of replaying an old token.
        File.Delete(sessionFile);
        try
        {
            if (token is null) throw new ApiFailure(401, "session_expired");
            Accept(await Send("POST", "/auth/refresh", new { refreshToken = token }));
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
        if (!Allowed(method, path)) throw new ApiFailure(403, "unsupported_route");
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

    private static bool Allowed(string method, string path)
    {
        if (path.Contains('\\') || path.Contains('#')) return false;
        var route = path.Split('?')[0];
        if (method == "GET" && route is "/me" or "/organization/users" or "/organization/invitations") return true;
        if (method == "POST" && Regex.IsMatch(route, "^/organization/invitations/[0-9a-fA-F-]{36}/resend$")) return true;
        const string prefix = "/organization/time-control/";
        if (!route.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var relative = route[prefix.Length..];
        const string id = "[0-9a-fA-F-]{36}";
        return method switch
        {
            "GET" => relative is "people" or "external-identities" or "history" or "teams" or "synchronizations/latest" || Regex.IsMatch(relative, $"^(synchronizations/{id}|teams/{id}(/assignments)?)$"),
            "POST" => relative is "people/invitations" or "synchronizations" or "teams" || Regex.IsMatch(relative, $"^teams/{id}/assignments$"),
            "PATCH" => Regex.IsMatch(relative, $"^teams/{id}(/assignments/{id}/end)?$"),
            _ => false
        };
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
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(method == "POST" && path.StartsWith("/organization/time-control/synchronizations", StringComparison.Ordinal) ? 180 : 20));
        using var response = await http.SendAsync(request, timeout.Token);
        JsonElement result = default;
        try { using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token)); result = document.RootElement.Clone(); }
        catch (JsonException) { }
        if (!response.IsSuccessStatusCode)
        {
            string? Read(string name) => result.ValueKind == JsonValueKind.Object && result.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;
            throw new ApiFailure((int)response.StatusCode, Read("code"), Read("correlationId"));
        }
        return result;
    }

    private void Clear() { generation++; accessToken = null; refreshToken = null; accessExpiry = default; File.Delete(sessionFile); }
    public void Dispose() { accessToken = null; refreshToken = null; http.Dispose(); instanceLock.Dispose(); }
}
