namespace CepHoras.Control;

internal static class PolicyProfile
{
    internal const int CurrentVersion = 3;

    internal static PolicySnapshot Expected(ControlConfiguration configuration) => new(
        NativePolicy.Rights.ToDictionary(right => right,
            right => configuration.Version == 2 ? NativePolicy.Allowed.ToArray() : configuration.Original.Rights[right].ToArray()),
        PolicyStore.Settings.Select(setting => new SavedRegistry(true, setting.Value)).ToArray());

    internal static void MigrateActive(
        ControlConfiguration previous, Action<ControlConfiguration> save,
        Action<PolicySnapshot> apply, Func<PolicySnapshot> capture)
    {
        var legacy = Expected(previous);
        if (!PolicyValidation.Equal(capture(), legacy))
            throw new InvalidOperationException("A política ativa foi alterada externamente. A TI precisa revisar.");
        var next = previous with { Version = CurrentVersion, Active = false, Phase = "applying" };
        PolicyTransaction.Apply(
            () => save(next),
            () => apply(Expected(next)),
            () => PolicyValidation.Equal(capture(), Expected(next)),
            () => apply(legacy),
            () => save(next with { Active = true, Phase = "active" }),
            () => save(previous));
    }
}
