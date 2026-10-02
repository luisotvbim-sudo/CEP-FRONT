using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using CepHoras.Control.Protocol;
using CepHoras.Updates;

namespace CepHoras.Control;

internal static class MsiUpdateRunner
{
    internal static async Task<int> RunAsync()
    {
        UpdateStore.RequireSystem();
        var store = new UpdateStore();
        store.Initialize();
        UpdateState? state = null;
        FileStream? updateLock = null;
        try
        {
            // The service records our exact PID/start time before transferring the file lock.
            using var handoff = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            while (updateLock is null)
            {
                try { updateLock = store.AcquireLock(); }
                catch (IOException) { await Task.Delay(100, handoff.Token); }
            }
            state = store.Read() ?? throw new InvalidDataException("Atualização não autorizada.");
            using var self = Process.GetCurrentProcess();
            if (state.Phase != "installing" || state.RunnerPid != self.Id || state.RunnerStartedUtcTicks != self.StartTime.ToUniversalTime().Ticks ||
                !string.Equals(Path.GetFullPath(Environment.ProcessPath!), store.RunnerPath(state.AttemptId), StringComparison.OrdinalIgnoreCase) ||
                DateTimeOffset.UtcNow >= state.Deadline)
                throw new UnauthorizedAccessException("Executor não corresponde à tentativa autorizada.");
            UpdateStore.ValidatePrivate(new DirectoryInfo(store.RunnerDirectory(state.AttemptId)));
            UpdateStore.ValidatePrivate(new FileInfo(store.PackagePath(state.AttemptId)));

            // WPF acknowledges readiness and shuts down its own activity/WebView tree.
            // The helper does not accept a process name, path or kill command from IPC.
            var closeDeadline = DateTimeOffset.UtcNow.AddSeconds(45);
            while (AnyInstalledDesktopRunning())
            {
                if (DateTimeOffset.UtcNow >= closeDeadline) throw new IOException("Aplicativo não encerrou para atualizar.");
                await Task.Delay(250);
            }
            if (UpdateStore.InstalledVersion() != state.InstalledVersion)
                throw new InvalidDataException("A versão instalada mudou durante a preparação.");

            // Keep the verified package immutable throughout the MSI client operation.
            using var package = new FileStream(store.PackagePath(state.AttemptId), FileMode.Open, FileAccess.Read, FileShare.Read);
            new GitHubMsiUpdates().VerifyDownloadedPackage(store.PackagePath(state.AttemptId), state.Release);
            var installerPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "msiexec.exe");
            UpdateStore.RejectReparseAncestors(Path.GetDirectoryName(installerPath)!);
            if ((File.GetAttributes(installerPath) & FileAttributes.ReparsePoint) != 0) throw new IOException("Windows Installer inválido.");
            var info = new ProcessStartInfo(installerPath) { UseShellExecute = false, CreateNoWindow = true,
                WorkingDirectory = store.AttemptDirectory(state.AttemptId) };
            foreach (var argument in new[] { "/i", store.PackagePath(state.AttemptId), "/qn", "/norestart", "/l*v", store.LogPath(state.AttemptId) })
                info.ArgumentList.Add(argument);
            using var installer = Process.Start(info) ?? throw new IOException("Windows Installer não iniciou.");
            state = state with { InstallerPid = installer.Id, InstallerStartedUtcTicks = installer.StartTime.ToUniversalTime().Ticks };
            store.Save(state);
            PolicyStore.Audit("update-installer-started:" + state.TargetVersion, "SYSTEM");
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(30));
                await installer.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                // Killing the MSI client can leave the privileged Windows Installer
                // transaction alive. Keep maintenance/lock until it really returns.
                state = state with { Diagnostic = "installer_timeout" };
                store.Save(state);
                PolicyStore.Audit("update-installer-timeout:" + state.TargetVersion, "SYSTEM");
                await installer.WaitForExitAsync();
            }
            state = UpdateRecovery.Completed(state, installer.ExitCode, UpdateStore.InstalledVersion());
            store.Save(state);
            PolicyStore.Audit("update-installer-returned:" + installer.ExitCode + ":" + state.Phase, "SYSTEM");
            return state.Phase == "success" ? 0 : 1;
        }
        catch (Exception error)
        {
            // Preserve active maintenance when a Windows Installer process still exists.
            if (state is not null && !UpdateStore.ProcessMatches(state.InstallerPid, state.InstallerStartedUtcTicks,
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "msiexec.exe"), requireSystem: true))
                store.Save(state with { Phase = "failed", Diagnostic = "update_runner_failed" });
            PolicyStore.Audit("update-runner-failed:" + error.GetType().Name, "SYSTEM");
            return 1;
        }
        finally
        {
            updateLock?.Dispose();
            // StopServices/MajorUpgrade may leave either old or new service stopped.
            // Start only the fixed installed service, never an executable path in state.
            try
            {
                using var service = new ServiceController(ControlWire.ServiceName);
                service.Refresh();
                if (service.Status == ServiceControllerStatus.Stopped) service.Start();
            }
            catch (Exception error) { PolicyStore.Audit("update-service-restart-failed:" + error.GetType().Name, "SYSTEM"); }
        }
    }

    private static bool AnyInstalledDesktopRunning()
    {
        foreach (var process in Process.GetProcessesByName("CepHoras"))
        {
            using (process)
            {
                try
                {
                    if (!process.HasExited && string.Equals(Path.GetFullPath(process.MainModule?.FileName ?? ""),
                            UpdateStore.InstalledDesktop, StringComparison.OrdinalIgnoreCase)) return true;
                }
                catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or IOException)
                { if (!process.HasExited) return true; } // Unknown matching name: do not risk replacing open files.
            }
        }
        return false;
    }
}
