using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.ComponentModel;
using System.Runtime.InteropServices;

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
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var protectedBytes = ProtectedData.Protect(bytes, entropy, DataProtectionScope.CurrentUser);
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                4096, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(protectedBytes);
                stream.Flush(flushToDisk: true);
            }
            if (!MoveFileEx(temporary, path, 0x1 | 0x8))
                throw new IOException("Não foi possível publicar o estado protegido.", new Win32Exception(Marshal.GetLastWin32Error()));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string existing, string destination, uint flags);
}
