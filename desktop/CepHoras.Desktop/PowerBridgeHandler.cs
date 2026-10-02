using System.Text.Json;
using CepHoras.Control.Protocol;

namespace CepHoras.Desktop;

internal sealed class PowerBridgeFailure(string code, string? correlationId = null) : Exception
{
    internal string Code { get; } = code;
    internal string? CorrelationId { get; } = correlationId;
}

internal sealed class PowerBridgeHandler(ApiSession session, Func<ControlRequest, Task<ControlResponse>>? sender = null)
{
    private readonly Func<ControlRequest, Task<ControlResponse>> send = sender ?? (request => ControlClient.Send(request));
    private static readonly HashSet<string> Actions = new(StringComparer.Ordinal)
    {
        "shutdown", "restart", "hibernate"
    };
    private string? activeRequestId;
    internal bool SessionEndingAllowed { get; private set; }

    internal async Task<object> Execute(string? operation, JsonElement payload)
    {
        return operation switch
        {
            "verify-api-unreachable" => new { unreachable = await session.IsApiUnreachable() },
            "schedule" => await Schedule(payload),
            "cancel" => await Cancel(payload),
            _ => throw new PowerBridgeFailure("unsupported_power_operation")
        };
    }

    private async Task<object> Schedule(JsonElement payload)
    {
        if (session.CurrentUserId is null) throw new PowerBridgeFailure("session_expired");
        var requestId = payload.GetProperty("requestId").GetString();
        var action = payload.GetProperty("action").GetString();
        var delay = payload.GetProperty("delaySeconds").GetInt32();
        if (!Guid.TryParse(requestId, out _) || action is null || !Actions.Contains(action) || delay != 10)
            throw new PowerBridgeFailure("invalid_power_request");
        var authorization = payload.GetProperty("authorization");
        var kind = authorization.GetProperty("kind").GetString();
        var allowed = false;
        if (kind == "api")
        {
            try
            {
                var check = await session.PowerActionCheck(action);
                allowed = check.TryGetProperty("action", out var checkedAction) && checkedAction.GetString() == action &&
                          check.TryGetProperty("decision", out var decision) && decision.GetString() == "allowed" &&
                          check.TryGetProperty("code", out var code) &&
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
                allowed = await session.IsApiUnreachable();
            }
        }
        else if (kind == "api-unreachable")
        {
            allowed = await session.IsApiUnreachable();
        }
        if (!allowed) throw new PowerBridgeFailure("power_not_authorized");

        var response = await send(new ControlRequest("schedule", requestId, action, delay));
        if (response.Code != "scheduled" || response.RequestId != requestId || response.Action != action || response.ExecuteAt is null)
            throw new PowerBridgeFailure(response.Code);
        activeRequestId = requestId;
        SessionEndingAllowed = action is "shutdown" or "restart";
        return new { requestId, action, executeAt = response.ExecuteAt.Value };
    }

    private async Task<object> Cancel(JsonElement payload)
    {
        var requestId = payload.GetProperty("requestId").GetString();
        if (!Guid.TryParse(requestId, out _)) throw new PowerBridgeFailure("invalid_power_request");
        var response = await send(new ControlRequest("cancel", requestId));
        if (response.Code != "cancelled" || !response.Cancelled)
            throw new PowerBridgeFailure(response.Code);
        if (activeRequestId == requestId)
        {
            activeRequestId = null;
            SessionEndingAllowed = false;
        }
        return new { cancelled = true };
    }

    internal async Task CancelCurrent()
    {
        var requestId = activeRequestId;
        if (requestId is null) return;
        try { await send(new ControlRequest("cancel", requestId)); }
        catch { }
        activeRequestId = null;
        SessionEndingAllowed = false;
    }
}
