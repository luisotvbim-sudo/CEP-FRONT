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
    Func<DateTimeOffset>? clock = null,
    Func<bool>? maintenance = null)
{
    private readonly object gate = new();
    private readonly string brokerInstanceId = Guid.NewGuid().ToString();
    private sealed record Pending(string RequestId, string Action, string OwnerSid, DateTimeOffset ExecuteAt);
    private static readonly HashSet<string> Actions = new(StringComparer.Ordinal) { "shutdown", "restart", "hibernate" };
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private readonly Dictionary<string, (bool Cancelled, DateTimeOffset Expires)> terminal = new(StringComparer.Ordinal);
    private Pending? pending;

    internal ControlResponse Handle(ControlRequest request, string sid)
    {
        lock (gate)
        {
            foreach (var expired in terminal.Where(entry => entry.Value.Expires <= now()).Select(entry => entry.Key).ToArray())
                terminal.Remove(expired);
            if (Guid.TryParse(request.RequestId, out var id)) request = request with { RequestId = id.ToString() };
            if (request.Operation is "schedule" or "cancel" or "power-status" && request.BrokerInstanceId is not null &&
                request.BrokerInstanceId != brokerInstanceId)
                return new("broker_changed", "O serviço foi reiniciado; confirme o estado da ação antes de continuar.", RequestId: request.RequestId, BrokerInstanceId: brokerInstanceId);
            return HandleLocked(request, sid) with { BrokerInstanceId = brokerInstanceId };
        }
    }

    internal void CancelForMaintenance()
    {
        lock (gate)
        {
            if (pending is null) return;
            system.Cancel(pending.Action);
            RememberCancelled(pending.RequestId);
            ControlAudit.TryWrite(audit, "power-cancelled-for-update:" + pending.Action, pending.OwnerSid);
            pending = null;
        }
    }

    private ControlResponse HandleLocked(ControlRequest request, string sid)
    {
        if (request.Operation == "status")
        {
            var active = configuration()?.Active == true && healthy();
            return new(active ? "ready" : "inactive", active
                ? "Controle local de energia ativo."
                : "Controle local ainda não está ativo ou precisa de revisão.", active);
        }

        if (request.Operation == "power-status") return PendingStatus(request, sid);

        if (request.Operation == "cancel") return Cancel(request, sid);
        if (request.Operation != "schedule")
            return new("invalid_request", "Operação inválida.");
        if (maintenance?.Invoke() == true)
            return new("update_maintenance", "O CEP Horas está sendo atualizado. Aguarde para solicitar uma ação de energia.");
        if (configuration()?.Active != true)
            return new("inactive", "Controle ainda não foi ativado pela instalação.");
        if (!healthy())
            return new("policy_changed", "A política local foi alterada. A TI precisa revisar este computador.");
        if (!Guid.TryParse(request.RequestId, out _) || request.Action is null ||
            !Actions.Contains(request.Action) || request.DelaySeconds != 10)
            return new("invalid_request", "Agendamento inválido.", true);
        if (terminal.TryGetValue(request.RequestId, out var previous))
        {
            if (!previous.Cancelled)
                return new("not_pending", "O prazo desta solicitação já foi atingido. Ela não será agendada novamente.", true, request.RequestId, request.Action);
            return new("cancelled", "Esta solicitação já foi cancelada.", true, request.RequestId, request.Action, Cancelled: true);
        }

        ExpirePending();
        if (terminal.ContainsKey(request.RequestId))
            return new("not_pending", "O prazo desta solicitação já foi atingido. Ela não será agendada novamente.", true, request.RequestId, request.Action);
        if (pending is not null)
        {
            if (pending.RequestId == request.RequestId && pending.OwnerSid == sid)
                return Scheduled(pending);
            return new("pending", "Já existe uma ação de energia em andamento.", true,
                pending.RequestId, pending.Action, pending.ExecuteAt);
        }

        if (terminal.Count >= 4096)
            return new("service_busy", "Aguarde antes de solicitar outra ação de energia.", true, request.RequestId);

        var executeAt = now().AddSeconds(10);
        system.Schedule(request.Action, 10);
        pending = new(request.RequestId, request.Action, sid, executeAt);
        ControlAudit.TryWrite(audit, "power-scheduled:" + request.Action, sid);
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
            if (!terminal.ContainsKey(request.RequestId!) && terminal.Count >= 4096)
                return new("service_busy", "Não foi possível confirmar o cancelamento. Solicite suporte à TI.", true, request.RequestId);
            if (terminal.TryGetValue(request.RequestId!, out var previous) && !previous.Cancelled)
                return new("not_pending", "O prazo da ação já foi atingido.", true, request.RequestId);
            RememberCancelled(request.RequestId);
            return new("cancelled", "A solicitação não está mais pendente.", true,
                request.RequestId, Cancelled: true);
        }
        if (now() >= pending.ExecuteAt)
        {
            ExpirePending();
            return new("not_pending", "O prazo da ação já foi atingido.", true, request.RequestId);
        }
        system.Cancel(pending.Action);
        ControlAudit.TryWrite(audit, "power-cancelled:" + pending.Action, sid);
        var action = pending.Action;
        pending = null;
        RememberCancelled(request.RequestId);
        return new("cancelled", "Ação cancelada.", true, request.RequestId, action, Cancelled: true);
    }

    private ControlResponse PendingStatus(ControlRequest request, string sid)
    {
        if (!Guid.TryParse(request.RequestId, out _))
            return new("invalid_request", "Identificador de energia inválido.");
        ExpirePending();
        if (pending is not null && pending.RequestId == request.RequestId && pending.OwnerSid == sid)
            return new("pending", "A ação de energia permanece agendada.", true,
                pending.RequestId, pending.Action, pending.ExecuteAt);
        if (terminal.TryGetValue(request.RequestId!, out var previous) && previous.Cancelled)
            return new("cancelled", "Esta solicitação já foi cancelada.", true, request.RequestId, Cancelled: true);
        return new("not_pending", "A solicitação não está mais pendente no serviço.", true, request.RequestId);
    }

    private void RememberCancelled(string requestId)
    {
        terminal[requestId] = (true, now().AddMinutes(15));
    }

    private void ExpirePending()
    {
        if (pending is null || now() < pending.ExecuteAt) return;
        terminal[pending.RequestId] = (false, now().AddMinutes(15));
        pending = null;
    }

    private static ControlResponse Scheduled(Pending value) => new(
        "scheduled",
        "Ação agendada para dez segundos. Salve seu trabalho ou cancele.",
        true,
        value.RequestId,
        value.Action,
        value.ExecuteAt);
}
