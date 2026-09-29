using System.IO;
using System.Diagnostics;

using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using System.Windows.Threading;

namespace CepHoras.Desktop;

public partial class MainWindow : Window
{
    private const string AppOrigin = "https://app.cephoras.local";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private ApiSession? session;

    private bool closed;
    private bool exiting;
    private System.Windows.Forms.NotifyIcon? tray;
    private readonly DispatcherTimer notificationTimer = new() { Interval = TimeSpan.FromSeconds(60) };
    private NotificationDelivery? notifications;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += Initialize;
        Closing += (_, args) => { if (!exiting && tray is not null) { args.Cancel = true; Hide(); } };
        Closed += (_, _) => { closed = true; notificationTimer.Stop(); tray?.Dispose(); Browser.Dispose(); session?.Dispose(); };
    }

    private async void Initialize(object sender, RoutedEventArgs e)
    {
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
            notifications = new NotificationDelivery(session);
            ConfigureTray();
            notificationTimer.Tick += async (_, _) => await notifications.Poll(ShowNotificationSummary);
            notificationTimer.Start();
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras", "WebView2"));
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
            await core.AddScriptToExecuteOnDocumentCreatedAsync("window.__CEP_DESKTOP__ = true;");
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
            };
            core.Navigate($"{AppOrigin}/index.html");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            StartupStatus.Text = "Instale o Microsoft Edge WebView2 Runtime e abra o CEP Horas novamente.";
        }
        catch
        {
            StartupStatus.Text = "Não foi possível iniciar o CEP Horas. Confira a instalação e a configuração da API.";
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
            if (root.GetProperty("type").GetString() != "cep-auth") return;
            id = root.GetProperty("id").GetString();
            if (!Guid.TryParse(id, out _)) return;
            var operation = root.GetProperty("operation").GetString();
            var payload = root.GetProperty("payload");
            var result = await session!.Execute(operation, payload);
            Reply(new { id, ok = true, result });
            if (operation is "login" or "restore" && notifications is not null)
                await notifications.Poll(ShowNotificationSummary);
        }
        catch (ApiFailure failure) { Reply(new { id, ok = false, error = new { status = failure.Status, code = failure.Code, correlationId = failure.CorrelationId } }); }
        catch { if (id is not null) Reply(new { id, ok = false, error = new { code = "desktop_request_failed" } }); }
    }

    private void ConfigureTray()
    {
        tray = new System.Windows.Forms.NotifyIcon
        {
            Text = "CEP Horas — notificações ativas",
            Icon = System.Drawing.SystemIcons.Information,
            Visible = true,
            ContextMenuStrip = new System.Windows.Forms.ContextMenuStrip()
        };
        tray.ContextMenuStrip.Items.Add("Abrir CEP Horas", null, (_, _) => OpenWindow(false));
        tray.ContextMenuStrip.Items.Add("Minhas notificações", null, (_, _) => OpenWindow(true));
        tray.ContextMenuStrip.Items.Add("Sair do aplicativo", null, (_, _) => { exiting = true; Close(); });
        tray.DoubleClick += (_, _) => OpenWindow(false);
        tray.BalloonTipClicked += (_, _) => OpenWindow(true);
#if !DEBUG
        // Per-user startup requires no administrator elevation. The package startup task
        // can replace this registration when a signed MSIX distribution is introduced.
        using var run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        var executable = Path.Combine(AppContext.BaseDirectory, "CepHoras.exe");
        if (File.Exists(executable)) run.SetValue("CepHoras", $"\"{executable}\"");
#endif
    }

    private async void OpenWindow(bool inbox)
    {
        Show();
        WindowState = WindowState.Normal;
        Activate();
        if (inbox && Browser.CoreWebView2 is not null && IsAppOrigin(Browser.Source?.ToString() ?? ""))
            await Browser.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('cep-open-notifications'));");
    }

    private void ShowNotificationSummary(int count)
    {
        tray?.ShowBalloonTip(10_000, "CEP Horas", $"Você tem {count} nova(s) notificação(ões). Abra a central para conferir as mensagens e seus horários originais.", System.Windows.Forms.ToolTipIcon.Info);
    }

    private void Reply(object message)
    {
        if (!closed && Browser.CoreWebView2 is not null && IsAppOrigin(Browser.Source?.ToString() ?? ""))
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
    }

}
