using System.IO;
using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using CepHoras.Updates;
using Microsoft.Web.WebView2.Core;

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

    public MainWindow()
    {
        InitializeComponent();
        Loaded += Initialize;
        updateTimer.Tick += async (_, _) => await CheckForUpdates();
        Closed += (_, _) => { closed = true; lifetime.Cancel(); updateTimer.Stop(); Browser.Dispose(); session?.Dispose(); };
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
        }
        catch (ApiFailure failure) { Reply(new { id, ok = false, error = new { status = failure.Status, code = failure.Code, correlationId = failure.CorrelationId } }); }
        catch { if (id is not null) Reply(new { id, ok = false, error = new { code = "desktop_request_failed" } }); }
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
