namespace CepHoras.Control;

internal static class PolicyTransaction
{
    internal static void Apply(Action backup, Action apply, Func<bool> verify, Action restore, Action commit, Action markRestored)
    {
        backup(); // A failed durable backup MUST prevent the first system mutation.
        try
        {
            apply();
            if (!verify()) throw new InvalidOperationException("A verificação da política aplicada falhou.");
            commit();
        }
        catch (Exception original)
        {
            try { restore(); markRestored(); }
            catch (Exception recovery) { throw new AggregateException("Ativação falhou e a restauração precisa de recuperação pela TI. O backup foi preservado.", original, recovery); }
            throw;
        }
    }

    internal static void Restore(Action backup, Action restore, Func<bool> verify, Action commit)
    {
        backup();
        // Failure retains the original configuration and the durable uninstall
        // journal. MSI rollback or the administrative tool can retry safely.
        restore();
        if (!verify()) throw new InvalidOperationException("A verificação da política restaurada falhou.");
        commit();
    }
}
