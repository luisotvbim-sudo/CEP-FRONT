using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;

namespace CepHoras.Desktop;

public partial class MainWindow
{
    private readonly DispatcherTimer webViewHealthTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private bool webViewNavigationCompleted;
    private bool webViewReady;
    private bool webViewFailed;
    private bool checkingWebView;
    private bool browserNeedsRecreation;
    private bool restartingInterface;
    private int emptyWebViewChecks;
    private long webViewNavigationGeneration;
    private long webViewLoadingStarted;

    // Checking the rendered root is separate from HTML navigation and API login.
    // The result contains no page text, account data, URLs or session values.
    private const string RenderedRootProbe = """
        (() => {
          const root = document.getElementById('root');
          if (!root) return false;
          return Array.from(root.children).some(node => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
        })()
        """;

    private void BeginWebViewLoading()
    {
        if (closed || exiting) return;
        webViewNavigationGeneration++;
        webViewNavigationCompleted = false;
        webViewReady = false;
        webViewFailed = false;
        emptyWebViewChecks = 0;
        webViewLoadingStarted = Environment.TickCount64;
        Browser.Visibility = Visibility.Hidden;
        StartupPanel.Visibility = Visibility.Visible;
        WebViewLoadingIndicator.Visibility = Visibility.Visible;
        StartupStatus.Text = "Carregando a interface do CEP Horas…";
        ForceRestartButton.IsEnabled = !installingUpdate;
        ReloadInterfaceButton.IsEnabled = !installingUpdate;
        webViewHealthTimer.Start();
        WriteWebViewDiagnostic("loading");
    }

    private void FailWebView(string message, string code)
    {
        if (closed || exiting || webViewFailed) return;
        webViewFailed = true;
        webViewReady = false;
        webViewHealthTimer.Stop();
        Browser.Visibility = Visibility.Hidden;
        StartupPanel.Visibility = Visibility.Visible;
        WebViewLoadingIndicator.Visibility = Visibility.Collapsed;
        StartupStatus.Text = message;
        ForceRestartButton.IsEnabled = !installingUpdate;
        WriteWebViewDiagnostic(code);
    }

    private async Task CheckWebViewContent()
    {
        if (closed || exiting || restartingInterface || installingUpdate || checkingWebView || webViewFailed) return;
        if (!webViewReady && Environment.TickCount64 - webViewLoadingStarted >= 30_000)
        {
            FailWebView("A interface está demorando para carregar. Clique em Recarregar interface para tentar novamente.", "loading-timeout");
            return;
        }
        if (!webViewNavigationCompleted || Browser.CoreWebView2 is null) return;
        checkingWebView = true;
        var generation = webViewNavigationGeneration;
        try
        {
            var result = await Browser.CoreWebView2.ExecuteScriptAsync(RenderedRootProbe)
                .WaitAsync(TimeSpan.FromSeconds(3), lifetime.Token);
            if (closed || exiting || webViewFailed || generation != webViewNavigationGeneration) return;
            if (result == "true")
            {
                emptyWebViewChecks = 0;
                if (!webViewReady)
                {
                    webViewReady = true;
                    StartupPanel.Visibility = Visibility.Collapsed;
                    WebViewLoadingIndicator.Visibility = Visibility.Collapsed;
                    Browser.Visibility = Visibility.Visible;
                    WriteWebViewDiagnostic("ready");
                }
            }
            else if (webViewReady && ++emptyWebViewChecks >= 3)
                FailWebView("A interface ficou vazia. Clique em Recarregar interface para tentar novamente.", "rendered-root-empty");
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception error)
        {
            if (closed || exiting || generation != webViewNavigationGeneration) return;
            WriteWebViewDiagnostic("probe-failed", error.GetType().Name);
            FailWebView("A interface parou de responder. Clique em Recarregar interface.", "renderer-unresponsive");
        }
        finally { checkingWebView = false; }
    }

    private async void ReloadWebView_Click(object sender, RoutedEventArgs e) => await ReloadWebView();

    private Task ReloadWebView()
    {
        if (closed || exiting || restartingInterface || installingUpdate) return Task.CompletedTask;
        WriteWebViewDiagnostic("reload-requested");
        if (Browser.CoreWebView2 is null || browserNeedsRecreation)
        {
            ForceRestart_Click(this, new RoutedEventArgs());
            return Task.CompletedTask;
        }
        try
        {
            BeginWebViewLoading();
            Browser.CoreWebView2.Stop();
            // Always request the installed entry page afresh. This avoids reusing
            // cached HTML which can refer to bundle names from an earlier MSI.
            Browser.CoreWebView2.Navigate($"{AppOrigin}/index.html?reload={Guid.NewGuid():N}");
        }
        catch (Exception error)
        {
            WriteWebViewDiagnostic("reload-failed", error.GetType().Name);
            browserNeedsRecreation = true;
            FailWebView("Não foi possível recarregar. Clique novamente para recriar o navegador da interface.", "reload-failed");
        }
        return Task.CompletedTask;
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
