using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace CepHoras.Control;

internal static class DurableStateFile
{
    // Keep the old journal until the complete replacement is on disk. A temporary
    // file inherits the private directory ACL and is secured before writing bytes.
    internal static void Write<T>(string path, T value, Action<string> secure,
        Action<string, string>? publish = null, Action<FileStream>? flush = null)
    {
        var temporary = Path.Combine(Path.GetDirectoryName(path)!, Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                       4096, FileOptions.WriteThrough))
            {
                secure(temporary);
                JsonSerializer.Serialize(stream, value);
                if (flush is null) stream.Flush(flushToDisk: true);
                else flush(stream);
            }
            (publish ?? Publish)(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static void Publish(string temporary, string path)
    {
        // MOVEFILE_WRITE_THROUGH waits for the rename to be flushed as well as
        // the file contents. Both files are on the same protected volume.
        if (!MoveFileEx(temporary, path, 0x1 | 0x8))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string existing, string destination, uint flags);
}
