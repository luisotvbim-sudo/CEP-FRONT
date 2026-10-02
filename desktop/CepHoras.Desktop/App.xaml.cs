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
            singleInstance = new SingleInstanceCoordinator("Conceito.CepHoras.Desktop");
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
