using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace CepHoras.Control;

internal sealed class DesktopSupervisor
{
    private readonly DesktopSupervisionState state;
    private readonly Func<bool> maintenance;
    private readonly IDesktopSessions sessions;
    private readonly Func<DateTimeOffset> clock;
    private readonly Action<string, string> audit;
    private readonly Dictionary<uint, (int Attempts, DateTimeOffset RetryAt)> retries = [];

    internal DesktopSupervisor(DesktopSupervisionState state, Func<bool>? maintenance = null,
        IDesktopSessions? sessions = null, Func<DateTimeOffset>? clock = null, Action<string, string>? audit = null)
    {
        this.state = state;
        this.maintenance = maintenance ?? (() => false);
        this.sessions = sessions ?? new WindowsDesktopSessions();
        this.clock = clock ?? (() => DateTimeOffset.UtcNow);
        this.audit = audit ?? PolicyStore.Audit;
    }

    internal async Task Run(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try { Tick(); }
            catch (Exception error) when (error is Win32Exception or InvalidOperationException or IOException or UnauthorizedAccessException)
            { ControlAudit.TryWrite(audit, "desktop-supervisor-failed:" + error.GetType().Name, "SYSTEM"); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), token); }
            catch (OperationCanceledException) { }
        }
    }

    internal void Tick()
    {
        if (maintenance()) return;
        var active = sessions.ActiveSessions().Distinct().Where(id => id != 0 && id != uint.MaxValue).ToArray();
        foreach (var ended in retries.Keys.Except(active).ToArray()) retries.Remove(ended);
        foreach (var sessionId in active)
        {
            if (maintenance()) return;
            if (!state.AllowsLaunch(sessionId)) continue;
            if (sessions.IsRunning(sessionId)) { retries.Remove(sessionId); continue; }
            if (retries.TryGetValue(sessionId, out var retry) && clock() < retry.RetryAt) continue;
            var attempts = Math.Min(retry.Attempts + 1, 5);
            retries[sessionId] = (attempts, clock().AddSeconds(Math.Min(60, 5 * (1 << (attempts - 1)))));
            try
            {
                // Recheck immediately before acquiring a user token/launching. The
                // supervisor never launches a replacement during MSI maintenance.
                if (maintenance()) return;
                if (sessions.Launch(sessionId))
                    ControlAudit.TryWrite(audit, "desktop-restarted", "session:" + sessionId);
            }
            catch (Exception error) when (error is Win32Exception or InvalidOperationException or IOException or UnauthorizedAccessException)
            { ControlAudit.TryWrite(audit, "desktop-supervisor-failed:" + error.GetType().Name, "session:" + sessionId); }
        }
    }
}

internal interface IDesktopSessions
{
    IReadOnlyList<uint> ActiveSessions();
    bool IsRunning(uint sessionId);
    bool Launch(uint sessionId);
}

internal sealed class WindowsDesktopSessions : IDesktopSessions
{
    private readonly string executable = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "CepHoras.exe"));

    public IReadOnlyList<uint> ActiveSessions()
    {
        if (!WTSEnumerateSessions(0, 0, 1, out var buffer, out var count))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var size = Marshal.SizeOf<SessionInformation>();
            return Enumerable.Range(0, count).Select(index => Marshal.PtrToStructure<SessionInformation>(buffer + index * size))
                .Where(session => session.State == 0 && session.Id != 0).Select(session => session.Id).ToArray();
        }
        finally { WTSFreeMemory(buffer); }
    }

    public bool IsRunning(uint sessionId)
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

    public bool Launch(uint sessionId)
    {
        if (!File.Exists(executable) || IsRunning(sessionId)) return false;
        UpdateStore.RejectReparseAncestors(Path.GetDirectoryName(executable)!);
        if ((File.GetAttributes(executable) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Aplicativo instalado não pode ser um link.");
        if (!WTSQueryUserToken(sessionId, out var token)) return false;
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
                return true;
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

    [StructLayout(LayoutKind.Sequential)]
    private struct SessionInformation { internal uint Id; internal nint Name; internal int State; }

    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSEnumerateSessions(nint server, uint reserved, uint version, out nint sessions, out int count);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(nint memory);
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
