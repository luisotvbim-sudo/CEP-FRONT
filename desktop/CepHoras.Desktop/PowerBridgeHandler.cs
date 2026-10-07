using System.Text.Json;
using CepHoras.Control.Protocol;

namespace CepHoras.Desktop;

internal sealed class PowerBridgeFailure(string code, string? correlationId = null, string? requestId = null) : Exception
{
    internal string Code { get; } = code;
    internal string? CorrelationId { get; } = correlationId;
    internal string? RequestId { get; } = requestId;
    internal static string ServiceCode(Exception error) => error switch
    {
        OperationCanceledException or TimeoutException => "power_service_timeout",
        UnauthorizedAccessException => "access_denied",
        System.IO.InvalidDataException or JsonException => "power_service_invalid_response",
        System.IO.IOException => "power_service_unavailable",
        _ => "service_error"
    };
}

internal sealed class PowerBridgeHandler(ApiSession session, Func<ControlRequest, Task<ControlResponse>>? sender = null, TimeProvider? timeProvider = null)
{
    // Bound the whole authorization, including refresh and the transport probe.
    // The renderer budget must exceed this plus the service budget.
    private static readonly TimeSpan AuthorizationBudget = TimeSpan.FromSeconds(65);
    private static readonly TimeSpan ServiceBudget = TimeSpan.FromSeconds(9);
    private readonly Func<ControlRequest, Task<ControlResponse>> send = sender ?? (request => ControlClient.Send(request));
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    private readonly object gate = new();
    private Pending? current;
    private int suspensionCount;
    private bool uncertainQuiescence;
    private EndingPermission? ending;
    private static readonly HashSet<string> Actions = new(StringComparer.Ordinal) { "shutdown", "restart", "hibernate" };

    private sealed class Pending(string requestId, string action, Guid userId)
    {
        internal string RequestId { get; } = requestId;
        internal string Action { get; } = action;
        internal Guid UserId { get; } = userId;
        internal string? BrokerInstanceId;
        internal bool CancellationRequested, Dispatched, Confirmed, Recovered;
    }
    private sealed record EndingPermission(string RequestId, long Started, TimeSpan Duration);

    internal bool SessionEndingAllowed
    {
        get
        {
            // Windows may send WM_QUERYENDSESSION after the service's countdown
            // expired. Reconciliation must not veto the authorized shutdown itself.
            lock (gate) return ending is not null && clock.GetElapsedTime(ending.Started) <= ending.Duration;
        }
    }

    internal Task<object> Execute(string? operation, JsonElement payload) => operation switch
    {
        "verify-api-unreachable" => VerifyApiUnreachable(),
        "schedule" => Schedule(payload),
        "cancel" => Cancel(payload),
        "reconcile" => Reconcile(payload),
        _ => throw new PowerBridgeFailure("unsupported_power_operation")
    };

    private async Task<object> VerifyApiUnreachable() => new { unreachable = await session.IsApiUnreachable() };

    private static string RequestId(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty("requestId", out var value) ||
            value.ValueKind != JsonValueKind.String || !Guid.TryParse(value.GetString(), out _))
            throw new PowerBridgeFailure("invalid_power_request");
        return value.GetString()!;
    }

    private async Task<object> Schedule(JsonElement payload)
    {
        var userId = session.CurrentUserId ?? throw new PowerBridgeFailure("session_expired");
        var requestId = RequestId(payload);
        if (!payload.TryGetProperty("action", out var actionValue) || actionValue.ValueKind != JsonValueKind.String ||
            actionValue.GetString() is not string action || !Actions.Contains(action) ||
            !payload.TryGetProperty("delaySeconds", out var delay) || delay.ValueKind != JsonValueKind.Number || !delay.TryGetInt32(out var seconds) || seconds != 10 ||
            !payload.TryGetProperty("authorization", out var authorization) || authorization.ValueKind != JsonValueKind.Object ||
            !authorization.TryGetProperty("kind", out var kindValue) || kindValue.ValueKind != JsonValueKind.String ||
            kindValue.GetString() is not string kind || kind is not ("api" or "api-unreachable"))
            throw new PowerBridgeFailure("invalid_power_request");

        var pending = new Pending(requestId, action, userId);
        lock (gate)
        {
            if (suspensionCount != 0 || uncertainQuiescence) throw new PowerBridgeFailure("power_recovery_in_progress");
            if (current is not null) throw new PowerBridgeFailure("native_power_uncertain", requestId: current.RequestId);
            // Retain the ID before any await: recovery owns pre-dispatch requests too.
            current = pending;
        }
        try
        {
            bool allowed;
            try { allowed = await Authorize(pending, kind).WaitAsync(AuthorizationBudget); }
            catch (TimeoutException) { throw new PowerBridgeFailure("power_authorization_timeout"); }
            if (!allowed) throw new PowerBridgeFailure("power_not_authorized");

            Task<ControlResponse> dispatch;
            lock (gate)
            {
                if (current != pending || pending.CancellationRequested || suspensionCount != 0 || uncertainQuiescence)
                    throw new PowerBridgeFailure("power_request_cancelled");
                if (session.CurrentUserId != pending.UserId) throw new PowerBridgeFailure("session_expired");
                // Dispatch and cancellation are ordered here. Service tombstones cover
                // either arrival order across their independent IPC connections.
                pending.Dispatched = true;
                dispatch = send(new ControlRequest("schedule", requestId, action, 10, BrokerInstanceId: pending.BrokerInstanceId));
            }
            var response = await dispatch.WaitAsync(ServiceBudget);
            lock (gate)
            {
                if (current != pending || pending.CancellationRequested)
                    throw new PowerBridgeFailure("power_request_cancelled");
                if (response.BrokerInstanceId != pending.BrokerInstanceId || response.Code != "scheduled" || response.RequestId != requestId || response.Action != action || response.ExecuteAt is null)
                    throw new PowerBridgeFailure(response.Code);
                pending.Confirmed = true;
                var endingSeconds = Math.Clamp((response.ExecuteAt.Value - clock.GetUtcNow()).TotalSeconds + 60, 0, 70);
                ending = action is "shutdown" or "restart"
                    ? new EndingPermission(requestId, clock.GetTimestamp(), TimeSpan.FromSeconds(endingSeconds))
                    : null;
            }
            return new { requestId, action, executeAt = response.ExecuteAt.Value };
        }
        catch
        {
            lock (gate)
            {
                // A lost service reply may still represent a real scheduled action.
                if (current == pending && !pending.Dispatched && !pending.CancellationRequested) current = null;
            }
            throw;
        }
    }

    private async Task<bool> Authorize(Pending pending, string kind)
    {
        // Negotiate before effects. A broker restart must not falsely confirm
        // cancellation of a Windows shutdown scheduled by its predecessor.
        var broker = await send(new ControlRequest("status")).WaitAsync(ServiceBudget);
        if (!Guid.TryParse(broker.BrokerInstanceId, out _)) throw new PowerBridgeFailure("power_service_changed");
        AdoptRecovery(broker);
        if (broker.Code != "ready" || !broker.Active) throw new PowerBridgeFailure(broker.Code);
        lock (gate) pending.BrokerInstanceId = broker.BrokerInstanceId;
        var action = pending.Action;
        if (kind == "api-unreachable") return await session.IsApiUnreachable();
        try
        {
            var check = await session.PowerActionCheck(action);
            return check.TryGetProperty("action", out var checkedAction) && checkedAction.ValueKind == JsonValueKind.String && checkedAction.GetString() == action &&
                check.TryGetProperty("decision", out var decision) && decision.ValueKind == JsonValueKind.String && decision.GetString() == "allowed" &&
                check.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.String &&
                check.TryGetProperty("override", out var overridden) &&
                check.TryGetProperty("unlockedUntil", out var until) &&
                check.TryGetProperty("analysis", out var analysis) &&
                ((code.GetString() == "administrative_override" && overridden.ValueKind == JsonValueKind.True &&
                  until.ValueKind == JsonValueKind.String && until.TryGetDateTimeOffset(out _) && analysis.ValueKind == JsonValueKind.Null) ||
                 (code.GetString() == "within_tolerance" && overridden.ValueKind == JsonValueKind.False &&
                  until.ValueKind == JsonValueKind.Null && analysis.ValueKind == JsonValueKind.Object));
        }
        catch (ApiFailure failure) when (failure.TransportFailure)
        {
            return await session.IsApiUnreachable();
        }
    }

    private async Task<object> Cancel(JsonElement payload)
    {
        await CancelRequest(RequestId(payload));
        return new { cancelled = true };
    }

    private async Task<object> Reconcile(JsonElement payload)
    {
        var requestId = RequestId(payload);
        Pending pending;
        lock (gate)
        {
            pending = current?.RequestId == requestId ? current : throw new PowerBridgeFailure("native_power_uncertain");
            // A status IPC could overtake dispatch on another connection. It cannot
            // prove absence until scheduling was confirmed or a tombstone exists.
            if ((!pending.Dispatched || !pending.Confirmed) && !pending.CancellationRequested)
                return new { requestId, state = "pending" };
        }
        ControlResponse response;
        try { response = await send(new ControlRequest("power-status", requestId, BrokerInstanceId: pending.BrokerInstanceId)).WaitAsync(ServiceBudget); }
        catch { throw new PowerBridgeFailure("native_power_uncertain"); }
        if (response.RequestId != requestId || pending.Dispatched && !SameBrokerOrConfirmedCancellation(response, pending.BrokerInstanceId, requestId))
            throw new PowerBridgeFailure("native_power_uncertain");
        lock (gate)
        {
            if (current != pending) return new { requestId, state = "terminal" };
            if (response.Code == "pending" && response.Action == pending.Action && response.ExecuteAt is not null)
                return new { requestId, state = "pending" };
            if (response.Code == "cancelled" && response.Cancelled || response.Code == "not_pending" && pending.Confirmed)
            {
                current = null;
                if (response.Code == "cancelled" && ending?.RequestId == requestId) ending = null;
                return new { requestId, state = "terminal" };
            }
            throw new PowerBridgeFailure("native_power_uncertain");
        }
    }

    private async Task CancelRequest(string requestId, CancellationToken token = default)
    {
        Pending? pending;
        string? brokerInstanceId;
        bool dispatched;
        lock (gate)
        {
            pending = current?.RequestId == requestId ? current : null;
            if (pending is not null) pending.CancellationRequested = true;
            brokerInstanceId = pending?.BrokerInstanceId;
            dispatched = pending?.Dispatched == true;
        }
        ControlResponse response;
        try { response = await send(new ControlRequest("cancel", requestId, BrokerInstanceId: brokerInstanceId)).WaitAsync(ServiceBudget, token); }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch { throw new PowerBridgeFailure("native_power_uncertain"); }
        if (response.Code != "cancelled" || !response.Cancelled || response.RequestId != requestId ||
            dispatched && !SameBrokerOrConfirmedCancellation(response, brokerInstanceId, requestId))
            throw new PowerBridgeFailure("native_power_uncertain");
        lock (gate)
        {
            if (current == pending) current = null;
            if (ending?.RequestId == requestId) ending = null;
            if (current is null) uncertainQuiescence = false;
        }
    }

    private static bool SameBrokerOrConfirmedCancellation(ControlResponse response, string? originalBroker, string requestId) =>
        originalBroker is not null && (response.BrokerInstanceId == originalBroker ||
            response.Code == "cancelled" && response.Cancelled && response.RequestId == requestId &&
            response.OriginalBrokerInstanceId == originalBroker && Guid.TryParse(response.BrokerInstanceId, out _));

    private void AdoptRecovery(ControlResponse response)
    {
        if (response.Code != "power_uncertain") return;
        if (Guid.TryParse(response.RequestId, out _) && Guid.TryParse(response.OriginalBrokerInstanceId, out _) &&
            response.Action is string action && Actions.Contains(action))
        {
            lock (gate)
            {
                current = new Pending(response.RequestId!, action, session.CurrentUserId ?? Guid.Empty)
                {
                    BrokerInstanceId = response.OriginalBrokerInstanceId,
                    Dispatched = true, Recovered = true
                };
                ending = null;
            }
            throw new PowerBridgeFailure("power_recovery_required", requestId: response.RequestId);
        }
        throw new PowerBridgeFailure("power_uncertain");
    }

    // Hold across navigation, browser disposal, host exit or updates. Failure keeps
    // scheduling suspended until another attempt confirms service cancellation.
    internal async Task<IAsyncDisposable> QuiesceAsync(CancellationToken token = default)
    {
        string? requestId;
        lock (gate)
        {
            suspensionCount++;
            ending = null;
            requestId = current?.RequestId;
            if (current is not null) current.CancellationRequested = true;
        }
        try
        {
            token.ThrowIfCancellationRequested();
            var broker = await send(new ControlRequest("status")).WaitAsync(ServiceBudget, token);
            if (!Guid.TryParse(broker.BrokerInstanceId, out _)) throw new PowerBridgeFailure("power_service_changed", requestId: requestId);
            AdoptRecovery(broker);
            lock (gate)
            {
                if (current is { Dispatched: true } pending && pending.BrokerInstanceId != broker.BrokerInstanceId)
                    pending.Recovered = true;
                if (current is { Recovered: true })
                    throw new PowerBridgeFailure("power_recovery_required", requestId: current.RequestId);
            }
            if (requestId is not null) await CancelRequest(requestId, token);
            lock (gate) uncertainQuiescence = false;
            return new QuiescenceLease(this);
        }
        catch
        {
            lock (gate)
            {
                suspensionCount--;
                uncertainQuiescence = true;
            }
            throw;
        }
    }

    private sealed class QuiescenceLease(PowerBridgeHandler owner) : IAsyncDisposable
    {
        private int disposed;
        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref disposed, 1) == 0)
            {
                lock (owner.gate) owner.suspensionCount--;
            }
            return ValueTask.CompletedTask;
        }
    }

    internal async Task CancelCurrent()
    {
        await using var lease = await QuiesceAsync();
    }
}
