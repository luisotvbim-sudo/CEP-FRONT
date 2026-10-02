using CepHoras.Desktop;

internal static class SingleInstanceCoordinatorTests
{
    public static void Run(Action<bool, string> check)
    {
        var name = "Conceito.CepHoras.Tests." + Guid.NewGuid().ToString("N");
        using var activated = new ManualResetEventSlim();
        using (var primary = new SingleInstanceCoordinator(name))
        {
            check(primary.IsPrimary, "The first desktop instance was not primary");
            primary.StartListening(activated.Set);

            using var secondary = new SingleInstanceCoordinator(name);
            check(!secondary.IsPrimary, "A second desktop instance became primary");
            check(secondary.SignalPrimary(TimeSpan.FromSeconds(1)), "The second instance did not signal the primary");
            check(activated.Wait(TimeSpan.FromSeconds(2)), "The primary instance did not receive activation");
        }

        using var replacement = new SingleInstanceCoordinator(name);
        check(replacement.IsPrimary, "The desktop instance lock was not released after exit");
    }
}
