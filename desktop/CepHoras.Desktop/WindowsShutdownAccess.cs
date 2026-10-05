using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace CepHoras.Desktop;

internal static class WindowsShutdownAccess
{
    // Read only: never enables privileges or invokes an energy action.
    internal static bool? HasShutdownPrivilege()
    {
        if (!OpenProcessToken(GetCurrentProcess(), 0x0008, out var token)) return null;
        using (token)
        {
            if (!LookupPrivilegeValue(null, "SeShutdownPrivilege", out var privilege)) return null;
            _ = GetTokenInformation(token, 3, 0, 0, out var size);
            if (size < 4 || size > 1_048_576) return null;
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!GetTokenInformation(token, 3, buffer, size, out var returned) || returned > size) return null;
                var bytes = new byte[returned];
                Marshal.Copy(buffer, bytes, 0, bytes.Length);
                return ContainsPrivilege(bytes, privilege.LowPart, privilege.HighPart);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    internal static bool ContainsPrivilege(ReadOnlySpan<byte> bytes, uint lowPart, int highPart)
    {
        if (bytes.Length < 4) throw new InvalidDataException("Token de privilégios incompleto.");
        var count = BinaryPrimitives.ReadUInt32LittleEndian(bytes);
        if (count > (bytes.Length - 4) / 12) throw new InvalidDataException("Token de privilégios incompleto.");
        for (var i = 0; i < count; i++)
        {
            var entry = bytes.Slice(4 + i * 12, 12);
            if (BinaryPrimitives.ReadUInt32LittleEndian(entry) == lowPart &&
                BinaryPrimitives.ReadInt32LittleEndian(entry[4..]) == highPart) return true;
        }
        return false;
    }

    [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint LowPart; internal int HighPart; }
    [DllImport("kernel32.dll")] private static extern nint GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(nint process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValue(string? system, string name, out Luid privilege);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int kind, nint buffer, int length, out int returned);
}
