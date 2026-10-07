using System.IO;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal interface ISystemPower
{
    void Schedule(string action, int delaySeconds);
    // Return only after cancellation or confirmed absence of a pending OS action.
    void Cancel(string action);
}

internal sealed class PowerAuthority(
    Func<ControlConfiguration?> configuration,
    Func<bool> healthy,
    ISystemPower system,
    Action<string, string> audit,
    Func<DateTimeOffset>? clock = null,
    Func<bool>? maintenance = null,
    IPowerRequestStore? store = null)
{
    private readonly object gate = new();
    private readonly string brokerInstanceId = Guid.NewGuid().ToString();
    private static readonly HashSet<string> Actions = new(StringComparer.Ordinal) { "shutdown", "restart", "hibernate" };
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private readonly IPowerRequestStore journal = store ?? new MemoryPowerRequestStore();
    private readonly Dictionary<string, PowerTerminal> terminal = new(StringComparer.Ordinal);
    private PowerPending? pending;
    private bool initialized, inherited, dirty;

    // Startup is read-only. Never replay or automatically cancel an inherited action.
    internal void Initialize()
    {
        lock (gate)
        {
            if (initialized) return;
            var saved = journal.Read();
            if (saved is not null)
            {
                PowerRequestValidation.Validate(saved);
                foreach (var entry in saved.Terminal) terminal.Add(entry.Key, entry.Value);
                pending = saved.Pending;
                inherited = pending is not null;
            }
            initialized = true;
        }
    }

    internal ControlResponse Handle(ControlRequest request, string sid)
    {
        lock (gate)
        {
            Initialize();
            foreach (var expired in terminal.Where(entry => entry.Value.Expires <= now()).Select(entry => entry.Key).ToArray())
            { terminal.Remove(expired); dirty = true; }
            if (Guid.TryParse(request.RequestId, out var id)) request = request with { RequestId = id.ToString() };
            if (request.Operation is "schedule" or "cancel" or "power-status" && request.BrokerInstanceId is not null &&
                request.BrokerInstanceId != brokerInstanceId && !MatchesRecovery(request, sid))
                return WithBroker(new("broker_changed", "O serviço foi reiniciado; confirme o estado da ação antes de continuar.", RequestId: request.RequestId));
            var response = WithBroker(HandleLocked(request, sid));
            return request.Operation == "status" ? response with { PowerStatusVersion = 1 } : response;
        }
    }

    private bool MatchesRecovery(ControlRequest request, string sid)
    {
        if (request.Operation is not ("cancel" or "power-status") || request.RequestId is null) return false;
        if (pending is { } value && value.RequestId == request.RequestId && value.OwnerSid == sid &&
            value.BrokerInstanceId == request.BrokerInstanceId) return true;
        return terminal.TryGetValue(request.RequestId, out var previous) && previous.Cancelled &&
            previous.OriginalBrokerInstanceId == request.BrokerInstanceId;
    }

    internal void CancelForMaintenance()
    {
        lock (gate)
        {
            Initialize();
            if (pending is not null && (inherited || pending.Phase == "preparing"))
                throw new InvalidOperationException("Ação de energia herdada/incerta exige cancelamento explícito pelo titular.");
            if (dirty && !Persist()) throw new IOException("Journal de energia indisponível para manutenção.");
            if (pending is null) return;
            var value = pending;
            system.Cancel(value.Action);
            Complete(value.RequestId, true, value.BrokerInstanceId);
            ControlAudit.TryWrite(audit, "power-cancelled-for-update:" + value.Action, value.OwnerSid);
            if (!Persist()) throw new IOException("Cancelamento confirmado; persistência pendente antes da manutenção.");
        }
    }

    private ControlResponse HandleLocked(ControlRequest request, string sid)
    {
        if (request.Operation == "status")
        {
            if (pending is not null && (inherited || pending.Phase == "preparing")) return Uncertain(sid);
            ExpirePending();
            if (pending is not null && pending.OwnerSid != sid) return Uncertain(sid);
            if (dirty && !Persist()) return StorageUnavailable();
            var active = configuration()?.Active == true && healthy();
            return new(active ? "ready" : "inactive", active ? "Controle local de energia ativo." : "Controle local ainda não está ativo ou precisa de revisão.", active,
                pending?.RequestId, pending?.Action, pending?.ExecuteAt, OriginalBrokerInstanceId: pending?.BrokerInstanceId);
        }
        if (request.Operation == "power-status") return PendingStatus(request, sid);
        if (request.Operation == "cancel") return Cancel(request, sid);
        if (request.Operation != "schedule") return new("invalid_request", "Operação inválida.");
        if (maintenance?.Invoke() == true) return new("update_maintenance", "O CEP Horas está sendo atualizado. Aguarde para solicitar uma ação de energia.");
        if (configuration()?.Active != true) return new("inactive", "Controle ainda não foi ativado pela instalação.");
        if (!healthy()) return new("policy_changed", "A política local foi alterada. A TI precisa revisar este computador.");
        if (!Guid.TryParse(request.RequestId, out _) || request.Action is null || !Actions.Contains(request.Action) || request.DelaySeconds != 10)
            return new("invalid_request", "Agendamento inválido.", true);
        if (dirty && !Persist()) return StorageUnavailable();
        if (terminal.TryGetValue(request.RequestId, out var previous)) return Terminal(request.RequestId, previous);
        ExpirePending();
        if (terminal.TryGetValue(request.RequestId, out previous)) return Terminal(request.RequestId, previous);
        if (pending is not null)
        {
            if (inherited || pending.Phase == "preparing") return Uncertain(sid);
            if (pending.RequestId == request.RequestId && pending.OwnerSid == sid) return Scheduled(pending);
            return new("pending", "Já existe uma ação de energia em andamento.", true);
        }
        if (terminal.Count >= 4096) return new("service_busy", "Aguarde antes de solicitar outra ação de energia.", true, request.RequestId);
        // Publish a durable intention before any effect; the deadline starts after flush.
        pending = new(request.RequestId, request.Action, sid, null, "preparing", brokerInstanceId);
        if (!Persist())
        {
            pending = null; // This process knows dispatch never occurred; flush the correction before retry.
            dirty = true;
            return StorageUnavailable();
        }
        var executeAt = now().AddSeconds(10);
        system.Schedule(request.Action, 10); // A throw can follow an effect: retain the preparing intention.
        pending = pending with { ExecuteAt = executeAt, Phase = "scheduled" };
        Persist(); // A disk failure cannot hide a successful OS action; later effects remain gated.
        ControlAudit.TryWrite(audit, "power-scheduled:" + request.Action, sid);
        return Scheduled(pending);
    }

    private ControlResponse Cancel(ControlRequest request, string sid)
    {
        if (!Guid.TryParse(request.RequestId, out _)) return new("invalid_request", "Cancelamento inválido.");
        if (pending is not null && (pending.RequestId != request.RequestId || pending.OwnerSid != sid))
            return new("not_pending", "Não há uma solicitação sua com esse identificador.", true, request.RequestId);
        if (pending is null)
        {
            if (terminal.TryGetValue(request.RequestId!, out var previous))
            {
                if (dirty && !Persist()) return StorageUnavailable();
                return Terminal(request.RequestId!, previous);
            }
            if (terminal.Count >= 4096) return new("service_busy", "Não foi possível confirmar o cancelamento. Solicite suporte à TI.", true, request.RequestId);
            terminal[request.RequestId!] = new(true, now().AddMinutes(15), brokerInstanceId);
            if (!Persist()) return StorageUnavailable(); // Pre-dispatch cancellation requires durable proof.
            return Terminal(request.RequestId!, terminal[request.RequestId!]);
        }
        if (inherited && request.BrokerInstanceId != pending.BrokerInstanceId) return Uncertain(sid);
        if (!inherited && pending.Phase == "scheduled" && now() >= pending.ExecuteAt)
        {
            ExpirePending();
            return Terminal(request.RequestId!, terminal[request.RequestId!]);
        }
        var value = pending;
        system.Cancel(value.Action); // Failure preserves the exact intention and permits explicit retry.
        Complete(value.RequestId, true, value.BrokerInstanceId);
        Persist(); // Cancellation is real even if its durable completion must be retried.
        ControlAudit.TryWrite(audit, "power-cancelled:" + value.Action, sid);
        return Terminal(value.RequestId, terminal[value.RequestId]);
    }

    private ControlResponse PendingStatus(ControlRequest request, string sid)
    {
        if (!Guid.TryParse(request.RequestId, out _)) return new("invalid_request", "Identificador de energia inválido.");
        ExpirePending();
        if (pending is not null && pending.RequestId == request.RequestId && pending.OwnerSid == sid)
        {
            if (inherited || pending.Phase == "preparing") return Uncertain(sid);
            return new("pending", "A ação de energia permanece agendada.", true, pending.RequestId, pending.Action, pending.ExecuteAt);
        }
        if (terminal.TryGetValue(request.RequestId!, out var previous))
        {
            if (dirty && !Persist()) return StorageUnavailable();
            return Terminal(request.RequestId!, previous);
        }
        return new("not_pending", "A solicitação não está mais pendente no serviço.", true, request.RequestId);
    }

    private void Complete(string id, bool cancelled, string origin)
    {
        terminal[id] = new(cancelled, now().AddMinutes(15), origin);
        pending = null;
        inherited = false;
        dirty = true;
    }

    private void ExpirePending()
    {
        // Time does not prove cancellation/absence of a request inherited from a dead process.
        if (pending is null || inherited || pending.Phase != "scheduled" || now() < pending.ExecuteAt) return;
        Complete(pending.RequestId, false, pending.BrokerInstanceId);
        Persist();
    }

    private bool Persist()
    {
        try
        {
            journal.Save(new(pending, new(terminal, StringComparer.Ordinal)));
            dirty = false;
            return true;
        }
        catch (Exception error)
        {
            dirty = true;
            ControlAudit.TryWrite(audit, "power-journal-failed:" + error.GetType().Name, "SYSTEM");
            return false;
        }
    }

    private ControlResponse Uncertain(string sid) => pending?.OwnerSid == sid
        ? new("power_uncertain", "Há uma solicitação de energia anterior sem confirmação. Cancele explicitamente antes de continuar.", true,
            pending.RequestId, pending.Action, pending.ExecuteAt, OriginalBrokerInstanceId: pending.BrokerInstanceId)
        : new("power_uncertain", "Há uma solicitação de energia pendente de revisão pelo titular ou pela TI.");
    private ControlResponse WithBroker(ControlResponse response) => response with { BrokerInstanceId = brokerInstanceId };
    private static ControlResponse StorageUnavailable() => new("power_storage_unavailable", "Não foi possível registrar o estado de energia. Solicite suporte à TI.");
    private static ControlResponse Terminal(string id, PowerTerminal value) => value.Cancelled
        ? new("cancelled", "A solicitação não está mais pendente.", true, id, Cancelled: true, OriginalBrokerInstanceId: value.OriginalBrokerInstanceId)
        : new("not_pending", "O prazo desta solicitação já foi atingido. Ela não será agendada novamente.", true, id);
    private static ControlResponse Scheduled(PowerPending value) => new("scheduled", "Ação agendada para dez segundos. Salve seu trabalho ou cancele.", true,
        value.RequestId, value.Action, value.ExecuteAt);
}
