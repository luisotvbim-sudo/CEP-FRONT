using System.Buffers.Binary;
using CepHoras.Desktop;

internal static class WindowsShutdownAccessTests
{
    internal static void Run(Action<bool, string> check)
    {
        var token = new byte[28];
        BinaryPrimitives.WriteUInt32LittleEndian(token, 2);
        BinaryPrimitives.WriteUInt32LittleEndian(token.AsSpan(4), 19);
        BinaryPrimitives.WriteInt32LittleEndian(token.AsSpan(8), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(token.AsSpan(16), 20);
        BinaryPrimitives.WriteUInt32LittleEndian(token.AsSpan(24), 2);
        check(WindowsShutdownAccess.ContainsPrivilege(token, 19, 1), "a present but disabled privilege is recoverable by Windows");
        check(WindowsShutdownAccess.ContainsPrivilege(token, 20, 0), "an enabled privilege is present");
        check(!WindowsShutdownAccess.ContainsPrivilege(token, 19, 0), "compare both LUID parts");
        check(!WindowsShutdownAccess.ContainsPrivilege(token, 21, 0), "missing shutdown privilege requires a new Windows session");
        check(!WindowsShutdownAccess.ContainsPrivilege(new byte[4], 19, 0), "an empty privilege list is not a grant");
        foreach (var malformed in new[] { new byte[3], token[..27], new byte[] { 255, 255, 255, 255 } })
        {
            try { WindowsShutdownAccess.ContainsPrivilege(malformed, 19, 0); throw new Exception("Invalid token accepted"); }
            catch (InvalidDataException) { check(true, "malformed token cannot report a successful release"); }
        }
        check(WindowsShutdownAccess.HasShutdownPrivilege() is not null, "native token inspection works without administrator or power effects");
    }
}
