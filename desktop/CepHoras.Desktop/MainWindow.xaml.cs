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
        if (DesktopTestEnvironment.Enabled) { Title = "CEP Horas Â· TESTE Â· energia simulada"; ReloadInterfaceButton.Content = "TESTE Â· API local Â· energia simulada Â· Recarregar interface"; }
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
            power = DesktopTestEnvironment.Enabled ? new PowerBridgeHandler(session, new SimulatedPowerBroker().Send) : managedInstallation ? new PowerBridgeHandler(session) : null;
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
                ? "O navegador nÃ£o confirmou a inicializaÃ§Ã£o. Abra o aplicativo novamente ou solicite suporte Ã  TI."
                : hostSetupReady
                ? "NÃ£o foi possÃ­vel iniciar a interface do CEP Horas."
                : "NÃ£o foi possÃ­vel preparar o CEP Horas. Confira a instalaÃ§Ã£o e a configuraÃ§Ã£o da API e abra o aplicativo novamente.",
                hostSetupReady ? "initialization-failed" : "host-initialization-failed", hostSetupReady && !browserCreationUnconfirmed);
        }
    }

    private static bool IsAppOrigin(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var value) && value.GetLeftPart(UriPartial.Authority) == AppOrigin;

    private async void HandleMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!ReferenceEquals(sender, Browser.CoreWebView2) || !IsAppOrigin(e.Source) || e.WebMessageAsJson.Length > 16_384) return;
        var messageGeneration = webViewLifecycle.Generation;
        var messageCore = Browser.CoreWebView2;
        void Respond(object response)
        {
            if (messageGeneration == webViewLifecycle.Generation && ReferenceEquals(messageCore, Browser.CoreWebView2)) Reply(response);
        }
        string? id = null;
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            if (root.GetProperty("type").GetString() == "cep-lifecycle") { HandleLifecycle(root); return; }
            if (root.GetProperty("type").GetString() == "cep-inbox-consumed")
            {
                if (webViewLifecycle.Ready && root.TryGetProperty("documentId", out var document) &&
                    document.ValueKind == JsonValueKind.String && document.GetString() == renderedDocumentId &&
                    root.TryGetProperty("token", out var consumed) && consumed.ValueKind == JsonValueKind.String && consumed.GetString() == inboxIntent)
                    inboxIntent = null;
                return;
            }
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
                    case "reload-ui": await ReloadWebView(); break;
                    case "recreate-ui": await RecoverWebView(WebViewRecoveryStage.Recreate, false); break;
                    case "resume-ui": webViewLifecycle.Resume(Environment.TickCount64); break;
                    case "reset-recovery-budget": webViewRecovery.Reset(); break;
                    case "update-downloading": installingUpdate = true; break;
                    case "update-failed": ShowMsiUpdate(new("update_status", "Fixture", UpdatePhase: "failed")); break;
                    case "ui-state":
                        Respond(new { id = root.GetProperty("id").GetString(), ok = true, result = new {
                            loading = WebViewLoadingIndicator.Visibility == Visibility.Visible,
                            recovery = StartupPanel.Visibility == Visibility.Visible,
                            browser = Browser.Visibility == Visibility.Visible,
                            reloadEnabled = ForceRestartButton.IsEnabled
                        }});
                        break;
                }
                return;
            }
#endif
            var type = root.GetProperty("type").GetString();
            if (type is "cep-auth" or "cep-power")
            {
                if (!root.TryGetProperty("documentId", out var documentId) || documentId.ValueKind != JsonValueKind.String ||
                    !Guid.TryParse(documentId.GetString(), out _)) return;
                var currentDocument = await messageCore!.ExecuteScriptAsync("window.__CEP_DOCUMENT_ID__")
                    .WaitAsync(TimeSpan.FromSeconds(3), lifetime.Token);
                if (messageGeneration != webViewLifecycle.Generation || !ReferenceEquals(messageCore, Browser.CoreWebView2) ||
                    JsonSerializer.Deserialize<string>(currentDocument) != documentId.GetString()) return;
            }
            id = root.GetProperty("id").GetString();
            if (!Guid.TryParse(id, out _)) return;
            var operation = root.GetProperty("operation").GetString();
            var payload = root.GetProperty("payload");
            if (type == "cep-power")
            {
                if ((!managedInstallation && !DesktopTestEnvironment.Enabled) || power is null) throw new PowerBridgeFailure("native_power_unavailable");
                var powerResult = await power.Execute(operation, payload);
                Respond(new { id, ok = true, result = powerResult });
                return;
            }
            if (type != "cep-auth") return;
            await using var sessionPowerLease = operation == "logout" && power is not null ? await power.QuiesceAsync(lifetime.Token) : null;
            var result = await session!.Execute(operation, payload);
            Respond(new { id, ok = true, result });
            if (operation is "login" or "restore" && notifications is not null)
                await notifications.Poll(ShowNotificationSummary);
        }
        catch (PowerBridgeFailure failure) { Respond(new { id, ok = false, error = new { code = failure.Code, correlationId = failure.CorrelationId, requestId = failure.RequestId } }); }
        catch (ApiFailure failure) { Respond(new { id, ok = false, error = new { status = failure.Status, code = failure.Code, correlationId = failure.CorrelationId, transportFailure = failure.TransportFailure, retryAfterSeconds = failure.RetryAfterSeconds } }); }
        catch { if (id is not null) Respond(new { id, ok = false, error = new { code = "desktop_request_failed" } }); }
    }

    private void ConfigureTray()
    {
        tray = new System.Windows.Forms.NotifyIcon
        {
            Text = DesktopTestEnvironment.Enabled ? "CEP Horas TESTE" : "CEP Horas",
            Icon = System.Drawing.SystemIcons.Information,
            Visible = true,
            ContextMenuStrip = new System.Windows.Forms.ContextMenuStrip()
        };
        tray.ContextMenuStrip.Items.Add("Abrir CEP Horas", null, (_, _) => OpenWindow(false));
        tray.ContextMenuStrip.Items.Add("Recarregar interface", null, async (_, _) => { OpenWindow(false); await ReloadWebView(); });
        tray.ContextMenuStrip.Items.Add("Minhas notificaÃ§Ãµes", null, (_, _) => OpenWindow(true));
        tray.ContextMenuStrip.Items.Add("Testar notificaÃ§Ã£o", null, (_, _) => ShowTestNotification());
        if (managedInstallation)
            tray.ContextMenuStrip.Items.Add("Verificar atualizaÃ§Ãµes", null, async (_, _) =>
            {
                OpenWindow(false);
                await CheckMsiUpdates();
            });
        tray.ContextMenuStrip.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        tray.ContextMenuStrip.Items.Add("Fechar CEP Horas", null, async (_, _) => await RequestProtectedExit());
        tray.DoubleClick += (_, _) => OpenWindow(false);
        tray.BalloonTipClicked += (_, _) => OpenWindow(!testPopup && !updatePopup);
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
        if (inbox) inboxIntent = Guid.NewGuid().ToString("N");
        try
        {
            if (inbox && webViewLifecycle.Ready) SendInboxIntent();
            await Task.CompletedTask;
            RecordNativeEvent(inbox ? "opened-inbox" : "opened-window");
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            // Closing or reloading WebView2 while clicking a popup must not crash the host.
        }
    }

    internal void OpenFromExternalInstance() => OpenWindow(false);
    private void SendInboxIntent()
    {
        if (inboxIntent is not null && !closed && webViewLifecycle.Ready && Browser.CoreWebView2 is not null)
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "cep-inbox-open", token = inboxIntent }, Json));
    }

    private async Task ResumeDesktopSupervision()
    {
        try
        {
            var response = await ControlClient.Send(new ControlRequest("desktop-resume"));
            if (response.Code != "desktop_resumed") ShowProtectionWarning();
            else WindowsPolicyNotification.NotifyShell();
        }
        catch { ShowProtectionWarning(); }
    }

    private void ShowProtectionWarning()
    {
        if (closed || tray is null) return;
        Dispatcher.Invoke(() => tray.ShowBalloonTip(
            15_000,
            "CEP Horas â€” atenÃ§Ã£o da TI",
            "A proteÃ§Ã£o de energia do Windows nÃ£o pÃ´de ser reativada. Mantenha o CEP Horas aberto e solicite suporte Ã  TI.",
            System.Windows.Forms.ToolTipIcon.Warning));
    }

    private async Task RequestProtectedExit()
    {
        if (closingWithPassword || closed || installingUpdate || restartingInterface) return;
        if (!DesktopTestEnvironment.Enabled)
        {
            var dialog = new ClosePasswordDialog();
            if (IsVisible) dialog.Owner = this;
            if (dialog.ShowDialog() != true) return;
        }

        closingWithPassword = true;
        try
        {
            await using var powerLease = power is null ? null : await power.QuiesceAsync(lifetime.Token);
            if (managedInstallation)
            {
                var response = await ControlClient.Send(new ControlRequest("desktop-suspend"));
                if (response.Code != "desktop_suspended")
                    throw new InvalidOperationException("O serviÃ§o nÃ£o autorizou o fechamento.");
                WindowsPolicyNotification.NotifyShell();
            }
            exiting = true;
            Close();
        }
        catch
        {
            if (IsVisible)
                System.Windows.MessageBox.Show(this, "NÃ£o foi possÃ­vel autorizar o fechamento. Tente novamente ou solicite suporte Ã  TI.",
                    "CEP Horas", MessageBoxButton.OK, MessageBoxImage.Error);
            else
                System.Windows.MessageBox.Show("NÃ£o foi possÃ­vel autorizar o fechamento. Tente novamente ou solicite suporte Ã  TI.",
                    "CEP Horas", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally { closingWithPassword = false; }
    }

    private void ShowNotificationSummary(int count)
    {
        if (closed || tray is null) return;
        updatePopup = false;
        testPopup = false;
        tray?.ShowBalloonTip(10_000, "CEP Horas", $"VocÃª tem {count} nova(s) notificaÃ§Ã£o(Ãµes). Abra a central para conferir as mensagens e seus horÃ¡rios originais.", System.Windows.Forms.ToolTipIcon.Info);
        RecordNativeEvent("notification-summary-requested");
    }

    private void ShowTestNotification()
    {
        if (closed || tray is null) return;
        updatePopup = false;
        testPopup = true;
        tray.ShowBalloonTip(10_000, "CEP Horas Â· teste de notificaÃ§Ã£o",
            "Este Ã© um teste local do aviso do Windows. Nenhuma mensagem foi enviada a outras pessoas. Clique para abrir o CEP Horas.",
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
        if (managedInstallation)
        {
            await CheckMsiUpdates();
            return;
        }
        if (closed || checkingForUpdates || installingUpdate) return;
        checkingForUpdates = true;
        try
        {
            var installed = GetType().Assembly.GetName().Version ?? new Version(0, 0, 0, 0);
            var release = await updates.CheckAsync(installed, lifetime.Token);
            if (closed || installingUpdate || release is null || release.Version == dismissedUpdate) return;
            availableUpdate = release;
            UpdateMessage.Text = $"CEP Horas {release.Version} disponÃ­vel. VocÃª pode atualizar agora ou continuar trabalhando.";
            UpdateNowButton.IsEnabled = true;
            UpdateBanner.Visibility = Visibility.Visible;
        }
        catch (OperationCanceledException) when (closed) { }
        catch { /* A falta de conexÃ£o com o GitHub nÃ£o impede o uso do aplicativo. */ }
        finally { checkingForUpdates = false; }
    }

    private async void UpdateNow_Click(object sender, RoutedEventArgs e)
    {
        if (managedInstallation)
        {
            await StartMsiUpdate();
            return;
        }
        if (availableUpdate is null || installingUpdate) return;
        installingUpdate = true;
        UpdateNowButton.IsEnabled = false;
        UpdateLaterButton.IsEnabled = false;
        UpdateMessage.Text = "Baixando e verificando a atualizaÃ§Ã£oâ€¦";
        try
        {
            var package = await updates.DownloadAsync(availableUpdate,
                Path.Combine(AppContext.BaseDirectory, "AppxManifest.xml"), lifetime.Token);
            if (closed) return;
            Process.Start(new ProcessStartInfo(package) { UseShellExecute = true });
            UpdateMessage.Text = "O instalador do Windows foi aberto. Confirme a atualizaÃ§Ã£o e feche o CEP Horas se solicitado.";
        }
        catch (OperationCanceledException) when (closed) { }
        catch
        {
            UpdateMessage.Text = "NÃ£o foi possÃ­vel abrir a atualizaÃ§Ã£o. Tente novamente mais tarde.";
        }
        finally
        {
            installingUpdate = false;
            ResumeWebViewAfterMaintenance();
            if (!closed)
            {
                UpdateNowButton.IsEnabled = true;
                UpdateLaterButton.IsEnabled = true;
            }
        }
    }

    private void UpdateLater_Click(object sender, RoutedEventArgs e)
    {
        if (installingUpdate) return;
        dismissedUpdate = managedInstallation && Version.TryParse(availableMsiVersion, out var version)
            ? version : availableUpdate?.Version;
        UpdateBanner.Visibility = Visibility.Collapsed;
    }

}
