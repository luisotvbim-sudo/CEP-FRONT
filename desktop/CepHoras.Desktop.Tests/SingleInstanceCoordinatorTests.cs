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

            Exception? secondaryFailure = null;
            var secondaryThread = new Thread(() =>
            {
                try
                {
                    using var secondary = new SingleInstanceCoordinator(name);
                    check(!secondary.IsPrimary, "A second desktop instance became primary");
                    check(secondary.SignalPrimary(TimeSpan.FromSeconds(1)), "The second instance did not signal the primary");
                }
                catch (Exception error) { secondaryFailure = error; }
            });
            secondaryThread.Start();
            secondaryThread.Join();
            if (secondaryFailure is not null) throw secondaryFailure;
            check(activated.Wait(TimeSpan.FromSeconds(2)), "The primary instance did not receive activation");
        }

        using var replacement = new SingleInstanceCoordinator(name);
        check(replacement.IsPrimary, "The desktop instance lock was not released after exit");
        var abandonedName = name + ".abandoned";
        using var retained = new Mutex(false, $@"Local\{abandonedName}.Mutex");
        var owner = new Thread(() => { using var mutex = new Mutex(false, $@"Local\{abandonedName}.Mutex"); mutex.WaitOne(); });
        owner.Start();
        owner.Join();
        using var successor = new SingleInstanceCoordinator(abandonedName);
        check(successor.IsPrimary, "An existing handle to an abandoned mutex prevented replacement ownership");
    }
}
