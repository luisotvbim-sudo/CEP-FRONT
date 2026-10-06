using CepHoras.Control;

internal static class PolicyProfileChecks
{
    internal static void Run()
    {
        var count = 0;
        void Check(bool value, string message) { if (!value) throw new Exception(message); count++; }
        void Fails(Action operation)
        {
            try { operation(); }
            catch (Exception error) when (error is IOException or InvalidOperationException) { count++; return; }
            throw new Exception("Expected migration failure");
        }
        var original = new PolicySnapshot(new()
        {
            ["SeShutdownPrivilege"] = ["S-1-5-32-545", "S-1-5-32-544"],
            ["SeRemoteShutdownPrivilege"] = ["S-1-5-32-544"]
        }, PolicyStore.Settings.Select(_ => new SavedRegistry(false, 0)).ToArray());
        var previous = new ControlConfiguration(2, true, "active", original);
        var next = previous with { Version = PolicyProfile.CurrentVersion };
        PolicyValidation.Configuration(previous);
        PolicyValidation.Configuration(next);
        PolicyValidation.UpgradeJournal(new(previous, PolicyProfile.Expected(previous)));
        PolicyValidation.UpgradeJournal(new(previous with { Active = false, Phase = "restored" }, original));
        foreach (var invalid in new[] {
            new PolicyUpgradeJournal(previous, original, Schema: 99),
            new PolicyUpgradeJournal(previous with { Active = false, Phase = "applying" }, original),
            new PolicyUpgradeJournal(previous, original with { Registry = [] }) })
        {
            try { PolicyValidation.UpgradeJournal(invalid); throw new Exception("Invalid upgrade checkpoint accepted"); }
            catch (InvalidDataException) { count++; }
        }
        var expected = PolicyProfile.Expected(next);
        Check(expected.Rights["SeShutdownPrivilege"].SequenceEqual(original.Rights["SeShutdownPrivilege"]), "preserve original local shutdown rights");
        Check(expected.Rights["SeRemoteShutdownPrivilege"].SequenceEqual(original.Rights["SeRemoteShutdownPrivilege"]), "preserve original remote shutdown rights");
        Check(expected.Registry.All(value => value.Exists), "registry controls remain applied");
        expected.Rights["SeShutdownPrivilege"][0] = "S-1-5-18";
        Check(original.Rights["SeShutdownPrivilege"][0] == "S-1-5-32-545", "expected state cannot mutate the original backup");
        var restrictedOriginal = original with { Rights = NativePolicy.Rights.ToDictionary(right => right, _ => new[] { "S-1-5-32-544" }) };
        Check(!PolicyProfile.Expected(next with { Original = restrictedOriginal }).Rights["SeShutdownPrivilege"].Contains("S-1-5-32-545"), "do not grant rights absent from the original corporate policy");

        var current = PolicyProfile.Expected(previous);
        ControlConfiguration saved = previous;
        PolicyProfile.MigrateActive(previous, value => saved = value, value => current = value, () => current);
        Check(saved.Version == 3 && saved.Active && saved.Phase == "active", "migration commits the reversible profile");
        Check(ReferenceEquals(saved.Original, original), "migration preserves the original snapshot");
        Check(PolicyValidation.Equal(current, PolicyProfile.Expected(next)), "migration restores rights while retaining registry controls");

        foreach (var failure in new[] { "backup", "apply", "verify", "commit" })
        {
            current = PolicyProfile.Expected(previous);
            saved = previous;
            var effects = 0;
            var failOnce = true;
            Fails(() => PolicyProfile.MigrateActive(previous,
                value =>
                {
                    if (failOnce && ((failure == "backup" && value.Phase == "applying") ||
                        (failure == "commit" && value.Version == 3 && value.Active)))
                    { failOnce = false; throw new IOException("fixture persistence failure"); }
                    saved = value;
                },
                value =>
                {
                    effects++;
                    current = value;
                    if (failOnce && failure == "apply") { failOnce = false; throw new IOException("fixture partial write"); }
                    if (failOnce && failure == "verify")
                    { failOnce = false; current = current with { Registry = original.Registry }; }
                }, () => current));
            Check(saved == previous && PolicyValidation.Equal(current, PolicyProfile.Expected(previous)), "failed migration restores the previous active profile: " + failure);
            if (failure == "backup") Check(effects == 0, "failed durable backup prevents every policy effect");
        }
        current = PolicyProfile.Expected(previous);
        saved = previous;
        try
        {
            PolicyProfile.MigrateActive(previous, value => saved = value,
                _ => throw new IOException("fixture application and rollback failure"), () => current);
            throw new Exception("Rollback failure hidden");
        }
        catch (AggregateException)
        {
            Check(saved.Version == 3 && !saved.Active && saved.Phase == "applying", "failed rollback retains durable recovery state");
            Check(ReferenceEquals(saved.Original, original), "failed rollback preserves the original rights and registry snapshot");
        }
        current = PolicyProfile.Expected(previous) with { Registry = original.Registry };
        var mutated = false;
        try
        {
            PolicyProfile.MigrateActive(previous, _ => mutated = true, _ => mutated = true, () => current);
            throw new Exception("External policy drift accepted");
        }
        catch (InvalidOperationException) { Check(!mutated, "externally changed policies are not overwritten during migration"); }
        Console.WriteLine($"Policy profile migration: {count} checks passed. No Windows policy changed.");
    }
}
