using System.Windows;
using System.Windows.Controls;

namespace CepHoras.Desktop;

public partial class App : System.Windows.Application
{
    private SingleInstanceCoordinator? singleInstance;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        // Display a native first frame even while the previous process/profile
        // is exiting. Files/IPC waits never occupy the visual thread.
        var status = new TextBlock { Text = "Preparando o CEP Horas…", Margin = new Thickness(28), TextWrapping = TextWrapping.Wrap };
        var splash = new Window { Title = "CEP Horas", Width = 440, Height = 160,
            WindowStartupLocation = WindowStartupLocation.CenterScreen, Content = status };
        var startupInProgress = true;
        splash.Closing += (_, args) => args.Cancel = startupInProgress;
        splash.Show();
        try
        {
            await WebViewProfileRecovery.WaitForPreviousProcessAsync(e.Args, TimeSpan.FromSeconds(15));
            var instanceName = "Conceito.CepHoras.Desktop";
#if DEBUG
            if (Environment.GetEnvironmentVariable("CEP_DESKTOP_TESTING") == "1" &&
                Environment.GetEnvironmentVariable("CEP_SESSION_DIR") is string fixtureDirectory && !string.IsNullOrWhiteSpace(fixtureDirectory))
                instanceName += ".Fixture." + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                    System.Text.Encoding.UTF8.GetBytes(System.IO.Path.GetFullPath(fixtureDirectory))));
#endif
            // Primary ownership must precede a profile reset, including when a
            // secondary still holds an abandoned mutex object's handle.
            singleInstance = new SingleInstanceCoordinator(instanceName);
            if (!singleInstance.IsPrimary)
            {
                await Task.Run(() => singleInstance.SignalPrimary(TimeSpan.FromSeconds(2)));
                Shutdown();
                return;
            }
            var profile = WebViewProfileRecovery.GetProfilePath();
            ProfileRecoveryResult recovery;
            using (await WebViewProfileRecovery.EnterStartupGateAsync(profile, TimeSpan.FromSeconds(20)))
                recovery = await Task.Run(() => WebViewProfileRecovery.ResetIfRequested(profile));
            if (recovery == ProfileRecoveryResult.Failed)
                throw new System.IO.IOException("O perfil local ainda está em uso ou não pôde ser preservado. Tente novamente ou solicite suporte à TI.");
            var window = new MainWindow(recovery == ProfileRecoveryResult.Completed);
            MainWindow = window;
            singleInstance.StartListening(() => Dispatcher.BeginInvoke(window.OpenFromExternalInstance));
            window.Show();
            startupInProgress = false;
            splash.Close();
            ShutdownMode = ShutdownMode.OnMainWindowClose;
        }
        catch
        {
            status.Text = "Não foi possível iniciar com segurança. O perfil foi preservado. Feche esta janela e tente novamente ou solicite suporte à TI.";
            // Release remains on the Dispatcher thread which owns the mutex.
            singleInstance?.Dispose();
            singleInstance = null;
            startupInProgress = false;
            splash.Closing += (_, _) => Shutdown();
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        singleInstance?.Dispose();
        base.OnExit(e);
    }
}
