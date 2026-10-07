using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace CepHoras.Desktop;

public partial class MainWindow
{
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
        var powerOperation = false;
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
                powerOperation = true;
                if (!managedInstallation || power is null) throw new PowerBridgeFailure("native_power_unavailable");
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
        catch (Exception failure) when (powerOperation)
        {
            Respond(new { id, ok = false, error = new { code = PowerBridgeFailure.ServiceCode(failure) } });
        }
        catch { if (id is not null) Respond(new { id, ok = false, error = new { code = "desktop_request_failed" } }); }
    }

    private void Reply(object message)
    {
        if (!closed && Browser.CoreWebView2 is not null && IsAppOrigin(Browser.Source?.ToString() ?? ""))
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
    }

}
