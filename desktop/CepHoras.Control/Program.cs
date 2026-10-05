using System.Diagnostics;
using System.ServiceProcess;
using System.Windows;

namespace CepHoras.Control;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.SequenceEqual(["--run-update"]))
                return MsiUpdateRunner.RunAsync().GetAwaiter().GetResult();
            if (args.SequenceEqual(["--service"]))
            {
                ServiceBase.Run(new ControlService());
                return 0;
            }
            if (args.Length == 0 || args.SequenceEqual(["--configure"]))
            {
                if (!PolicyStore.IsAdministrator)
                {
                    Process.Start(new ProcessStartInfo(Environment.ProcessPath!)
                    {
                        UseShellExecute = true,
                        Verb = "runas",
                        Arguments = "--configure"
                    });
                    return 0;
                }
                return new Application().Run(new AdminWindow());
            }
            PolicyStore.RequireAdmin();
            switch (args.SingleOrDefault())
            {
                case "--apply-policy": PolicyStore.ApplyForInstallation(); break;
                case "--restore-policy": AdministrativeRecovery.Installed().Restore(); break;
                case "--uninstall-restore": PolicyStore.Restore(true); break;
                case "--rollback-restore": PolicyStore.RollbackRestore(); break;
                case "--finish-restore": PolicyStore.FinishRestore(); break;
                case "--rollback-apply": PolicyStore.Restore(); break;
                default: return 2;
            }
            return 0;
        }
        catch (Exception exception)
        {
            try { PolicyStore.Audit("admin-operation-failed:" + exception.GetType().Name, "TI"); } catch { }
            if (args.Length == 0 || args.Contains("--configure"))
                MessageBox.Show(exception.Message, "CEP Horas — configuração", MessageBoxButton.OK, MessageBoxImage.Error);
            return 1;
        }
    }
}
