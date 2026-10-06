using System.IO;
using System.Diagnostics;
using System.Text.Json;
using System.Security.Principal;
using System.Windows;
using System.Windows.Threading;
using CepHoras.Control.Protocol;
using CepHoras.Updates;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace CepHoras.Desktop;

public partial class MainWindow : Window
{
    private const string AppOrigin = "https://app.cephoras.local";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private ApiSession? session;

    private readonly GitHubDesktopUpdates updates = new();

    private readonly DispatcherTimer updateTimer = new() { Interval = TimeSpan.FromHours(6) };

    private readonly CancellationTokenSource lifetime = new();

    private DesktopRelease? availableUpdate;

    private Version? dismissedUpdate;

    private bool checkingForUpdates;

    private bool installingUpdate;
    private bool closingWithPassword;

    private bool closed;
    private bool exiting;
    private bool initialized;
    private bool hostSetupReady;
    private bool testPopup;
    private bool updatePopup;
    private System.Windows.Forms.NotifyIcon? tray;
    private readonly DispatcherTimer notificationTimer = new() { Interval = TimeSpan.FromSeconds(60) };
    private NotificationDelivery? notifications;
    private PowerBridgeHandler? power;
    private readonly bool managedInstallation = File.Exists(Path.Combine(AppContext.BaseDirectory, "managed-install.marker"));
    private readonly bool windowsAdministrator = new WindowsPrincipal(WindowsIdentity.GetCurrent())
        .IsInRole(WindowsBuiltInRole.Administrator);
    private readonly bool forceVisibleAfterRecovery;
    private string? inboxIntent;

    public MainWindow(bool forceVisibleAfterRecovery = false)
    {
        this.forceVisibleAfterRecovery = forceVisibleAfterRecovery;
        InitializeComponent();
        Loaded += Initialize;
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        System.Windows.Application.Current.SessionEnding += OnSessionEnding;
        Closing += (_, args) =>
        {
            if (!exiting && tray is not null)
            {
                args.Cancel = true;
                Hide();
                RecordNativeEvent("hidden-to-tray");
            }
        };
        updateTimer.Tick += async (_, _) => await CheckForUpdates();
        Closed += (_, _) =>
        {
            closed = true;
            lifetime.Cancel();
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            System.Windows.Application.Current.SessionEnding -= OnSessionEnding;
            notificationTimer.Stop();
            updateTimer.Stop();
            msiStatusTimer.Stop();
            webViewHealthTimer.Stop();
            tray?.Dispose();
            Browser.Dispose();
            profileLease?.Dispose();
            session?.Dispose();
        };
    }

    private void OnSessionEnding(object sender, SessionEndingCancelEventArgs args)
    {
        if (managedInstallation && !windowsAdministrator && power?.SessionEndingAllowed != true)
        {
            args.Cancel = true;
            OpenWindow(false);
            return;
        }
        exiting = true;
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs args)
    {
        if (args.Mode == PowerModes.Resume)
            Dispatcher.BeginInvoke(() => { if (!closed) webViewLifecycle.Resume(Environment.TickCount64); });
    }

    private async void Initialize(object sender, RoutedEventArgs e)
    {
        if (initialized) return;
        initialized = true;
        webViewHealthTimer.Tick += async (_, _) => await CheckWebViewContent();
        BeginWebViewLoading();
        try
        {
#if DEBUG
            const string defaultApi = "http://127.0.0.1:8080";
#else
            const string defaultApi = "https://api.cep.lat";
#endif
            var api = new Uri(Environment.GetEnvironmentVariable("CEP_API_URL") ?? defaultApi);
            if (api.Scheme != "https" && !(api.Scheme == "http" && api.IsLoopback))
                throw new InvalidOperationException("HTTPS is required outside loopback.");
            session = new ApiSession(api);
            power = managedInstallation ? new PowerBridgeHandler(session) : null;
            notifications = new NotificationDelivery(session);
            ConfigureTray();
            if (managedInstallation) _ = ResumeDesktopSupervision();
            if (managedInstallation) StartMsiUpdates();
            notificationTimer.Tick += async (_, _) => await notifications.Poll(ShowNotificationSummary);
            notificationTimer.Start();
            hostSetupReady = true;
            await CreateWebView();
            if (Environment.GetCommandLineArgs().Contains("--background") && !forceVisibleAfterRecovery) Hide();
            if (Environment.GetCommandLineArgs().Contains("--test-notification")) ShowTestNotification();
#if !DEBUG
            if (File.Exists(Path.Combine(AppContext.BaseDirectory, "msix-install.marker")) &&
                File.Exists(Path.Combine(AppContext.BaseDirectory, "AppxManifest.xml")))
            {
                updateTimer.Start();
                _ = CheckForUpdates();
            }
#endif
        }
        catch (WebView2RuntimeNotFoundException)
        {
            FailWebView("Instale o Microsoft Edge WebView2 Runtime e abra o CEP Horas novamente.", "runtime-missing", false);
        }
        catch (Exception error)
        {
            WriteWebViewDiagnostic("initialization-failed", error.GetType().Name);
            FailWebView(browserCreationUnconfirmed
                ? "O navegador não confirmou a inicialização. Abra o aplicativo novamente ou solicite suporte à TI."
                : hostSetupReady
                ? "Não foi possível iniciar a interface do CEP Horas."
                : "Não foi possível preparar o CEP Horas. Confira a instalação e a configuração da API e abra o aplicativo novamente.",
                hostSetupReady ? "initialization-failed" : "host-initialization-failed", hostSetupReady && !browserCreationUnconfirmed);
        }
    }

}
