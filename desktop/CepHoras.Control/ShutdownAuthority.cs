using System.Security.Cryptography;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class ShutdownAuthority(Func<ControlConfiguration?> configuration, Func<bool> healthy,
    Action shutdown, Action cancel, Action<string, string> audit, Func<long>? clock = null)
{
    private readonly Func<long> now = clock ?? (() => Environment.TickCount64);
    private readonly Dictionary<string, (int Attempts, long Until)> failures = [];
    private string? pendingOwner;
    private long pendingUntil;
    internal ControlResponse Handle(ControlRequest request, string sid)
    {
        if (request.Action == "cancel")
        {
            if (pendingOwner != sid || now() >= pendingUntil) return new("not_pending", "Não há desligamento seu aguardando cancelamento.");
            cancel(); pendingOwner = null; audit("shutdown-canceled", sid);
            return new("canceled", "Desligamento cancelado.", true);
        }
        var config = configuration();
        if (config?.Active != true) return new("inactive", "Controle ainda não ativado pela TI.");
        if (!healthy()) return new("policy_changed", "A política local foi alterada. A TI precisa revisar a proteção deste computador.");
        if (request.Action == "status") return new("ready", "Controle local ativo. Regra piloto: senha definida pela TI; regra de horas ainda pendente.", true);
        if (request.Action != "shutdown" || !request.Confirmed) return new("invalid_request", "Solicitação inválida.", true);
        if (pendingOwner is not null && now() < pendingUntil) return new("pending", "Já existe uma solicitação de desligamento em andamento.", true);
        if (failures.TryGetValue(sid, out var failure) && failure.Until > now() && failure.Attempts >= 5)
            return new("rate_limited", "Muitas tentativas. Aguarde um minuto.", true);
        if (request.Password is null || request.Password.Length is < 8 or > 128) return Denied(sid);
        var candidate = Rfc2898DeriveBytes.Pbkdf2(request.Password, config.Salt, 600_000, HashAlgorithmName.SHA256, 32);
        bool valid;
        try { valid = CryptographicOperations.FixedTimeEquals(candidate, config.Hash); }
        finally { CryptographicOperations.ZeroMemory(candidate); }
        if (!valid) return Denied(sid);
        failures.Remove(sid);
        audit("shutdown-authorized", sid); // No password, hash, token, or request body in logs.
        shutdown(); // Only this fixed operation; no caller-supplied command, file or arguments.
        pendingOwner = sid; pendingUntil = now() + 30_000;
        return new("scheduled", "Windows aceitou o desligamento para daqui a 30 segundos. Salve seus arquivos. Você pode cancelar nesse prazo.", true);
    }
    private ControlResponse Denied(string sid)
    {
        var current = failures.GetValueOrDefault(sid);
        if (current.Until <= now()) current = (0, now() + 60_000);
        if (failures.Count >= 256 && !failures.ContainsKey(sid)) return new("rate_limited", "Aguarde e tente novamente.", true);
        failures[sid] = (current.Attempts + 1, current.Until);
        audit("shutdown-denied", sid);
        return new("denied", "Senha incorreta. O computador não será desligado.", true);
    }
}
