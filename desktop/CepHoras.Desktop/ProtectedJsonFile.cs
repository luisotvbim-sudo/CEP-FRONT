using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace CepHoras.Desktop;

/// <summary>DPAPI storage for the current Windows user. The caller owns serialization
/// of updates; writes replace the previous file only after encryption succeeds.</summary>
internal sealed class ProtectedJsonFile(string path, byte[]? entropy = null)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public bool Exists => File.Exists(path);
    public void Delete() => File.Delete(path);

    public async Task<T?> ReadAsync<T>()
    {
        var bytes = ProtectedData.Unprotect(await File.ReadAllBytesAsync(path), entropy, DataProtectionScope.CurrentUser);
        try { return JsonSerializer.Deserialize<T>(bytes, Json); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public async Task WriteAsync<T>(T value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Json);
        try
        {
            var protectedBytes = ProtectedData.Protect(bytes, entropy, DataProtectionScope.CurrentUser);
            await File.WriteAllBytesAsync(path + ".tmp", protectedBytes);
            File.Move(path + ".tmp", path, true);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
}
