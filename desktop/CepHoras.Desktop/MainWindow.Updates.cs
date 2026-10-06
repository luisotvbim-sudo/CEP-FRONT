using System.IO;
using System.Diagnostics;
using System.Windows;

namespace CepHoras.Desktop;

public partial class MainWindow
{
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
        if (managedInstallation)
        {
            await StartMsiUpdate();
            return;
        }
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
