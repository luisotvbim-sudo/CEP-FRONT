using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace CepHoras.Desktop;

// Local, opt-in experiment. This is not a domain administrator credential or a security boundary.
internal sealed class ShutdownTestPolicy(byte[] salt, byte[] hash, Func<long>? clock = null)
{
    internal const int Iterations = 600_000;
    private readonly Func<long> now = clock ?? (() => Environment.TickCount64);
    private long? authorizedUntil;
    internal bool IsAuthorized => authorizedUntil is long deadline && now() < deadline;
    internal static string ConfigurationPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Conceito", "CepHoras", "shutdown-test.dat");

    internal static ShutdownTestPolicy? Load(string path)
    {
        if (!File.Exists(path)) return null;
        var plain = ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser);
        try
        {
            var config = JsonSerializer.Deserialize<Configuration>(plain)
                ?? throw new InvalidDataException("Configuração de teste vazia.");
            if (config.Version != 1 || config.Salt.Length != 16 || config.Hash.Length != 32)
                throw new InvalidDataException("Configuração de teste inválida.");
            return new ShutdownTestPolicy(config.Salt, config.Hash);
        }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }

    internal bool Authorize(string password)
    {
        var candidate = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        try
        {
            if (!CryptographicOperations.FixedTimeEquals(candidate, hash)) return false;
            authorizedUntil = now() + 60_000;
            return true;
        }
        finally { CryptographicOperations.ZeroMemory(candidate); }
    }

    internal void Reset() => authorizedUntil = null;
    private sealed record Configuration(int Version, byte[] Salt, byte[] Hash);
}
