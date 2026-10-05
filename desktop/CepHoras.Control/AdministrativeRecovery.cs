using System.IO;
using System.ServiceProcess;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class AdministrativeRecovery(
    Func<bool> inMaintenance, Action stopService, Action restorePolicy)
{
    internal void Restore()
    {
        if (inMaintenance()) throw new InvalidOperationException("A atualização está em andamento. Preserve o serviço e aguarde a TI.");
        stopService();
        // The runner may have handed off maintenance just before the service stop.
        if (inMaintenance()) throw new InvalidOperationException("A atualização começou. Preserve o snapshot e solicite suporte à TI.");
        restorePolicy();
    }

    internal static AdministrativeRecovery Installed() => new(
        () => Directory.Exists(UpdateStore.Root) && new UpdateStore().Read()?.InMaintenance == true,
        StopInstalledService,
        () => PolicyStore.Restore());

    internal static string Status()
    {
        PolicyStore.RequireAdmin();
        using var service = new ServiceController(ControlWire.ServiceName);
        service.Refresh();
        var configuration = PolicyStore.Read();
        var policy = configuration?.Active == true && PolicyStore.MatchesExpected();
        return $"Serviço: {service.Status}. Política: {(policy ? "ativa e verificada" : "inativa ou requer revisão")}.";
    }

    private static void StopInstalledService()
    {
        PolicyStore.RequireAdmin();
        using var service = new ServiceController(ControlWire.ServiceName);
        service.Refresh();
        if (service.Status == ServiceControllerStatus.Stopped) return;
        if (service.Status != ServiceControllerStatus.StopPending) service.Stop();
        service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
        service.Refresh();
        if (service.Status != ServiceControllerStatus.Stopped)
            throw new IOException("O serviço não confirmou encerramento; nenhuma política foi restaurada.");
    }
}
