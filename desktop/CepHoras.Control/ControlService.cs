using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class ControlService : ServiceBase
{
    private readonly CancellationTokenSource stop = new();
    private readonly WindowsPower system = new();
    private readonly DesktopSupervisor desktopSupervisor;
    private readonly DesktopLifecycleController desktopLifecycle;
    private readonly MsiUpdateCoordinator updates;
    private readonly PowerAuthority authority;
    private Task? listener;
    private Task? supervisor;
    private int stopping;
    private bool InMaintenance => Volatile.Read(ref stopping) != 0 || updates.InMaintenance;

    internal ControlService()
    {
        var desktopState = new DesktopSupervisionState();
        updates = new MsiUpdateCoordinator(stop.Token);
        authority = new PowerAuthority(PolicyStore.Read, PolicyStore.MatchesExpected, system, PolicyStore.Audit,
            maintenance: () => InMaintenance);
        desktopSupervisor = new DesktopSupervisor(desktopState, () => InMaintenance);
        desktopLifecycle = new DesktopLifecycleController(
            desktopState,
            () => PolicyStore.Restore(),
            PolicyStore.Apply,
            PolicyStore.Audit,
            () => InMaintenance,
            () => new WindowsDesktopSessions().ActiveSessions());
        ServiceName = ControlWire.ServiceName;
        CanStop = true;
        CanHandleSessionChangeEvent = true;
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        try { updates.Initialize(authority.CancelForMaintenance); }
        catch (Exception error) { PolicyStore.Audit("update-initialization-failed:" + error.GetType().Name, "SYSTEM"); }
        try { desktopLifecycle.ProtectAtServiceStart(); }
        catch (Exception error)
        {
            PolicyStore.Audit("desktop-policy-service-start-failed:" + error.GetType().Name, "SYSTEM");
        }
        listener = Task.Run(Listen);
        supervisor = Task.Run(() => desktopSupervisor.Run(stop.Token));
    }

    protected override void OnSessionChange(SessionChangeDescription changeDescription)
    {
        base.OnSessionChange(changeDescription);
        var arrival = changeDescription.Reason is
            SessionChangeReason.SessionLogon or SessionChangeReason.SessionUnlock or
            SessionChangeReason.ConsoleConnect or SessionChangeReason.RemoteConnect;
        if (!arrival && changeDescription.Reason is not (
                SessionChangeReason.SessionLogoff or
                SessionChangeReason.SessionLock or
                SessionChangeReason.ConsoleDisconnect or
                SessionChangeReason.RemoteDisconnect)) return;
        try
        {
            if (arrival) desktopLifecycle.ProtectAfterSessionArrival(checked((uint)changeDescription.SessionId));
            else desktopLifecycle.ProtectAfterSessionEnd(checked((uint)changeDescription.SessionId));
        }
        catch (Exception error)
        {
            PolicyStore.Audit("desktop-policy-session-change-failed:" + error.GetType().Name, "session:" + changeDescription.SessionId);
        }
    }

    protected override void OnStop()
    {
        // StopServices must confirm cancellation before MSI can restore policy or
        // replace files. A failed cancellation leaves the action/state uncertain.
        Volatile.Write(ref stopping, 1);
        authority.CancelForMaintenance();
        stop.Cancel();
        Task.WaitAll([listener ?? Task.CompletedTask, supervisor ?? Task.CompletedTask], TimeSpan.FromSeconds(10));
        updates.Dispose();
        system.Dispose();
    }

    internal static PipeSecurity CreateSecurity()
    {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.InteractiveSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        return security;
    }

    internal static string? CallerSid(NamedPipeServerStream pipe)
    {
        string? sid = null;
        try
        {
            pipe.RunAsClient(() =>
            {
                using var identity = WindowsIdentity.GetCurrent(true);
                if (identity?.Groups?.Any(x => x.Value == "S-1-5-4") == true)
                    sid = identity.User?.Value;
            });
        }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException or System.ComponentModel.Win32Exception)
        { return null; }
        return sid;
    }

    private async Task Listen()
    {
        try
        {
            PolicyStore.SecureDirectory();
            while (!stop.IsCancellationRequested)
            {
                await using var pipe = NamedPipeServerStreamAcl.Create(
                    ControlWire.PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance,
                    4096,
                    4096,
                    CreateSecurity());
                try
                {
                    await pipe.WaitForConnectionAsync(stop.Token);
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
                    deadline.CancelAfter(TimeSpan.FromSeconds(5));
                    var request = await ControlWire.Read<ControlRequest>(pipe, deadline.Token);
                    var sid = CallerSid(pipe);
                    var client = sid is null ? null : TrustedClient(pipe, sid);
                    ControlResponse response;
                    if (sid is null || client is null)
                        response = new("access_denied", "Somente o CEP Horas instalado pode solicitar esta operação.");
                    else
                    {
                        try
                        {
                            response = request.Operation switch
                            {
                                "desktop-suspend" => desktopLifecycle.Suspend(client.SessionId, sid),
                                "desktop-resume" => desktopLifecycle.Resume(client.SessionId, sid),
                                "update-check" or "update-start" or "update-status" or "update-ready" => updates.Handle(request, client),
                                _ => authority.Handle(request, sid)
                            };
                        }
                        catch
                        {
                            response = new("service_error", "A operação não pôde ser concluída. Solicite suporte à TI.");
                            PolicyStore.Audit("service-request-failed", sid);
                        }
                    }
                    await ControlWire.Write(pipe, response, deadline.Token);
                }
                catch (OperationCanceledException) { }
                catch (IOException) { }
                catch (System.Text.Json.JsonException) { }
            }
        }
        catch
        {
            ExitCode = 1;
            Environment.Exit(1);
        }
    }

    private static UpdateClient? TrustedClient(NamedPipeServerStream pipe, string sid)
    {
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var id) || id == 0) return null;
        try
        {
            using var process = Process.GetProcessById(checked((int)id));
            var actual = Path.GetFullPath(process.MainModule?.FileName ?? "");
            var expected = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "CepHoras.exe"));
            if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase) ||
                (File.GetAttributes(expected) & FileAttributes.ReparsePoint) != 0)
                return null;
            return new(sid, checked((uint)process.SessionId), checked((int)id), process.StartTime.ToUniversalTime().Ticks);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or IOException)
        { return null; }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint processId);
}
