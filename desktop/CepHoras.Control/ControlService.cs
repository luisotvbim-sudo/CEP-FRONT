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
    private readonly DesktopSupervisor desktopSupervisor = new();
    private Task? listener;
    private Task? supervisor;

    internal ControlService()
    {
        ServiceName = ControlWire.ServiceName;
        CanStop = true;
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        listener = Task.Run(Listen);
        supervisor = Task.Run(() => desktopSupervisor.Run(stop.Token));
    }

    protected override void OnStop()
    {
        stop.Cancel();
        Task.WaitAll([listener ?? Task.CompletedTask, supervisor ?? Task.CompletedTask], TimeSpan.FromSeconds(10));
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
            var authority = new PowerAuthority(PolicyStore.Read, PolicyStore.MatchesExpected, system, PolicyStore.Audit);
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
                    var sessionId = TrustedClientSession(pipe);
                    ControlResponse response;
                    if (sid is null || sessionId is null)
                        response = new("access_denied", "Somente o CEP Horas instalado pode solicitar esta operação.");
                    else
                    {
                        try
                        {
                            response = request.Operation switch
                            {
                                "desktop-suspend" => SuspendDesktop(sessionId.Value, sid),
                                "desktop-resume" => ResumeDesktop(sessionId.Value, sid),
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

    private ControlResponse SuspendDesktop(uint sessionId, string sid)
    {
        desktopSupervisor.Suspend(sessionId, sid);
        PolicyStore.Audit("desktop-supervision-suspended", sid);
        return new("desktop_suspended", "O CEP Horas pode ser fechado nesta sessão.");
    }

    private ControlResponse ResumeDesktop(uint sessionId, string sid)
    {
        if (desktopSupervisor.Resume(sessionId, sid))
            PolicyStore.Audit("desktop-supervision-resumed", sid);
        return new("desktop_resumed", "A supervisão do CEP Horas está ativa.");
    }

    private static uint? TrustedClientSession(NamedPipeServerStream pipe)
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
            return checked((uint)process.SessionId);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or IOException)
        { return null; }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint processId);
}
