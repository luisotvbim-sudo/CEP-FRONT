using System.IO;
using System.Diagnostics;
using System.Text.Json;

namespace CepHoras.Desktop;

// Only the native host creates events. Neither the WebView nor the LocalSystem
// service can submit arbitrary telemetry or access the user's bearer token.
internal sealed record DesktopTelemetryEvent(
    Guid EventId, Guid InstallationId, DateTimeOffset OccurredAt, string Code, string? Action,
    string Phase, string Outcome, string ErrorCode, string AppVersion, Guid? OperationId);

internal sealed class DesktopTelemetry(ApiSession session, bool enabled, string appVersion, Guid installationId)
{
    private const int MaxQueued = 500;
    // The API accepts at most thirty days old. Leave one day of margin for clock
    // skew, reconnect delay and server-side validation before batching.
    private static readonly TimeSpan MaxLocalAge = TimeSpan.FromDays(29);
    private readonly SemaphoreSlim storeGate = new(1, 1);
    private readonly SemaphoreSlim flushGate = new(1, 1);
    private Guid? forbiddenUserId;
    private static readonly HashSet<string> Codes = new(StringComparer.Ordinal)
    {
        "desktop_started", "desktop_start_failed", "power_check_allowed", "power_check_denied",
        "power_check_failed", "power_schedule_confirmed", "power_schedule_failed",
        "power_cancel_confirmed", "power_cancel_failed", "power_recovery_required",
        "power_reconciled", "update_check_failed", "update_install_started", "update_install_failed"
    };
    private static readonly HashSet<string> Phases = new(StringComparer.Ordinal)
        { "startup", "authorization", "schedule", "cancel", "reconcile", "update" };
    private static readonly HashSet<string> Outcomes = new(StringComparer.Ordinal)
        { "success", "denied", "failure", "uncertain" };
    private static readonly HashSet<string> Errors = new(StringComparer.Ordinal)
        { "none", "transport_unavailable", "http_error", "invalid_response", "service_unavailable", "permission_denied", "timeout", "internal_error" };

    // New instrumented MSI defaults to minimal structured collection. TI can
    // disable it without changing the energy policy or removing the app.
    internal static bool IsEnabledByConfiguration() =>
        Environment.GetEnvironmentVariable("CEP_DESKTOP_TELEMETRY") != "0";

    internal static string Error(Exception error) => error switch
    {
        ApiFailure { TransportFailure: true } => "transport_unavailable",
        ApiFailure { Status: >= 400 } => "http_error",
        PowerBridgeFailure { Code: "power_service_timeout" or "power_authorization_timeout" } or TimeoutException => "timeout",
        PowerBridgeFailure { Code: "access_denied" or "power_not_authorized" } or UnauthorizedAccessException => "permission_denied",
        PowerBridgeFailure { Code: "power_service_unavailable" } or IOException => "service_unavailable",
        PowerBridgeFailure { Code: "power_service_invalid_response" or "power_service_changed" } or JsonException => "invalid_response",
        _ => "internal_error"
    };

    internal void Record(string code, string phase, string outcome, string? action = null,
        string errorCode = "none", Guid? operationId = null)
    {
        if (!TryCreate(code, phase, outcome, action, errorCode, operationId, out var userId, out var item)) return;
        _ = Task.Run(() => AppendAsync(userId, item, flush: true));
    }

    internal async Task RecordDurableAsync(string code, string phase, string outcome, string? action = null,
        string errorCode = "none", Guid? operationId = null)
    {
        if (!TryCreate(code, phase, outcome, action, errorCode, operationId, out var userId, out var item)) return;
        await AppendAsync(userId, item, flush: false);
        _ = Task.Run(FlushAsync);
    }

    private bool TryCreate(string code, string phase, string outcome, string? action,
        string errorCode, Guid? operationId, out Guid userId, out DesktopTelemetryEvent item)
    {
        userId = session.CurrentUserId ?? Guid.Empty;
        item = default!;
        if (!enabled || installationId == Guid.Empty || userId == Guid.Empty || forbiddenUserId == userId) return false;
        if (!Codes.Contains(code) || !Phases.Contains(phase) || !Outcomes.Contains(outcome) ||
            !Errors.Contains(errorCode) || action is not (null or "shutdown" or "restart" or "hibernate") ||
            (outcome is "success" or "denied" && errorCode != "none")) return false;
        item = new DesktopTelemetryEvent(Guid.NewGuid(), installationId, DateTimeOffset.UtcNow, code, action,
            phase, outcome, errorCode, appVersion, operationId);
        return true;
    }

    private async Task AppendAsync(Guid userId, DesktopTelemetryEvent item, bool flush)
    {
        try
        {
            await storeGate.WaitAsync();
            try
            {
                var store = new ProtectedJsonFile(session.TelemetryStorePath(userId));
                var pending = await ReadAsync(store);
                pending.RemoveAll(e => e.OccurredAt < DateTimeOffset.UtcNow - MaxLocalAge);
                pending.Add(item);
                if (pending.Count > MaxQueued) pending.RemoveRange(0, pending.Count - MaxQueued);
                await store.WriteAsync(pending);
            }
            finally { storeGate.Release(); }
            if (flush) await FlushAsync();
        }
        catch { /* Never affect native control. Keep the last successfully written queue. */ }
    }

    private static async Task<List<DesktopTelemetryEvent>> ReadAsync(ProtectedJsonFile store)
    {
        if (!store.Exists) return [];
        // Corrupt protected state is preserved for support, never sent as raw text.
        return await store.ReadAsync<List<DesktopTelemetryEvent>>() ?? [];
    }

    internal async Task FlushAsync()
    {
        if (!enabled || session.CurrentUserId is not Guid userId || forbiddenUserId == userId || !await flushGate.WaitAsync(0)) return;
        try
        {
            List<DesktopTelemetryEvent> batch;
            await storeGate.WaitAsync();
            try
            {
                var store = new ProtectedJsonFile(session.TelemetryStorePath(userId));
                var pending = await ReadAsync(store);
                if (pending.RemoveAll(e => e.OccurredAt < DateTimeOffset.UtcNow - MaxLocalAge) > 0)
                    await store.WriteAsync(pending);
                batch = pending.Take(50).ToList();
            }
            finally { storeGate.Release(); }
            if (batch.Count == 0) return;
            JsonElement response;
            try { response = await session.SendDesktopTelemetry(new { events = batch }); }
            catch (ApiFailure failure) when (failure.Status == 403)
            {
                // A SystemAdmin token without an organization cannot own these
                // events. Stop this account's retries for the current process.
                forbiddenUserId = userId;
                Trace.TraceWarning("CEP Horas: telemetry unavailable for this account.");
                return;
            }
            catch (ApiFailure failure) when (failure.Status == 400)
            {
                // Strict whole-batch validation: isolate one bad event without
                // permanently blocking newer entries. Never drop 401/404/429/5xx.
                if (batch.Count > 1)
                {
                    batch = [batch[0]];
                    try { response = await session.SendDesktopTelemetry(new { events = batch }); }
                    catch (ApiFailure singleForbidden) when (singleForbidden.Status == 403)
                    {
                        forbiddenUserId = userId;
                        Trace.TraceWarning("CEP Horas: telemetry unavailable for this account.");
                        return;
                    }
                    catch (ApiFailure singleFailure) when (singleFailure.Status == 400)
                    {
                        await RemoveAsync(userId, new HashSet<Guid> { batch[0].EventId });
                        Trace.TraceWarning("CEP Horas: one malformed telemetry event removed from local queue.");
                        return;
                    }
                }
                else
                {
                    await RemoveAsync(userId, new HashSet<Guid> { batch[0].EventId });
                    Trace.TraceWarning("CEP Horas: one malformed telemetry event removed from local queue.");
                    return;
                }
            }
            if (session.CurrentUserId != userId || response.ValueKind != JsonValueKind.Object ||
                !response.TryGetProperty("acceptedEventIds", out var ids) || ids.ValueKind != JsonValueKind.Array) return;
            var offered = batch.Select(e => e.EventId).ToHashSet();
            var accepted = new HashSet<Guid>();
            foreach (var id in ids.EnumerateArray())
            {
                if (id.ValueKind != JsonValueKind.String || !id.TryGetGuid(out var parsed) || !offered.Contains(parsed)) return;
                accepted.Add(parsed);
            }
            if (response.TryGetProperty("rejectedEventIds", out var rejectedIds))
            {
                if (rejectedIds.ValueKind != JsonValueKind.Array) return;
                foreach (var id in rejectedIds.EnumerateArray())
                {
                    if (id.ValueKind != JsonValueKind.String || !id.TryGetGuid(out var parsed) ||
                        !offered.Contains(parsed) || accepted.Contains(parsed)) return;
                    accepted.Add(parsed);
                    Trace.TraceWarning("CEP Horas: one rejected telemetry event removed from local queue.");
                }
            }
            if (accepted.Count == 0) return;
            await RemoveAsync(userId, accepted);
        }
        catch { /* Offline, old API or expired session: retry with the same IDs later. */ }
        finally { flushGate.Release(); }
    }

    private async Task RemoveAsync(Guid userId, IReadOnlySet<Guid> ids)
    {
        if (session.CurrentUserId != userId) return;
        await storeGate.WaitAsync();
        try
        {
            var store = new ProtectedJsonFile(session.TelemetryStorePath(userId));
            var pending = await ReadAsync(store);
            pending.RemoveAll(e => ids.Contains(e.EventId));
            await store.WriteAsync(pending);
        }
        finally { storeGate.Release(); }
    }
}
