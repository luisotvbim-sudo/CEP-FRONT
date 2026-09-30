using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class ControlService : ServiceBase
{
    private readonly CancellationTokenSource stop = new();
    private Task? worker;
    internal ControlService() { ServiceName = ControlWire.ServiceName; CanStop = true; AutoLog = true; }
    protected override void OnStart(string[] args) => worker = Task.Run(Run);
    protected override void OnStop() { stop.Cancel(); worker?.Wait(TimeSpan.FromSeconds(10)); }
    internal static PipeSecurity CreateSecurity()
    {
        var security = new PipeSecurity(); security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.InteractiveSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        return security;
    }
    internal static string? CallerSid(NamedPipeServerStream pipe)
    {
        string? sid = null;
        try { pipe.RunAsClient(() =>
        {
            using var identity = WindowsIdentity.GetCurrent(true);
            if (identity?.Groups?.Any(x => x.Value == "S-1-5-4") == true) sid = identity.User?.Value;
        }); }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException or System.ComponentModel.Win32Exception)
        { return null; }
        return sid;
    }
    private async Task Run()
    {
        try
        {
            PolicyStore.SecureDirectory();
            var authority = new ShutdownAuthority(PolicyStore.Read, PolicyStore.MatchesExpected, WindowsShutdown.Schedule, WindowsShutdown.Cancel, PolicyStore.Audit);
            using var pipe = NamedPipeServerStreamAcl.Create(ControlWire.PipeName, PipeDirection.InOut, 1,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 4096, 4096, CreateSecurity());
            while (!stop.IsCancellationRequested)
            {
                try
                {
                    await pipe.WaitForConnectionAsync(stop.Token);
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token); deadline.CancelAfter(TimeSpan.FromSeconds(5));
                    var request = await ControlWire.Read<ControlRequest>(pipe, deadline.Token);
                    var sid = CallerSid(pipe);
                    ControlResponse response;
                    try { response = sid is null ? new("access_denied", "É necessária uma sessão interativa local.") : authority.Handle(request, sid); }
                    catch { response = new("service_error", "A operação não pôde ser concluída. Solicite suporte à TI."); PolicyStore.Audit("service-request-failed", sid ?? "unknown"); }
                    await ControlWire.Write(pipe, response, deadline.Token);
                }
                catch (OperationCanceledException) { }
                catch (IOException) { }
                catch (System.Text.Json.JsonException) { }
                finally { if (pipe.IsConnected) pipe.Disconnect(); }
            }
        }
        catch (Exception)
        {
            // Let SCM recovery restart a crashed listener; never run with an unauthenticated fallback.
            ExitCode = 1;
            Environment.Exit(1);
        }
    }
}
