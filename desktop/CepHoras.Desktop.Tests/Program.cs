using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CepHoras.Desktop;

var checks = 0;
void Check(bool condition, string reason)
{
    Interlocked.Increment(ref checks);
    if (!condition) throw new InvalidOperationException(reason);
}
const string id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
var allowed = new (string Method, string Path)[]
{
    ("POST", "/me/time-control/power-action-unlock"),
    ("POST", "/me/time-control/power-action-check"), ("GET", "/me/time-control/power-action-status"),
    ("GET", "/me"), ("GET", "/admin/organizations"), ("POST", "/admin/organizations"),
    ("GET", "/organization/users"), ("PATCH", $"/organization/users/{id}"),
    ("GET", "/organization/invitations"), ("POST", "/organization/invitations"),
    ("POST", $"/organization/invitations/{id}/resend"), ("GET", "/organization/audit"),
    ("GET", "/organization/time-control/people"), ("GET", "/organization/time-control/external-identities"),
    ("POST", "/organization/time-control/people/invitations"),
    ("POST", "/organization/time-control/synchronizations"), ("GET", "/organization/time-control/synchronizations/latest"),
    ("GET", $"/organization/time-control/synchronizations/{id}"),
    ("GET", "/organization/time-control/history"), ("GET", "/organization/time-control/teams"),
    ("POST", "/organization/time-control/teams"), ("PATCH", $"/organization/time-control/teams/{id}"),
    ("GET", $"/organization/time-control/teams/{id}/assignments"), ("POST", $"/organization/time-control/teams/{id}/assignments"),
    ("PATCH", $"/organization/time-control/teams/{id}/assignments/{id}/end"),
    ("GET", "/time-control/settings"), ("PATCH", "/time-control/settings"),
    ("GET", "/time-control/notification-schedules"), ("POST", "/time-control/notification-schedules"),
    ("PATCH", $"/time-control/notification-schedules/{id}"), ("DELETE", $"/time-control/notification-schedules/{id}"),
    ("GET", "/me/notifications"), ("POST", "/me/notifications/received"), ("POST", $"/me/notifications/{id}/read"),
    ("GET", "/organization/time-control/analyses"), ("GET", "/organization/time-control/notification-dispatches"),
    ("POST", "/organization/time-control/notification-dispatches"), ("GET", "/organization/time-control/notification-dispatches/preview"),
};
foreach (var (method, path) in allowed)
{
    Check(ApiRoutePolicy.Allows(method, path), $"Blocked contracted operation: {method} {path}");
    if (path != "/me/time-control/power-action-unlock") Check(ApiRoutePolicy.Allows(method, path + "?page=1&organizationId=test"), "Lost query support");
}
foreach (var path in new[] { "/auth/login", "/auth/refresh", "/auth/logout", "https://example.invalid/me",
    "//example.invalid/me", "/organization/users/../invitations", "/organization/users/%2e%2e/invitations",
    "/organization/users\\anything", "/me#fragment", "/organization/unknown", $"/organization/users/{id}/delete" })
    foreach (var method in new[] { "GET", "POST", "PATCH", "DELETE" })
        Check(!ApiRoutePolicy.Allows(method, path), $"Unexpected native access: {method} {path}");
Check(!ApiRoutePolicy.Allows("DELETE", "/organization/users"), "Must not allow destructive unsupported operation");
Check(!ApiRoutePolicy.Allows("GET", $"/me/notifications/{id}/read"), "Read acknowledgement requires POST");
Check(!ApiRoutePolicy.Allows("POST", "/time-control/settings"), "Settings requires PATCH");
Check(!ApiRoutePolicy.Allows("GET", "/me/time-control/power-action-check"), "Power check requires POST");
Check(!ApiRoutePolicy.Allows("POST", "/me/time-control/power-action-status"), "Power status requires GET");
foreach (var method in new[] { "GET", "PATCH", "DELETE" })
    Check(!ApiRoutePolicy.Allows(method, "/me/time-control/power-action-unlock"), "PIN unlock requires exact POST");
Check(!ApiRoutePolicy.Allows("POST", "/me/time-control/power-action-unlock?pin=123456"), "PIN must never enter query");

var directory = Path.Combine(Path.GetTempPath(), "cep-storage-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
try
{
    var path = Path.Combine(directory, "session.dat");
    var entropy = SHA256.HashData(Encoding.UTF8.GetBytes("https://fixture.invalid"));
    var store = new ProtectedJsonFile(path, entropy);
    Check(!store.Exists, "New store unexpectedly exists");
    var token = new { token = "fixture-token-not-a-real-credential", expiresAt = DateTimeOffset.UtcNow.AddDays(1) };
    await store.WriteAsync(token);
    Check(store.Exists && !File.Exists(path + ".tmp"), "Atomic replacement did not finish");
    Check(!Encoding.UTF8.GetString(await File.ReadAllBytesAsync(path)).Contains(token.token), "Token was stored as plaintext");
    var restored = await store.ReadAsync<JsonElement>();
    Check(restored.GetProperty("token").GetString() == token.token, "Token roundtrip changed");
    // Existing releases use exactly this DPAPI entropy and camelCase JSON format.
    var oldBytes = ProtectedData.Unprotect(await File.ReadAllBytesAsync(path), entropy, DataProtectionScope.CurrentUser);
    using (var legacy = JsonDocument.Parse(oldBytes))
        Check(legacy.RootElement.GetProperty("expiresAt").GetDateTimeOffset() == token.expiresAt, "Legacy format changed");
    CryptographicOperations.ZeroMemory(oldBytes);
    try { await new ProtectedJsonFile(path, [1, 2, 3]).ReadAsync<JsonElement>(); throw new InvalidOperationException("Wrong API entropy was accepted"); }
    catch (CryptographicException) { checks++; }
    await store.WriteAsync(new { token = "replacement", expiresAt = token.expiresAt });
    Check((await store.ReadAsync<JsonElement>()).GetProperty("token").GetString() == "replacement", "Token rotation failed");
    store.Delete();
    Check(!store.Exists, "Revocation left persisted state");

    var ledger = new ProtectedJsonFile(Path.Combine(directory, "notifications"));
    var notificationIds = new HashSet<Guid> { Guid.NewGuid(), Guid.NewGuid() };
    await ledger.WriteAsync(notificationIds);
    Check((await ledger.ReadAsync<HashSet<Guid>>())!.SetEquals(notificationIds), "Receipt ledger changed");
    await File.WriteAllBytesAsync(path, [1, 2, 3]);
    try { await store.ReadAsync<JsonElement>(); throw new InvalidOperationException("Corrupt ciphertext was accepted"); }
    catch (CryptographicException) { checks++; }

    await SessionTests.Run(Check, directory);
    await PowerUnlockTests.Run(Check, directory);
    SingleInstanceCoordinatorTests.Run(Check);
    WebViewProfileRecoveryTests.Run(Check, directory);
}
finally
{
    var resolved = Path.GetFullPath(directory);
    var temporaryRoot = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (!resolved.StartsWith(temporaryRoot, StringComparison.OrdinalIgnoreCase) ||
        !Path.GetFileName(resolved).StartsWith("cep-storage-tests-", StringComparison.Ordinal))
        throw new InvalidOperationException("Refusing cleanup outside the disposable test directory.");
    Directory.Delete(resolved, recursive: true);
}
Console.WriteLine($"Desktop security/storage: {checks} checks passed.");
