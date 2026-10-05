using System.IO;
using System.Security.Principal;

namespace CepHoras.Control;

internal static class PolicyValidation
{
    internal static void Configuration(ControlConfiguration? config)
    {
        if (config is null || config.Version != 2 ||
            config.Phase is not ("applying" or "active" or "restored") ||
            config.Active != (config.Phase == "active"))
            throw new InvalidDataException("Configuração incompatível.");
        Snapshot(config.Original, PolicyStore.Settings.Length);
    }

    internal static void Snapshot(PolicySnapshot? snapshot, int registryCount)
    {
        if (snapshot?.Registry is null || snapshot.Rights is null ||
            snapshot.Registry.Length != registryCount || snapshot.Registry.Any(x => x is null) ||
            snapshot.Rights.Count != NativePolicy.Rights.Length ||
            !NativePolicy.Rights.All(snapshot.Rights.ContainsKey))
            throw new InvalidDataException("Backup de política incompatível.");
        foreach (var accounts in snapshot.Rights.Values)
        {
            if (accounts is null || accounts.Length > 1024 || accounts.Distinct(StringComparer.Ordinal).Count() != accounts.Length)
                throw new InvalidDataException("Direitos do backup inválidos.");
            foreach (var account in accounts)
            {
                try
                {
                    if (string.IsNullOrEmpty(account) || new SecurityIdentifier(account).Value != account)
                        throw new InvalidDataException("Identidade do backup inválida.");
                }
                catch (ArgumentException error) { throw new InvalidDataException("Identidade do backup inválida.", error); }
            }
        }
    }

    internal static void Journal(UninstallJournal? journal)
    {
        if (journal is null || journal.Schema != 1) throw new InvalidDataException("Journal de restauração incompatível.");
        Configuration(journal.Configuration);
        Snapshot(journal.BeforeRestore, PolicyStore.Settings.Length);
    }

    internal static bool Equal(PolicySnapshot first, PolicySnapshot second) =>
        first.Registry.SequenceEqual(second.Registry) && NativePolicy.Rights.All(right =>
            first.Rights[right].Order(StringComparer.Ordinal).SequenceEqual(second.Rights[right].Order(StringComparer.Ordinal)));
}
