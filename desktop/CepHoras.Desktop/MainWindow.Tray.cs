using System.IO;
using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using CepHoras.Control.Protocol;
using Microsoft.Win32;

namespace CepHoras.Desktop;

public partial class MainWindow
{
    private bool reviewingNativePower;
    private void ConfigureTray()
    {
        trayIconStream = System.Windows.Application.GetResourceStream(
            new Uri("pack://application:,,,/Assets/Conceito.ico"))?.Stream
            ?? throw new InvalidOperationException("Ícone do CEP Horas ausente do aplicativo.");
        trayIcon = new System.Drawing.Icon(trayIconStream, 16, 16);
        tray = new System.Windows.Forms.NotifyIcon
        {
            Text = "CEP Horas",
            Icon = trayIcon,
            Visible = true,
            ContextMenuStrip = new System.Windows.Forms.ContextMenuStrip()
        };
        tray.ContextMenuStrip.Items.Add("Abrir CEP Horas", null, (_, _) => OpenWindow(false));
        tray.ContextMenuStrip.Items.Add("Recarregar interface", null, async (_, _) => { OpenWindow(false); await ReloadWebView(); });
        tray.ContextMenuStrip.Items.Add("Minhas notificações", null, (_, _) => OpenWindow(true));
        tray.ContextMenuStrip.Items.Add("Testar notificação", null, (_, _) => ShowTestNotification());
        if (managedInstallation)
        {
            tray.ContextMenuStrip.Items.Add("Verificar solicitação de energia", null, async (_, _) => await ReviewNativePowerRequest());
            tray.ContextMenuStrip.Items.Add("Verificar atualizações", null, async (_, _) =>
            {
                OpenWindow(false);
                await CheckMsiUpdates();
            });
        }
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

    private void OpenWindow(bool inbox)
    {
        if (closed) return;
        Show();
        WindowState = WindowState.Normal;
        Activate();
        if (inbox) inboxIntent = Guid.NewGuid().ToString("N");
        try
        {
            if (inbox && webViewLifecycle.Ready) SendInboxIntent();
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

    private async Task ReviewNativePowerRequest()
    {
        if (closed || power is null || reviewingNativePower || closingWithPassword || installingUpdate || startingMsiUpdate || restartingInterface) return;
        reviewingNativePower = true;
        try
        {
            var status = JsonSerializer.SerializeToElement(await power.Execute("status", JsonSerializer.SerializeToElement(new { })));
            if (status.GetProperty("state").GetString() == "recovery-required")
            {
                if (System.Windows.MessageBox.Show(
                    "Há uma solicitação de energia sua no serviço Windows. Deseja cancelar explicitamente essa solicitação?",
                    "CEP Horas — solicitação de energia", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
                await power.Execute("cancel", JsonSerializer.SerializeToElement(new { requestId = status.GetProperty("requestId").GetString() }));
                ShowExitFeedback("O serviço confirmou o cancelamento da sua solicitação de energia.");
            }
            else ShowExitFeedback(status.GetProperty("state").GetString() == "idle"
                ? "O serviço confirmou que não há solicitação de energia pendente."
                : "Há uma solicitação que exige revisão pelo titular ou pela TI.");
        }
        catch (Exception error) { ShowExitFeedback(ProtectedExitFeedback.Failure(error)); }
        finally { reviewingNativePower = false; }
    }

    private void ShowProtectionWarning()
    {
        if (closed || tray is null) return;
        Dispatcher.Invoke(() => tray.ShowBalloonTip(
            15_000,
            "CEP Horas — atenção da TI",
            "A proteção de energia do Windows não pôde ser reativada. Mantenha o CEP Horas aberto e solicite suporte à TI.",
            System.Windows.Forms.ToolTipIcon.Warning));
    }

    private async Task RequestProtectedExit()
    {
        if (closed) return;
        if (closingWithPassword || reviewingNativePower || installingUpdate || startingMsiUpdate || restartingInterface)
        {
            ShowExitFeedback("Há um fechamento, atualização ou reinício da interface em andamento. Aguarde a conclusão.");
            return;
        }
        closingWithPassword = true;
        var passwordAccepted = false;
        ClosePasswordDialog? progress = null;
        try
        {
            var dialog = new ClosePasswordDialog();
            if (IsVisible) dialog.Owner = this;
            if (dialog.ShowDialog() != true) return;
            passwordAccepted = true;
            progress = new ClosePasswordDialog();
            if (IsVisible) progress.Owner = this;
            progress.ShowPreparation();
            await using var powerLease = power is null ? null : await power.QuiesceAsync(lifetime.Token);
            if (managedInstallation)
            {
                var response = await ProtectedExitOperation.Run(ControlClient.Send, () =>
                {
                    WindowsPolicyNotification.NotifyShell();
                    if (WindowsShutdownAccess.HasShutdownPrivilege() == false)
                        System.Windows.MessageBox.Show(
                            "As configurações de energia foram restauradas. Esta sessão do Windows ainda usa as permissões da versão anterior. Salve seu trabalho e saia e entre no Windows uma vez para liberar os controles. O CEP Horas será fechado.",
                            "CEP Horas — atualizar sessão do Windows", MessageBoxButton.OK, MessageBoxImage.Information);
                    FinishProtectedExit(progress);
                    return Task.CompletedTask;
                }, ShowProtectionWarning);
                if (response.Code != "desktop_suspended")
                {
                    progress.CompletePreparation();
                    ShowExitFeedback("Senha aceita. " + ProtectedExitFeedback.Refusal(response.Code));
                    return;
                }
                return;
            }
            FinishProtectedExit(progress);
        }
        catch (Exception exception)
        {
            if (!closed) exiting = false;
            progress?.CompletePreparation();
            ShowExitFeedback((passwordAccepted ? "Senha aceita. " : "Não foi possível abrir a verificação da senha. ") +
                ProtectedExitFeedback.Failure(exception));
        }
        finally
        {
            progress?.CompletePreparation();
            closingWithPassword = false;
        }
    }

    private void FinishProtectedExit(ClosePasswordDialog progress)
    {
        progress.CompletePreparation();
        System.Windows.MessageBox.Show("Senha aceita e preparação concluída. O CEP Horas será fechado.",
            "CEP Horas — fechamento", MessageBoxButton.OK, MessageBoxImage.Information);
        exiting = true;
        Close();
        if (!closed) throw new InvalidOperationException("Fechamento não concluído.");
    }

    private void ShowExitFeedback(string message)
    {
        if (IsVisible)
            System.Windows.MessageBox.Show(this, message, "CEP Horas — fechamento", MessageBoxButton.OK, MessageBoxImage.Warning);
        else
            System.Windows.MessageBox.Show(message, "CEP Horas — fechamento", MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private void ShowNotificationSummary(int count)
    {
        if (closed || tray is null) return;
        updatePopup = false;
        testPopup = false;
        tray?.ShowBalloonTip(10_000, "CEP Horas", $"Você tem {count} nova(s) notificação(ões). Abra a central para conferir as mensagens e seus horários originais.", System.Windows.Forms.ToolTipIcon.Info);
        RecordNativeEvent("notification-summary-requested");
    }

    private void ShowTestNotification()
    {
        if (closed || tray is null) return;
        updatePopup = false;
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

}
