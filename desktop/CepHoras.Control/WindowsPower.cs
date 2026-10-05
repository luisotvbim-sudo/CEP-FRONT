using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace CepHoras.Control;

internal sealed class WindowsPower : ISystemPower, IDisposable
{
    private readonly object gate = new();
    private CancellationTokenSource? hibernate;

    public void Schedule(string action, int delaySeconds)
    {
        if (action == "hibernate")
        {
            if (!IsPwrHibernateAllowed()) throw new InvalidOperationException("A hibernação não está disponível neste computador.");
            lock (gate)
            {
                hibernate?.Cancel();
                hibernate?.Dispose();
                hibernate = new CancellationTokenSource();
                var token = hibernate.Token;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(delaySeconds), token);
                        if (!SetSuspendState(true, false, false))
                            PolicyStore.Audit("hibernate-failed:" + Marshal.GetLastWin32Error(), "SYSTEM");
                    }
                    catch (OperationCanceledException) { }
                });
            }
            return;
        }
        if (action is not ("shutdown" or "restart")) throw new InvalidOperationException("Ação inválida.");
        EnablePrivilege();
        if (!InitiateSystemShutdownEx(
                null,
                "CEP Horas: ação autorizada. Salve seu trabalho ou use Cancelar.",
                checked((uint)delaySeconds),
                false,
                action == "restart",
                0x80040000))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public void Cancel(string action)
    {
        if (action == "hibernate")
        {
            lock (gate)
            {
                hibernate?.Cancel();
                hibernate?.Dispose();
                hibernate = null;
            }
            return;
        }
        EnablePrivilege();
        if (!AbortSystemShutdown(null))
        {
            var error = Marshal.GetLastWin32Error();
            // ERROR_NO_SHUTDOWN_IN_PROGRESS proves absence; other failures remain uncertain.
            if (error != 1116) throw new Win32Exception(error);
        }
    }

    private static void EnablePrivilege()
    {
        if (!OpenProcessToken(Process.GetCurrentProcess().Handle, 0x28, out var token))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        using (token)
        {
            if (!LookupPrivilegeValue(null, "SeShutdownPrivilege", out var luid))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var privileges = new TokenPrivileges { Count = 1, Luid = luid, Attributes = 2 };
            if (!AdjustTokenPrivileges(token, false, ref privileges, 0, 0, 0) || Marshal.GetLastWin32Error() != 0)
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            hibernate?.Cancel();
            hibernate?.Dispose();
            hibernate = null;
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint Low; internal int High; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenPrivileges { internal uint Count; internal Luid Luid; internal uint Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(nint process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValue(string? system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AdjustTokenPrivileges(SafeAccessTokenHandle token, [MarshalAs(UnmanagedType.Bool)] bool disableAll, ref TokenPrivileges state, uint length, nint previous, nint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitiateSystemShutdownEx(string? machine, string message, uint seconds, [MarshalAs(UnmanagedType.Bool)] bool force, [MarshalAs(UnmanagedType.Bool)] bool restart, uint reason);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AbortSystemShutdown(string? machine);
    [DllImport("powrprof.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool SetSuspendState([MarshalAs(UnmanagedType.U1)] bool hibernate, [MarshalAs(UnmanagedType.U1)] bool forceCritical, [MarshalAs(UnmanagedType.U1)] bool disableWakeEvent);
    [DllImport("powrprof.dll")] [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool IsPwrHibernateAllowed();
}
