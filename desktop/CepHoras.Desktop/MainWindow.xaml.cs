using System.IO;
using System.Diagnostics;
using System.Text.Json;
using System.Security.Principal;
using System.Windows;
using System.Windows.Threading;
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

    private bool closed;
    private bool exiting;
    private bool initialized;
    private bool testPopup;
    private System.Windows.Forms.NotifyIcon? tray;
    private readonly DispatcherTimer notificationTimer = new() { Interval = TimeSpan.FromSeconds(60) };
    private NotificationDelivery? notifications;
    private PowerBridgeHandler? power;
    private readonly bool managedInstallation = File.Exists(Path.Combine(AppContext.BaseDirectory, "managed-install.marker"));
    private readonly bool windowsAdministrator = new WindowsPrincipal(WindowsIdentity.GetCurrent())
        .IsInRole(WindowsBuiltInRole.Administrator);
    private readonly bool forceVisibleAfterRecovery;

    public MainWindow(bool forceVisibleAfterRecovery = false)
    {
        this.forceVisibleAfterRecovery = forceVisibleAfterRecovery;
        InitializeComponent();
        Loaded += Initialize;
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
            System.Windows.Application.Current.SessionEnding -= OnSessionEnding;
            notificationTimer.Stop();
            updateTimer.Stop();
            tray?.Dispose();
            Browser.Dispose();
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

    private async void Initialize(object sender, RoutedEventArgs e)
    {
        if (initialized) return;
        initialized = true;
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
            power = new PowerBridgeHandler(session);
            notifications = new NotificationDelivery(session);
            ConfigureTray();
            notificationTimer.Tick += async (_, _) => await notifications.Poll(ShowNotificationSummary);
            notificationTimer.Start();
            var webViewDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras", "WebView2");
#if DEBUG
            var isolatedTestProfile = Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER");
            if (!string.IsNullOrWhiteSpace(isolatedTestProfile)) webViewDataFolder = isolatedTestProfile;
#endif
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: webViewDataFolder);
            await Browser.EnsureCoreWebView2Async(environment);
            var core = Browser.CoreWebView2;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
#if !DEBUG
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
#endif
            core.SetVirtualHostNameToFolderMapping("app.cephoras.local", Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.DenyCors);
            await core.AddScriptToExecuteOnDocumentCreatedAsync(managedInstallation
                ? "window.__CEP_DESKTOP__ = true; window.__CEP_POWER_VERSION__ = 1;"
                : "window.__CEP_DESKTOP__ = true;");
            core.NavigationStarting += (_, args) => { if (!IsAppOrigin(args.Uri)) args.Cancel = true; };
            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (args.IsUserInitiated && Uri.TryCreate(args.Uri, UriKind.Absolute, out var link) && link.Scheme == "https")
                {
                    try { Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true }); }
                    catch { /* Opening a link must not close the application. */ }
                }
            };
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += HandleMessage;
            core.NavigationCompleted += (_, args) =>
            {
                Browser.Visibility = args.IsSuccess ? Visibility.Visible : Visibility.Hidden;
                StartupStatus.Text = args.IsSuccess ? "" : "Não foi possível carregar a interface. Reabra o CEP Horas.";
                ForceRestartButton.Visibility = args.IsSuccess ? Visibility.Collapsed : Visibility.Visible;
            };
            core.Navigate($"{AppOrigin}/index.html");
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
            StartupStatus.Text = "Instale o Microsoft Edge WebView2 Runtime e abra o CEP Horas novamente.";
            ForceRestartButton.Visibility = Visibility.Visible;
        }
        catch
        {
            StartupStatus.Text = "Não foi possível iniciar o CEP Horas. Confira a instalação e a configuração da API.";
            ForceRestartButton.Visibility = Visibility.Visible;
        }
    }

    private static bool IsAppOrigin(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var value) && value.GetLeftPart(UriPartial.Authority) == AppOrigin;

    private async void HandleMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsAppOrigin(e.Source) || e.WebMessageAsJson.Length > 16_384) return;
        string? id = null;
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
#if DEBUG
            // Only the disposable desktop fixture can drive native UI in Debug builds.
            if (root.GetProperty("type").GetString() == "cep-desktop-test" &&
                Environment.GetEnvironmentVariable("CEP_DESKTOP_TESTING") == "1")
            {
                switch (root.GetProperty("action").GetString())
                {
                    case "popup": ShowTestNotification(); break;
                    case "hide": Close(); break;
                    case "open-inbox": OpenWindow(true); break;
                    case "exit": exiting = true; Close(); break;
                }
                return;
            }
#endif
            var type = root.GetProperty("type").GetString();
            id = root.GetProperty("id").GetString();
            if (!Guid.TryParse(id, out _)) return;
            var operation = root.GetProperty("operation").GetString();
            var payload = root.GetProperty("payload");
            if (type == "cep-power")
            {
                if (!managedInstallation || power is null) throw new PowerBridgeFailure("native_power_unavailable");
                var powerResult = await power.Execute(operation, payload);
                Reply(new { id, ok = true, result = powerResult });
                return;
            }
            if (type != "cep-auth") return;
            if (operation == "logout" && power is not null) await power.CancelCurrent();
            var result = await session!.Execute(operation, payload);
            Reply(new { id, ok = true, result });
            if (operation is "login" or "restore" && notifications is not null)
                await notifications.Poll(ShowNotificationSummary);
        }
        catch (PowerBridgeFailure failure) { Reply(new { id, ok = false, error = new { code = failure.Code, correlationId = failure.CorrelationId } }); }
        catch (ApiFailure failure) { Reply(new { id, ok = false, error = new { status = failure.Status, code = failure.Code, correlationId = failure.CorrelationId, transportFailure = failure.TransportFailure } }); }
        catch { if (id is not null) Reply(new { id, ok = false, error = new { code = "desktop_request_failed" } }); }
    }

    private void ConfigureTray()
    {
        tray = new System.Windows.Forms.NotifyIcon
        {
            Text = "CEP Horas",
            Icon = System.Drawing.SystemIcons.Information,
            Visible = true,
            ContextMenuStrip = new System.Windows.Forms.ContextMenuStrip()
        };
        tray.ContextMenuStrip.Items.Add("Abrir CEP Horas", null, (_, _) => OpenWindow(false));
        tray.ContextMenuStrip.Items.Add("Minhas notificações", null, (_, _) => OpenWindow(true));
        tray.ContextMenuStrip.Items.Add("Testar notificação", null, (_, _) => ShowTestNotification());
        if (!managedInstallation || windowsAdministrator)
            tray.ContextMenuStrip.Items.Add("Sair do aplicativo", null, async (_, _) =>
            {
                if (power is not null) await power.CancelCurrent();
                exiting = true;
                Close();
            });
        tray.DoubleClick += (_, _) => OpenWindow(false);
        tray.BalloonTipClicked += (_, _) => OpenWindow(!testPopup);
        tray.BalloonTipShown += (_, _) => RecordNativeEvent("popup-shown-by-windows");
#if !DEBUG
        // Only the stable per-user installation registers Run. Portable previews must
        // not register a temporary path; MSIX owns startup through its manifest.
        if (File.Exists(Path.Combine(AppContext.BaseDirectory, "installed-per-user.marker")) &&
            !File.Exists(Path.Combine(AppContext.BaseDirectory, "msix-install.marker")))
        {
            try
            {
                using var run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
                var executable = Path.Combine(AppContext.BaseDirectory, "CepHoras.exe");
                if (File.Exists(executable)) run.SetValue("CepHoras", $"\"{executable}\" --background");
            }
            catch (Exception exception) when (exception is UnauthorizedAccessException or System.Security.SecurityException or IOException)
            {
                // A corporate startup policy must not prevent manual use of the app.
            }
        }
#endif
    }

    private async void OpenWindow(bool inbox)
    {
        if (closed) return;
        Show();
        WindowState = WindowState.Normal;
        Activate();
        try
        {
            if (inbox && Browser.CoreWebView2 is not null && IsAppOrigin(Browser.Source?.ToString() ?? ""))
                await Browser.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('cep-open-notifications'));");
            RecordNativeEvent(inbox ? "opened-inbox" : "opened-window");
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            // Closing or reloading WebView2 while clicking a popup must not crash the host.
        }
    }

    internal void OpenFromExternalInstance() => OpenWindow(false);

    private void ForceRestart_Click(object sender, RoutedEventArgs e)
    {
        ForceRestartButton.IsEnabled = false;
        StartupStatus.Text = "Fechando os componentes do CEP Horas e recriando o navegador local…";
        try
        {
            WebViewProfileRecovery.Request();
            TerminateOwnedWebViewProcesses();
            TerminatePeerDesktopProcesses();
            Process.Start(WebViewProfileRecovery.CreateRestartInfo());
            exiting = true;
            Close();
        }
        catch
        {
            StartupStatus.Text = "Não foi possível reiniciar automaticamente. Feche o CEP Horas e abra novamente.";
            ForceRestartButton.IsEnabled = true;
        }
    }

    private void TerminateOwnedWebViewProcesses()
    {
        var ids = Browser.CoreWebView2?.Environment.GetProcessInfos().Select(item => item.ProcessId).ToArray() ?? [];
        foreach (var id in ids)
        {
            try
            {
                using var process = Process.GetProcessById(id);
                process.Kill(entireProcessTree: true);
                process.WaitForExit(2_000);
            }
            catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        }
    }

    private static void TerminatePeerDesktopProcesses()
    {
        using var current = Process.GetCurrentProcess();
        var expected = Path.GetFullPath(Environment.ProcessPath ?? "");
        foreach (var process in Process.GetProcessesByName("CepHoras"))
        {
            using (process)
            {
                if (process.Id == current.Id || process.SessionId != current.SessionId) continue;
                try
                {
                    var actual = Path.GetFullPath(process.MainModule?.FileName ?? "");
                    if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)) continue;
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(2_000);
                }
                catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or IOException) { }
            }
        }
    }

    private void ShowNotificationSummary(int count)
    {
        if (closed || tray is null) return;
        testPopup = false;
        tray?.ShowBalloonTip(10_000, "CEP Horas", $"Você tem {count} nova(s) notificação(ões). Abra a central para conferir as mensagens e seus horários originais.", System.Windows.Forms.ToolTipIcon.Info);
        RecordNativeEvent("notification-summary-requested");
    }

    private void ShowTestNotification()
    {
        if (closed || tray is null) return;
        testPopup = true;
        tray.ShowBalloonTip(10_000, "CEP Horas · teste de notificação",
            "Este é um teste local do aviso do Windows. Nenhuma mensagem foi enviada a outras pessoas. Clique para abrir o CEP Horas.",
            System.Windows.Forms.ToolTipIcon.Info);
        RecordNativeEvent("test-popup-requested");
    }

    [Conditional("DEBUG")]
    private static void RecordNativeEvent(string value)
    {
        if (Environment.GetEnvironmentVariable("CEP_DESKTOP_TESTING") != "1") return;
        var directory = Environment.GetEnvironmentVariable("CEP_SESSION_DIR");
        if (string.IsNullOrWhiteSpace(directory)) return;
        try { File.AppendAllText(Path.Combine(directory, "native-ui.events"), value + Environment.NewLine); }
        catch (IOException) { }
    }

    private void Reply(object message)
    {
        if (!closed && Browser.CoreWebView2 is not null && IsAppOrigin(Browser.Source?.ToString() ?? ""))
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
    }

    private async Task CheckForUpdates()
    {
        if (closed || checkingForUpdates || installingUpdate) return;
        checkingForUpdates = true;
        try
        {
            var installed = GetType().Assembly.GetName().Version ?? new Version(0, 0, 0, 0);
            var release = await updates.CheckAsync(installed, lifetime.Token);
            if (closed || installingUpdate || release is null || release.Version == dismissedUpdate) return;
            availableUpdate = release;
            UpdateMessage.Text = $"CEP Horas {release.Version} disponível. Você pode atualizar agora ou continuar trabalhando.";
            UpdateNowButton.IsEnabled = true;
            UpdateBanner.Visibility = Visibility.Visible;
        }
        catch (OperationCanceledException) when (closed) { }
        catch { /* A falta de conexão com o GitHub não impede o uso do aplicativo. */ }
        finally { checkingForUpdates = false; }
    }

    private async void UpdateNow_Click(object sender, RoutedEventArgs e)
    {
        if (availableUpdate is null || installingUpdate) return;
        installingUpdate = true;
        UpdateNowButton.IsEnabled = false;
        UpdateLaterButton.IsEnabled = false;
        UpdateMessage.Text = "Baixando e verificando a atualização…";
        try
        {
            var package = await updates.DownloadAsync(availableUpdate,
                Path.Combine(AppContext.BaseDirectory, "AppxManifest.xml"), lifetime.Token);
            if (closed) return;
            Process.Start(new ProcessStartInfo(package) { UseShellExecute = true });
            UpdateMessage.Text = "O instalador do Windows foi aberto. Confirme a atualização e feche o CEP Horas se solicitado.";
        }
        catch (OperationCanceledException) when (closed) { }
        catch
        {
            UpdateMessage.Text = "Não foi possível abrir a atualização. Tente novamente mais tarde.";
        }
        finally
        {
            installingUpdate = false;
            if (!closed)
            {
                UpdateNowButton.IsEnabled = true;
                UpdateLaterButton.IsEnabled = true;
            }
        }
    }

    private void UpdateLater_Click(object sender, RoutedEventArgs e)
    {
        dismissedUpdate = availableUpdate?.Version;
        UpdateBanner.Visibility = Visibility.Collapsed;
    }

}
