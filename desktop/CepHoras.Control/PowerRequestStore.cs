using System.IO;
using System.Security.Principal;

namespace CepHoras.Control;

// This is private service recovery state, never authority to call the API again.
internal sealed record PowerPending(string RequestId, string Action, string OwnerSid,
    DateTimeOffset? ExecuteAt, string Phase, string BrokerInstanceId);
internal sealed record PowerTerminal(bool Cancelled, DateTimeOffset Expires, string OriginalBrokerInstanceId);
internal sealed record PowerRequestJournal(PowerPending? Pending,
    Dictionary<string, PowerTerminal> Terminal, int Schema = 1);

internal interface IPowerRequestStore
{
    PowerRequestJournal? Read();
    void Save(PowerRequestJournal journal);
}

internal sealed class MemoryPowerRequestStore : IPowerRequestStore
{
    private PowerRequestJournal? state;
    public PowerRequestJournal? Read() => state is null ? null : Clone(state);
    public void Save(PowerRequestJournal journal) => state = Clone(journal);
    private static PowerRequestJournal Clone(PowerRequestJournal journal) => journal with
    {
        Terminal = new Dictionary<string, PowerTerminal>(journal.Terminal, StringComparer.Ordinal)
    };
}

internal sealed class PrivatePowerRequestStore : IPowerRequestStore
{
    private static readonly string PathName = Path.Combine(PolicyStore.Root, "power-journal.json");
    public PowerRequestJournal? Read()
    {
        if (!File.Exists(PathName)) return null;
        PolicyStore.SecureDirectory();
        var journal = PolicyStore.ReadPrivate<PowerRequestJournal>(PathName);
        PowerRequestValidation.Validate(journal);
        return journal;
    }

    public void Save(PowerRequestJournal journal)
    {
        PowerRequestValidation.Validate(journal);
        PolicyStore.SecureDirectory();
        PolicyStore.AtomicWrite(PathName, journal);
    }
}

internal static class PowerRequestValidation
{
    internal static void Validate(PowerRequestJournal journal)
    {
        if (journal.Schema != 1 || journal.Terminal is null || journal.Terminal.Count > 4097)
            throw new InvalidDataException("Journal de energia inválido.");
        foreach (var entry in journal.Terminal)
            if (!Canonical(entry.Key) || entry.Value is null || !Canonical(entry.Value.OriginalBrokerInstanceId) ||
                entry.Value.Expires == default)
                throw new InvalidDataException("Estado terminal de energia inválido.");
        if (journal.Pending is not { } pending) return;
        if (!Canonical(pending.RequestId) || !Canonical(pending.BrokerInstanceId) ||
            pending.Action is not ("shutdown" or "restart" or "hibernate") ||
            pending.Phase is not ("preparing" or "scheduled") ||
            pending.Phase == "preparing" && pending.ExecuteAt is not null ||
            pending.Phase == "scheduled" && pending.ExecuteAt is null ||
            journal.Terminal.ContainsKey(pending.RequestId))
            throw new InvalidDataException("Intenção de energia inválida.");
        try { _ = new SecurityIdentifier(pending.OwnerSid); }
        catch (ArgumentException) { throw new InvalidDataException("Dono da intenção de energia inválido."); }
    }

    private static bool Canonical(string? value) => Guid.TryParse(value, out var guid) && value == guid.ToString();
}
