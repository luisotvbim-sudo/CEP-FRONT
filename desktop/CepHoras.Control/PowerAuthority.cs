using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal interface ISystemPower
{
    void Schedule(string action, int delaySeconds);
    void Cancel(string action);
}

internal sealed class PowerAuthority(
    Func<ControlConfiguration?> configuration,
    Func<bool> healthy,
    ISystemPower system,
    Action<string, string> audit,
    Func<DateTimeOffset>? clock = null)
{
    private sealed record Pending(string RequestId, string Action, string OwnerSid, DateTimeOffset ExecuteAt);
    private static readonly HashSet<string> Actions = new(StringComparer.Ordinal) { "shutdown", "restart", "hibernate" };
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private readonly HashSet<string> cancelled = new(StringComparer.Ordinal);
    private Pending? pending;

    internal ControlResponse Handle(ControlRequest request, string sid)
    {
        if (request.Operation == "status")
        {
            var active = configuration()?.Active == true && healthy();
            return new(active ? "ready" : "inactive", active
                ? "Controle local de energia ativo."
                : "Controle local ainda não está ativo ou precisa de revisão.", active);
        }

        if (request.Operation == "cancel") return Cancel(request, sid);
        if (request.Operation != "schedule")
            return new("invalid_request", "Operação inválida.");
        if (configuration()?.Active != true)
            return new("inactive", "Controle ainda não foi ativado pela instalação.");
        if (!healthy())
            return new("policy_changed", "A política local foi alterada. A TI precisa revisar este computador.");
        if (!Guid.TryParse(request.RequestId, out _) || request.Action is null ||
            !Actions.Contains(request.Action) || request.DelaySeconds != 10)
            return new("invalid_request", "Agendamento inválido.", true);
        if (cancelled.Contains(request.RequestId))
            return new("cancelled", "Esta solicitação já foi cancelada.", true, request.RequestId, request.Action, Cancelled: true);

        if (pending is not null && now() >= pending.ExecuteAt) pending = null;
        if (pending is not null)
        {
            if (pending.RequestId == request.RequestId && pending.OwnerSid == sid)
                return Scheduled(pending);
            return new("pending", "Já existe uma ação de energia em andamento.", true,
                pending.RequestId, pending.Action, pending.ExecuteAt);
        }

        var executeAt = now().AddSeconds(10);
        system.Schedule(request.Action, 10);
        pending = new(request.RequestId, request.Action, sid, executeAt);
        audit("power-scheduled:" + request.Action, sid);
        return Scheduled(pending);
    }

    private ControlResponse Cancel(ControlRequest request, string sid)
    {
        if (!Guid.TryParse(request.RequestId, out _))
            return new("invalid_request", "Cancelamento inválido.");
        if (pending is not null && (pending.RequestId != request.RequestId || pending.OwnerSid != sid))
            return new("not_pending", "Não há uma solicitação sua com esse identificador.", true, request.RequestId);
        if (pending is null)
        {
            RememberCancelled(request.RequestId);
            return new("cancelled", "A solicitação não está mais pendente.", true,
                request.RequestId, Cancelled: true);
        }
        if (now() >= pending.ExecuteAt)
        {
            pending = null;
            return new("not_pending", "O prazo da ação já foi atingido.", true, request.RequestId);
        }
        system.Cancel(pending.Action);
        audit("power-cancelled:" + pending.Action, sid);
        var action = pending.Action;
        pending = null;
        RememberCancelled(request.RequestId);
        return new("cancelled", "Ação cancelada.", true, request.RequestId, action, Cancelled: true);
    }

    private void RememberCancelled(string requestId)
    {
        if (cancelled.Count >= 256) cancelled.Clear();
        cancelled.Add(requestId);
    }

    private static ControlResponse Scheduled(Pending value) => new(
        "scheduled",
        "Ação agendada para dez segundos. Salve seu trabalho ou cancele.",
        true,
        value.RequestId,
        value.Action,
        value.ExecuteAt);
}
