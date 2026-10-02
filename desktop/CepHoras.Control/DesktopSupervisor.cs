using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace CepHoras.Control;

internal sealed class DesktopSupervisor
{
    private readonly string executable = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "CepHoras.exe"));
    private readonly DesktopSupervisionState state;
    private readonly Func<bool> maintenance;

    internal DesktopSupervisor(DesktopSupervisionState state, Func<bool>? maintenance = null)
    {
        this.state = state;
        this.maintenance = maintenance ?? (() => false);
    }

    internal async Task Run(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try { EnsureRunning(); }
            catch (Exception error) when (error is Win32Exception or InvalidOperationException or IOException or UnauthorizedAccessException)
            { PolicyStore.Audit("desktop-supervisor-failed:" + error.GetType().Name, "SYSTEM"); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), token); }
            catch (OperationCanceledException) { }
        }
    }

    internal bool IsRunning(uint sessionId)
    {
        foreach (var process in Process.GetProcessesByName("CepHoras"))
        {
            using (process)
            {
                try
                {
                    if (process.SessionId == sessionId &&
                        string.Equals(Path.GetFullPath(process.MainModule?.FileName ?? ""), executable, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
                catch (Exception error) when (error is Win32Exception or InvalidOperationException) { }
            }
        }
        return false;
    }

    private void EnsureRunning()
    {
        if (maintenance()) return;
        if (!File.Exists(executable)) return;
        var sessionId = WTSGetActiveConsoleSessionId();
        if (sessionId == uint.MaxValue || !state.AllowsLaunch(sessionId) || IsRunning(sessionId)) return;
        if (!WTSQueryUserToken(sessionId, out var token)) return;
        try
        {
            if (!CreateEnvironmentBlock(out var environment, token, false)) environment = 0;
            try
            {
                var startup = new StartupInfo
                {
                    Size = Marshal.SizeOf<StartupInfo>(),
                    Desktop = @"winsta0\default"
                };
                var command = new StringBuilder($"\"{executable}\" --background");
                if (!CreateProcessAsUser(
                        token,
                        executable,
                        command,
                        0,
                        0,
                        false,
                        0x00000400,
                        environment,
                        Path.GetDirectoryName(executable),
                        ref startup,
                        out var information))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                CloseHandle(information.Process);
                CloseHandle(information.Thread);
                PolicyStore.Audit("desktop-restarted", "session:" + sessionId);
            }
            finally { if (environment != 0) DestroyEnvironmentBlock(environment); }
        }
        finally { CloseHandle(token); }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        internal int Size;
        internal string? Reserved;
        internal string? Desktop;
        internal string? Title;
        internal int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        internal short ShowWindow, Reserved2;
        internal nint ReservedPointer, StandardInput, StandardOutput, StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        internal nint Process, Thread;
        internal uint ProcessId, ThreadId;
    }

    [DllImport("kernel32.dll")] private static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSQueryUserToken(uint sessionId, out nint token);
    [DllImport("userenv.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateEnvironmentBlock(out nint environment, nint token, [MarshalAs(UnmanagedType.Bool)] bool inherit);
    [DllImport("userenv.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyEnvironmentBlock(nint environment);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessAsUser(
        nint token,
        string applicationName,
        StringBuilder commandLine,
        nint processAttributes,
        nint threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        nint environment,
        string? currentDirectory,
        ref StartupInfo startup,
        out ProcessInformation processInformation);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(nint handle);
}
