using System.Windows;

namespace CepHoras.Desktop;

public partial class App : System.Windows.Application
{
    private SingleInstanceCoordinator? singleInstance;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        WebViewProfileRecovery.WaitForPreviousProcess(e.Args, TimeSpan.FromSeconds(15));
        bool showAfterRecovery;
        using (WebViewProfileRecovery.EnterStartupGate(TimeSpan.FromSeconds(20)))
        {
            showAfterRecovery = WebViewProfileRecovery.ResetIfRequested();
            var instanceName = "Conceito.CepHoras.Desktop";
#if DEBUG
            // A disposable UI fixture must never activate the installed Release app.
            if (Environment.GetEnvironmentVariable("CEP_DESKTOP_TESTING") == "1" &&
                Environment.GetEnvironmentVariable("CEP_SESSION_DIR") is string fixtureDirectory &&
                !string.IsNullOrWhiteSpace(fixtureDirectory))
                instanceName += ".Fixture." + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                    System.Text.Encoding.UTF8.GetBytes(System.IO.Path.GetFullPath(fixtureDirectory))));
#endif
            singleInstance = new SingleInstanceCoordinator(instanceName);
        }
        if (!singleInstance.IsPrimary)
        {
            singleInstance.SignalPrimary(TimeSpan.FromSeconds(2));
            Shutdown();
            return;
        }

        var window = new MainWindow(showAfterRecovery);
        MainWindow = window;
        singleInstance.StartListening(() => Dispatcher.BeginInvoke(window.OpenFromExternalInstance));
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        singleInstance?.Dispose();
        base.OnExit(e);
    }
}
