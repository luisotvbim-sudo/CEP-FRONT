using System.IO;
using CepHoras.Control.Protocol;

namespace CepHoras.Desktop;

internal static class DesktopTestEnvironment
{
    internal static bool Enabled
    {
        get
        {
#if DEBUG
            return Environment.GetEnvironmentVariable("CEP_DESKTOP_LOCAL_TEST") == "1";
#else
            return false;
#endif
        }
    }

    internal static void Validate()
    {
        if (!Enabled) return;
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras-Test");
        if (Environment.GetEnvironmentVariable("CEP_API_URL") != "http://127.0.0.1:8080" ||
            Environment.GetEnvironmentVariable("CEP_DESKTOP_TESTING") != "1" ||
            !WebViewProfileRecovery.SamePath(Environment.GetEnvironmentVariable("CEP_SESSION_DIR") ?? "", Path.Combine(root, "Sessions")) ||
            !WebViewProfileRecovery.SamePath(WebViewProfileRecovery.GetProfilePath(), Path.Combine(root, "WebView2")) ||
            File.Exists(Path.Combine(AppContext.BaseDirectory, "managed-install.marker")))
            throw new InvalidOperationException("O ambiente TESTE exige API e perfil isolados, sem instalação gerenciada.");
    }
}

// No IPC, Windows power calls, process execution or persistent privileged state.
internal sealed class SimulatedPowerBroker
{
    private readonly string identity = Guid.NewGuid().ToString();
    private ControlResponse? pending;
    internal Task<ControlResponse> Send(ControlRequest request)
    {
        lock (this)
        {
            ControlResponse response;
            switch (request.Operation)
            {
                case "status": response = new("ready", "TESTE: energia simulada", Active: true, BrokerInstanceId: identity); break;
                case "schedule" when request.Action is "shutdown" or "restart" or "hibernate" && request.DelaySeconds == 10:
                    response = pending = new("scheduled", "TESTE: nenhuma ação Windows será executada", RequestId: request.RequestId, Action: request.Action, ExecuteAt: DateTimeOffset.UtcNow.AddSeconds(10), BrokerInstanceId: identity); break;
                case "cancel":
                    pending = null;
                    response = new("cancelled", "TESTE: cancelado", RequestId: request.RequestId, Cancelled: true, BrokerInstanceId: identity); break;
                case "power-status":
                    response = pending is not null && pending.RequestId == request.RequestId && pending.ExecuteAt > DateTimeOffset.UtcNow
                        ? pending with { Code = "pending" }
                        : new("not_pending", "TESTE: simulação encerrada", RequestId: request.RequestId, BrokerInstanceId: identity); break;
                default: response = new("unsupported_operation", "Operação não permitida no TESTE", BrokerInstanceId: identity); break;
            }
            return Task.FromResult(response);
        }
    }
}
