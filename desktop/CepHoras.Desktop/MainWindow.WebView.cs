using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace CepHoras.Desktop;

public partial class MainWindow
{
    private readonly DispatcherTimer webViewHealthTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly WebViewLifecycle webViewLifecycle = new();
    private readonly WebViewRecoveryPlan webViewRecovery = new();
    private CancellationTokenSource? recoveryDelay;
    private bool browserNeedsRecreation, restartingInterface, webViewFailed, creatingWebView;
    private bool browserCreationUnconfirmed;
    private bool recoveryDeferredForUpdate;
    private long browserGeneration;
    private string? renderedDocumentId;
    private readonly string webViewDataFolder = WebViewProfileRecovery.GetProfilePath();
    private FileStream? profileLease;
    private OwnedWebViewProcess[] pendingProcessCleanup = [];
    private int pendingBrowserId;
    private OwnedWebViewProcess? pendingBrowserObservation;

    private void BeginWebViewLoading(ulong navigationId = 0)
    {
        renderedDocumentId = null;
        if (closed || exiting) return;
        webViewLifecycle.Begin(navigationId, Environment.TickCount64);
        webViewFailed = false;
        Browser.Visibility = Visibility.Hidden;
        StartupPanel.Visibility = Visibility.Visible;
        WebViewLoadingIndicator.Visibility = Visibility.Visible;
        StartupStatus.Text = "Carregando a interface do CEP Horas…";
        SetRecoveryButtons(!installingUpdate && !restartingInterface);
        webViewHealthTimer.Start();
        WriteWebViewDiagnostic("loading");
    }

    private void SetRecoveryButtons(bool enabled)
    {
        enabled &= hostSetupReady && !browserCreationUnconfirmed;
        ForceRestartButton.IsEnabled = enabled;
        ReloadInterfaceButton.IsEnabled = enabled;
        RepairProfileButton.IsEnabled = enabled;
    }

    private async Task CreateWebView()
    {
        creatingWebView = true;
        SetRecoveryButtons(false);
        try { await CreateWebViewCore(); }
        catch (OperationCanceledException) when (!lifetime.IsCancellationRequested)
        {
            // WaitAsync bounds the UI wait, not the native initialization itself.
            // No new browser/profile action may race an unconfirmed late creation.
            browserCreationUnconfirmed = true;
            throw;
        }
        finally { creatingWebView = false; if (!closed && !exiting) SetRecoveryButtons(!installingUpdate && !restartingInterface); }
    }

    private async Task CreateWebViewCore()
    {
        BeginWebViewLoading();
        SetRecoveryButtons(false);
        var instance = ++browserGeneration;
        var browserControl = Browser;
        using var startupDeadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        startupDeadline.CancelAfter(TimeSpan.FromSeconds(20));
        profileLease ??= WebViewProfileRecovery.AcquireProfile(webViewDataFolder);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: webViewDataFolder)
            .WaitAsync(startupDeadline.Token);
        await browserControl.EnsureCoreWebView2Async(environment).WaitAsync(startupDeadline.Token);
        if (closed || exiting || instance != browserGeneration) return;
        var core = Browser.CoreWebView2;
        if (!WebViewProfileRecovery.SamePath(core.Environment.UserDataFolder, webViewDataFolder))
            throw new InvalidOperationException("The WebView2 profile override conflicts with the owned profile.");
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
#endif
        core.SetVirtualHostNameToFolderMapping("app.cephoras.local", Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.DenyCors);
        await core.AddScriptToExecuteOnDocumentCreatedAsync((power is not null
            ? "window.__CEP_DESKTOP__=true;window.__CEP_POWER_VERSION__=1;"
            : "window.__CEP_DESKTOP__=true;") + """
            window.__CEP_DOCUMENT_ID__=crypto.randomUUID();
            window.__CEP_BOOT_FAULT__=false;
            addEventListener('error', e => {
              if (e.target instanceof HTMLScriptElement || e.target instanceof HTMLLinkElement)
                window.__CEP_BOOT_FAULT__=true;
            }, true);
            """).WaitAsync(startupDeadline.Token);
        core.NavigationStarting += (_, args) =>
        {
            if (instance != browserGeneration || closed || exiting) return;
            if (!IsAppOrigin(args.Uri)) args.Cancel = true;
            else BeginWebViewLoading(args.NavigationId);
        };
        core.NavigationCompleted += (_, args) =>
        {
            if (instance != browserGeneration || closed || exiting ||
                !webViewLifecycle.Complete(args.NavigationId, args.IsSuccess)) return;
            WriteWebViewDiagnostic("navigation-completed", args.IsSuccess ? "success" : args.WebErrorStatus.ToString());
            if (!args.IsSuccess) FailWebView("Não foi possível carregar a página.", "navigation-failed");
            else _ = CheckWebViewContent();
        };
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (instance != browserGeneration) return;
            if (args.IsUserInitiated && Uri.TryCreate(args.Uri, UriKind.Absolute, out var link) && link.Scheme == "https")
                try { Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true }); } catch { }
        };
        core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        core.WebMessageReceived += (sender, args) =>
        {
            if (instance == browserGeneration && ReferenceEquals(core, Browser.CoreWebView2)) HandleMessage(sender, args);
        };
        core.ProcessFailed += (_, args) =>
        {
            if (instance != browserGeneration || closed || exiting || installingUpdate) return;
            WriteWebViewDiagnostic("process-failed", args.ProcessFailedKind.ToString());
            if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) browserNeedsRecreation = true;
            if (args.ProcessFailedKind is CoreWebView2ProcessFailedKind.BrowserProcessExited or
                CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                FailWebView("O navegador da interface parou de responder.", "process-failed");
        };
        core.Navigate($"{AppOrigin}/index.html?boot={Guid.NewGuid():N}");
    }

    private Task CheckWebViewContent()
    {
        if (!hostSetupReady || browserCreationUnconfirmed || closed || exiting || restartingInterface || closingForUpdate || webViewFailed) return Task.CompletedTask;
        var failure = webViewLifecycle.Check(Environment.TickCount64);
        if (failure is not null) FailWebView("A interface não respondeu à verificação de carregamento.", failure);
        else if (webViewLifecycle.NavigationCompleted && Browser.CoreWebView2 is not null)
        {
            try { Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {
                type = "cep-lifecycle-probe", version = 1, token = webViewLifecycle.Token
            }, Json)); if (webViewLifecycle.Ready) SendInboxIntent(); }
            catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException)
            {
                browserNeedsRecreation = true;
                FailWebView("O navegador da interface não respondeu.", "bridge-failed");
            }
        }
        if (webViewLifecycle.Stable(Environment.TickCount64)) webViewRecovery.Reset();
        return Task.CompletedTask;
    }

    private void HandleLifecycle(JsonElement root)
    {
        if (!hostSetupReady || browserCreationUnconfirmed) return;
        if (!root.TryGetProperty("version", out var version) || !version.TryGetInt32(out var value) || value != 1 ||
            !root.TryGetProperty("documentId", out var document) || document.ValueKind != JsonValueKind.String || !Guid.TryParse(document.GetString(), out _) ||
            !root.TryGetProperty("token", out var token) || token.ValueKind != JsonValueKind.String ||
            !root.TryGetProperty("mounted", out var mounted) || mounted.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
            !root.TryGetProperty("visible", out var visible) || visible.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return;
        var ready = webViewLifecycle.Ready;
        if (!webViewLifecycle.Respond(token.GetString(), mounted.GetBoolean(), visible.GetBoolean(),
            root.TryGetProperty("assetFault", out var fault) && fault.ValueKind == JsonValueKind.True, Environment.TickCount64)) return;
        renderedDocumentId = document.GetString();
        if (webViewLifecycle.Failure is string failure) FailWebView("Não foi possível manter a interface carregada.", failure);
        else if (!ready && webViewLifecycle.Ready)
        {
            StartupPanel.Visibility = Visibility.Collapsed;
            WebViewLoadingIndicator.Visibility = Visibility.Collapsed;
            Browser.Visibility = Visibility.Visible;
            WriteWebViewDiagnostic("ready");
        }
    }

    private void FailWebView(string message, string code, bool recover = true)
    {
        if (closed || exiting || webViewFailed) return;
        webViewFailed = true;
        webViewLifecycle.Fail(code);
        Browser.Visibility = Visibility.Hidden;
        StartupPanel.Visibility = Visibility.Visible;
        WebViewLoadingIndicator.Visibility = Visibility.Collapsed;
        SetRecoveryButtons(!installingUpdate && !restartingInterface);
        WriteWebViewDiagnostic(code);
        if (recover && installingUpdate) recoveryDeferredForUpdate = true;
        var step = recover && !installingUpdate ? webViewRecovery.Next() : null;
        StartupStatus.Text = !hostSetupReady || browserCreationUnconfirmed ? message : step is null ? message + " Use Recarregar interface ou solicite suporte à TI."
            : message + " Tentando recuperar automaticamente…";
        if (recoveryDeferredForUpdate) StartupStatus.Text = message + " A recuperação aguarda o término da atualização.";
        if (step is not null) _ = RecoverAfterDelay(step.Value);
    }

    private void ResumeWebViewAfterMaintenance()
    {
        if (closed || exiting || installingUpdate) return;
        SetRecoveryButtons(!restartingInterface && !creatingWebView);
        if (!recoveryDeferredForUpdate) return;
        recoveryDeferredForUpdate = false;
        webViewFailed = false;
        FailWebView("A interface precisa ser recuperada.", "update-recovery-resumed");
    }

    private async Task RecoverAfterDelay((WebViewRecoveryStage Stage, TimeSpan Delay) step)
    {
        recoveryDelay?.Cancel();
        recoveryDelay?.Dispose();
        recoveryDelay = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        try
        {
            await Task.Delay(step.Delay, recoveryDelay.Token);
            if (!closed && !exiting && webViewFailed) await RecoverWebView(step.Stage, false);
        }
        catch (OperationCanceledException) { }
    }

    private async void ReloadWebView_Click(object sender, RoutedEventArgs e) => await ReloadWebView();
    private Task ReloadWebView() => RecoverWebView(browserNeedsRecreation || Browser.CoreWebView2 is null
        ? WebViewRecoveryStage.Recreate : WebViewRecoveryStage.Reload, false);
    private async void RepairProfile_Click(object sender, RoutedEventArgs e) => await RecoverWebView(WebViewRecoveryStage.Restart, true);

    private async Task RecoverWebView(WebViewRecoveryStage stage, bool resetProfile)
    {
        if (installingUpdate) { if (webViewFailed) recoveryDeferredForUpdate = true; return; }
        if (!hostSetupReady || browserCreationUnconfirmed || closed || exiting || restartingInterface || creatingWebView || closingWithPassword) return;
        restartingInterface = true;
        recoveryDelay?.Cancel();
        SetRecoveryButtons(false);
        try
        {
            await using var powerLease = power is null ? null : await power.QuiesceAsync(lifetime.Token);
            if (closed || exiting || installingUpdate) return;
            WriteWebViewDiagnostic("recovery-" + stage.ToString().ToLowerInvariant());
            if (stage == WebViewRecoveryStage.Reload && Browser.CoreWebView2 is not null && !browserNeedsRecreation)
            {
                Browser.CoreWebView2.Stop();
                Browser.CoreWebView2.Navigate($"{AppOrigin}/index.html?reload={Guid.NewGuid():N}");
            }
            else
            {
                if (stage == WebViewRecoveryStage.Restart && !resetProfile &&
                    !WebViewProfileRecovery.TryReserveAutomaticRestart(webViewDataFolder))
                    throw new InvalidOperationException("The automatic restart budget is exhausted.");
                await DisposeWebView();
                if (stage == WebViewRecoveryStage.Restart)
                {
                    if (resetProfile) WebViewProfileRecovery.Request(webViewDataFolder);
                    Process.Start(WebViewProfileRecovery.CreateRestartInfo());
                    exiting = true;
                    Close();
                }
                else
                {
                    ReplaceBrowser();
                    browserNeedsRecreation = false;
                    await CreateWebView();
                }
            }
        }
        catch (Exception error)
        {
            WriteWebViewDiagnostic("recovery-failed", error.GetType().Name);
            webViewFailed = false;
            FailWebView(error is PowerBridgeFailure
                ? "Não foi possível confirmar o cancelamento da ação de energia. A interface foi preservada."
                : browserCreationUnconfirmed ? "O navegador não confirmou a inicialização. Abra o aplicativo novamente ou solicite suporte à TI."
                : "Não foi possível recuperar automaticamente a interface.", "recovery-failed", !browserCreationUnconfirmed && error is not PowerBridgeFailure && stage != WebViewRecoveryStage.Restart);
        }
        finally
        {
            restartingInterface = false;
            if (!closed && !exiting) SetRecoveryButtons(!installingUpdate);
        }
    }

    private void ReplaceBrowser()
    {
        BrowserContainer.Children.Remove(Browser);
        Browser = new Microsoft.Web.WebView2.Wpf.WebView2 { Visibility = Visibility.Hidden };
        BrowserContainer.Children.Add(Browser);
    }

    private async Task DisposeWebView()
    {
        var core = Browser.CoreWebView2;
        var ids = Array.Empty<int>();
        var browserId = 0;
        if (core is not null)
            try { ids = core.Environment.GetProcessInfos().Select(info => info.ProcessId).ToArray(); browserId = (int)core.BrowserProcessId; }
            catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException) { }
        var captured = await Task.Run(() => WebViewProcessOwnership.Capture(ids, browserId), lifetime.Token);
        if (browserId != 0)
        {
            pendingBrowserId = browserId;
            pendingBrowserObservation = await Task.Run(() => WebViewProcessOwnership.Observe(browserId), lifetime.Token);
        }
        pendingProcessCleanup = pendingProcessCleanup.Concat(captured).DistinctBy(item => (item.Id, item.Started)).ToArray();
        browserGeneration++;
        Browser.Dispose();
        if (!await WebViewProcessOwnership.StopAsync(pendingProcessCleanup, TimeSpan.FromSeconds(4), lifetime.Token))
            throw new IOException("Owned browser processes did not confirm shutdown; the profile is preserved.");
        if (!await WebViewProcessOwnership.ConfirmExitAsync(pendingBrowserId, pendingBrowserObservation, TimeSpan.FromSeconds(2), lifetime.Token))
            throw new IOException("Browser shutdown is unconfirmed; an unowned/shared process will not be terminated.");
        pendingProcessCleanup = [];
        pendingBrowserId = 0;
        pendingBrowserObservation = null;
    }

    private static void WriteWebViewDiagnostic(string code, string? detail = null)
    {
        RecordNativeEvent("webview-" + code);
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras", "Diagnostics");
#if DEBUG
            if (Environment.GetEnvironmentVariable("CEP_DESKTOP_TESTING") == "1")
            {
                var isolated = Environment.GetEnvironmentVariable("CEP_SESSION_DIR");
                if (string.IsNullOrWhiteSpace(isolated)) return;
                directory = Path.Combine(isolated, "Diagnostics");
            }
#endif
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "webview.jsonl");
            if (File.Exists(path) && new FileInfo(path).Length > 262_144) File.Move(path, path + ".previous", true);
            File.AppendAllText(path, JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, code, detail }) + Environment.NewLine);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException) { }
    }
}
