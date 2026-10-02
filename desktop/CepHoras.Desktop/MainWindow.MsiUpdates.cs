using System.Windows;
using System.Windows.Threading;
using CepHoras.Control.Protocol;

namespace CepHoras.Desktop;

public partial class MainWindow
{
    private readonly DispatcherTimer msiStatusTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private string? availableMsiVersion;
    private string? notifiedMsiVersion;
    private bool pollingMsiStatus;
    private bool closingForUpdate;
    private bool startingMsiUpdate;
    private bool unavailableUpdateReported;
    private readonly SemaphoreSlim msiRequestGate = new(1, 1);

    private void StartMsiUpdates()
    {
        // Check independently of authentication and WebView2 startup. Only the
        // installed service may discover, download and run corporate updates.
        msiStatusTimer.Tick += async (_, _) => await PollMsiUpdate();
        msiStatusTimer.Start();
        updateTimer.Start();
        _ = CheckMsiUpdates();
    }

    private async Task CheckMsiUpdates()
    {
        if (closed || checkingForUpdates || installingUpdate) return;
        checkingForUpdates = true;
        var acquired = false;
        try
        {
            await msiRequestGate.WaitAsync(lifetime.Token);
            acquired = true;
            if (!closed) ShowMsiUpdate(await ControlClient.Send(new ControlRequest("update-check")));
        }
        catch { /* Network/service outages must not prevent normal work. */ }
        finally
        {
            if (acquired) msiRequestGate.Release();
            checkingForUpdates = false;
        }
    }

    private async Task PollMsiUpdate()
    {
        if (closed || pollingMsiStatus || closingForUpdate) return;
        pollingMsiStatus = true;
        var acquired = false;
        try
        {
            await msiRequestGate.WaitAsync(lifetime.Token);
            acquired = true;
            if (closed) return;
            var response = await ControlClient.Send(new ControlRequest("update-status"));
            if (closed) return;
            ShowMsiUpdate(response);
            if (response.UpdatePhase == "ready" && installingUpdate &&
                response.UpdateVersion == availableMsiVersion)
                await CloseForMsiUpdate();
        }
        catch { /* A service restart during installation is expected. */ }
        finally
        {
            if (acquired) msiRequestGate.Release();
            pollingMsiStatus = false;
        }
    }

    private void ShowMsiUpdate(ControlResponse response)
    {
        if (!closed && response.Code == "update_unavailable" && !unavailableUpdateReported)
        {
            unavailableUpdateReported = true;
            UpdateMessage.Text = "O atualizador precisa de revisão da TI. Você pode continuar usando o CEP Horas.";
            UpdateNowButton.IsEnabled = false;
            UpdateLaterButton.IsEnabled = true;
            UpdateBanner.Visibility = Visibility.Visible;
            return;
        }
        if (closed || response.Code is not ("update_status" or "update_started" or "update_busy" or "update_installing" or "update_restart_required")) return;
        if (response.Code == "update_restart_required")
        {
            installingUpdate = false;
            UpdateMessage.Text = "A atualização precisa de um reinício do Windows para terminar. Salve seu trabalho e reinicie quando puder.";
            UpdateNowButton.IsEnabled = false;
            UpdateLaterButton.IsEnabled = true;
            UpdateBanner.Visibility = Visibility.Visible;
            return;
        }
        switch (response.UpdatePhase)
        {
            case "available":
                // An older status read can finish after the user approved an update.
                // Never let availability erase that approval while downloading.
                if (installingUpdate) return;
                if (!Version.TryParse(response.UpdateVersion, out var version) || version == dismissedUpdate) return;
                availableMsiVersion = response.UpdateVersion;
                installingUpdate = false;
                UpdateMessage.Text = $"CEP Horas {response.UpdateVersion} disponível. Ao atualizar, o aplicativo será fechado e reaberto automaticamente.";
                UpdateNowButton.IsEnabled = true;
                UpdateLaterButton.IsEnabled = true;
                UpdateBanner.Visibility = Visibility.Visible;
                if (!IsVisible && notifiedMsiVersion != response.UpdateVersion && tray is not null)
                {
                    notifiedMsiVersion = response.UpdateVersion;
                    updatePopup = true;
                    tray.ShowBalloonTip(15_000, "CEP Horas — atualização disponível",
                        "Abra o CEP Horas e clique em Atualizar agora quando puder interromper o aplicativo por alguns instantes.",
                        System.Windows.Forms.ToolTipIcon.Info);
                }
                break;
            case "downloading":
            case "ready":
            case "installing":
                UpdateMessage.Text = response.UpdatePhase == "downloading"
                    ? "Baixando e verificando a atualização. Você pode continuar trabalhando…"
                    : "Aplicando a atualização. O CEP Horas será reaberto automaticamente…";
                UpdateBanner.Visibility = Visibility.Visible;
                UpdateNowButton.IsEnabled = false;
                UpdateLaterButton.IsEnabled = false;
                break;
            case "failed":
                installingUpdate = false;
                UpdateMessage.Text = "A atualização não foi concluída. Você pode continuar trabalhando e tentar novamente mais tarde.";
                UpdateBanner.Visibility = Visibility.Visible;
                UpdateNowButton.IsEnabled = availableMsiVersion is not null;
                UpdateLaterButton.IsEnabled = true;
                break;
            case "success":
                installingUpdate = false;
                UpdateBanner.Visibility = Visibility.Collapsed;
                break;
        }
    }

    private async Task StartMsiUpdate()
    {
        if (closed || availableMsiVersion is null || installingUpdate || startingMsiUpdate) return;
        var approvedVersion = availableMsiVersion;
        startingMsiUpdate = true;
        var acquired = false;
        try
        {
            // Serialize both response handling and commands. A status read started
            // before the click cannot erase the user's newer approval afterward.
            await msiRequestGate.WaitAsync(lifetime.Token);
            acquired = true;
            if (closed || installingUpdate) return;
            availableMsiVersion = approvedVersion;
            installingUpdate = true;
            UpdateNowButton.IsEnabled = false;
            UpdateLaterButton.IsEnabled = false;
            UpdateMessage.Text = "Preparando a atualização…";
            var response = await ControlClient.Send(new ControlRequest("update-start", ApprovedVersion: approvedVersion));
            if (response.Code != "update_started")
                throw new InvalidOperationException("A versão aprovada não está disponível.");
            ShowMsiUpdate(response);
        }
        catch
        {
            installingUpdate = false;
            if (closed) return;
            UpdateMessage.Text = "Não foi possível iniciar a atualização. Tente novamente mais tarde.";
            UpdateNowButton.IsEnabled = true;
            UpdateLaterButton.IsEnabled = true;
        }
        finally
        {
            if (acquired) msiRequestGate.Release();
            startingMsiUpdate = false;
        }
    }

    private async Task CloseForMsiUpdate()
    {
        if (closingForUpdate || closed) return;
        closingForUpdate = true;
        try
        {
            if (power is not null) await power.CancelCurrent();
            var response = await ControlClient.Send(new ControlRequest("update-ready", ApprovedVersion: availableMsiVersion));
            if (response.Code != "update_installing" || response.UpdatePhase != "installing")
                throw new InvalidOperationException("O serviço não autorizou a manutenção.");
            // Do not call desktop-suspend: maintenance preserves energy policy.
            notificationTimer.Stop();
            TerminateOwnedWebViewProcesses();
            exiting = true;
            System.Windows.Application.Current.Shutdown();
        }
        catch
        {
            closingForUpdate = false;
            installingUpdate = false;
            UpdateMessage.Text = "Não foi possível aplicar a atualização. Tente novamente mais tarde.";
            UpdateNowButton.IsEnabled = true;
            UpdateLaterButton.IsEnabled = true;
        }
    }
}
