using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace CepHoras.Control;

internal static class NativePolicy
{
    internal static readonly string[] Rights = ["SeShutdownPrivilege", "SeRemoteShutdownPrivilege"];
    internal static readonly string[] Allowed = ["S-1-5-18", "S-1-5-32-544"];
    internal static string[] ReadRight(string right)
    {
        using var name = new LsaName(right);
        using var policy = Open(false);
        var status = LsaEnumerateAccountsWithUserRight(policy.Handle, ref name.Value, out var buffer, out var count);
        if (status == 0x8000001a) return [];
        Check(status);
        try
        {
            return Enumerable.Range(0, checked((int)count)).Select(i =>
                new SecurityIdentifier(Marshal.ReadIntPtr(buffer, i * IntPtr.Size)).Value).Order().ToArray();
        }
        finally { LsaFreeMemory(buffer); }
    }
    internal static void WriteRight(string right, string[] accounts)
    {
        if (!Rights.Contains(right)) throw new InvalidOperationException("Direito fora do escopo.");
        using var policy = Open();
        using var name = new LsaName(right);
        var current = ReadRight(right);
        foreach (var sid in current.Except(accounts)) WithSid(sid, p => Check(LsaRemoveAccountRights(policy.Handle, p, false, ref name.Value, 1)));
        foreach (var sid in accounts.Except(current)) WithSid(sid, p => Check(LsaAddAccountRights(policy.Handle, p, ref name.Value, 1)));
    }
    private static void WithSid(string value, Action<nint> action)
    {
        var sid = new SecurityIdentifier(value);
        var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        try { Marshal.Copy(bytes, 0, pointer, bytes.Length); action(pointer); }
        finally { Marshal.FreeHGlobal(pointer); }
    }
    private static PolicyHandle Open(bool write = true)
    {
        var attributes = new ObjectAttributes { Length = Marshal.SizeOf<ObjectAttributes>() };
        Check(LsaOpenPolicy(0, ref attributes, write ? 0x811u : 0x801u, out var handle));
        return new PolicyHandle(handle);
    }
    private static void Check(uint status) { if (status != 0) throw new Win32Exception((int)LsaNtStatusToWinError(status)); }
    private sealed class PolicyHandle(nint handle) : IDisposable { internal nint Handle => handle; public void Dispose() => LsaClose(handle); }
    [StructLayout(LayoutKind.Sequential)] private struct ObjectAttributes
    { internal int Length; internal nint RootDirectory, ObjectName; internal uint Attributes; internal nint SecurityDescriptor, SecurityQualityOfService; }
    [StructLayout(LayoutKind.Sequential)] private struct UnicodeString { internal ushort Length, MaximumLength; internal nint Buffer; }
    private sealed class LsaName : IDisposable
    {
        internal UnicodeString Value;
        internal LsaName(string value) => Value = new UnicodeString { Length = checked((ushort)(value.Length * 2)), MaximumLength = checked((ushort)((value.Length + 1) * 2)), Buffer = Marshal.StringToHGlobalUni(value) };
        public void Dispose() => Marshal.FreeHGlobal(Value.Buffer);
    }
    [DllImport("advapi32.dll")] private static extern uint LsaOpenPolicy(nint system, ref ObjectAttributes attributes, uint access, out nint handle);
    [DllImport("advapi32.dll")] private static extern uint LsaClose(nint handle);
    [DllImport("advapi32.dll")] private static extern uint LsaNtStatusToWinError(uint status);
    [DllImport("advapi32.dll")] private static extern uint LsaFreeMemory(nint buffer);
    [DllImport("advapi32.dll")] private static extern uint LsaEnumerateAccountsWithUserRight(nint handle, ref UnicodeString right, out nint buffer, out uint count);
    [DllImport("advapi32.dll")] private static extern uint LsaAddAccountRights(nint handle, nint sid, ref UnicodeString right, uint count);
    [DllImport("advapi32.dll")] private static extern uint LsaRemoveAccountRights(nint handle, nint sid, [MarshalAs(UnmanagedType.U1)] bool all, ref UnicodeString right, uint count);
}
