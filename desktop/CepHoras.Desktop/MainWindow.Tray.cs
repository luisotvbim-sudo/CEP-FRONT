using System.IO;
using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using CepHoras.Control.Protocol;
using Microsoft.Win32;

namespace CepHoras.Desktop;

public partial class MainWindow
{
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
            tray.ContextMenuStrip.Items.Add("Verificar atualizações", null, async (_, _) =>
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
        if (closingWithPassword || closed || installingUpdate || restartingInterface) return;
        var dialog = new ClosePasswordDialog();
        if (IsVisible) dialog.Owner = this;
        if (dialog.ShowDialog() != true) return;

        closingWithPassword = true;
        try
        {
            await using var powerLease = power is null ? null : await power.QuiesceAsync(lifetime.Token);
            if (managedInstallation)
            {
                var response = await ControlClient.Send(new ControlRequest("desktop-suspend"));
                if (response.Code != "desktop_suspended")
                    throw new InvalidOperationException("O serviço não autorizou o fechamento.");
                WindowsPolicyNotification.NotifyShell();
                if (WindowsShutdownAccess.HasShutdownPrivilege() == false)
                    System.Windows.MessageBox.Show(
                        "As configurações de energia foram restauradas. Esta sessão do Windows ainda usa as permissões da versão anterior. Salve seu trabalho e saia e entre no Windows uma vez para liberar os controles. O CEP Horas será fechado.",
                        "CEP Horas — atualizar sessão do Windows", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            exiting = true;
            Close();
        }
        catch
        {
            if (IsVisible)
                System.Windows.MessageBox.Show(this, "Não foi possível autorizar o fechamento. Tente novamente ou solicite suporte à TI.",
                    "CEP Horas", MessageBoxButton.OK, MessageBoxImage.Error);
            else
                System.Windows.MessageBox.Show("Não foi possível autorizar o fechamento. Tente novamente ou solicite suporte à TI.",
                    "CEP Horas", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally { closingWithPassword = false; }
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
