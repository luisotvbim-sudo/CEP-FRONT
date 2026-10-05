using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.IO;

namespace CepHoras.Desktop;

internal sealed record OwnedWebViewProcess(int Id, long Started, string Image, int Session, int Depth);

internal static class WebViewProcessOwnership
{
    internal static bool SameIdentity(OwnedWebViewProcess expected, OwnedWebViewProcess actual)
        => expected.Id == actual.Id && expected.Started == actual.Started && expected.Session == actual.Session &&
           string.Equals(expected.Image, actual.Image, StringComparison.OrdinalIgnoreCase);

    internal static bool DescendsFrom(int id, int root, IReadOnlyDictionary<int, int> parents)
    {
        var seen = new HashSet<int>();
        while (seen.Add(id) && parents.TryGetValue(id, out var parent))
        {
            if (parent == root) return true;
            id = parent;
        }
        return false;
    }

    public static OwnedWebViewProcess[] Capture(int[] environmentIds, int browserId)
    {
        if (browserId == 0 || !environmentIds.Contains(browserId)) return [];
        var parents = Parents();
        using var host = Process.GetCurrentProcess();
        var browser = Read(browserId);
        if (browser is null || browser.Session != host.SessionId || browser.Started < host.StartTime.ToUniversalTime().Ticks ||
            !parents.TryGetValue(browserId, out var browserParent) || browserParent != host.Id ||
            !string.Equals(Path.GetFileName(browser.Image), "msedgewebview2.exe", StringComparison.OrdinalIgnoreCase)) return [];
        return environmentIds.Select(Read).Where(item => item is not null && item.Session == browser.Session &&
                item.Started >= browser.Started && string.Equals(item.Image, browser.Image, StringComparison.OrdinalIgnoreCase) &&
                (item.Id == browserId || DescendsFrom(item.Id, browserId, parents)))
            .Select(item => item! with { Depth = item!.Id == browserId ? 0 : 1 }).ToArray();
    }

    public static async Task<bool> StopAsync(OwnedWebViewProcess[] owned, TimeSpan timeout, CancellationToken cancellation)
    {
        // Give disposal a bounded chance to close normally, then terminate only
        // handles whose complete captured identity still matches. No tree kill.
        await Task.Delay(500, cancellation);
        return await Task.Run(async () =>
        {
            var stopped = true;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(timeout);
            foreach (var expected in owned.OrderByDescending(item => item.Depth))
            {
                if (deadline.IsCancellationRequested) { stopped = false; break; }
                try
                {
                    using var process = Process.GetProcessById(expected.Id);
                    _ = process.Handle; // Pin the kernel object before identity checks/kill; PID reuse cannot reopen a different target.
                    var actual = Read(process);
                    if (process.HasExited) continue;
                    if (actual is null) { stopped = false; continue; }
                    if (!SameIdentity(expected, actual)) continue;
                    process.Kill(entireProcessTree: false);
                    await process.WaitForExitAsync(deadline.Token);
                }
                catch (ArgumentException) { } // No process currently has this PID.
                catch (Exception error) when (error is InvalidOperationException or Win32Exception or OperationCanceledException) { stopped = false; }
            }
            return stopped;
        }, cancellation);
    }

    private static OwnedWebViewProcess? Read(int id)
    {
        try { using var process = Process.GetProcessById(id); return Read(process); }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or Win32Exception) { return null; }
    }
    internal static OwnedWebViewProcess? Observe(int id) => id > 0 ? Read(id) : null;
    internal static async Task<bool> ConfirmExitAsync(int id, OwnedWebViewProcess? expected, TimeSpan timeout, CancellationToken cancellation)
    {
        if (id == 0) return true;
        try
        {
            using var process = Process.GetProcessById(id);
            _ = process.Handle;
            if (process.HasExited) return true;
            var actual = Read(process);
            if (expected is null || actual is null) return false;
            if (!SameIdentity(expected, actual)) return true; // Original kernel object exited; never touch a reused PID.
            await process.WaitForExitAsync(cancellation).WaitAsync(timeout, cancellation);
            return true;
        }
        catch (ArgumentException) { return true; }
        catch (Exception error) when (error is InvalidOperationException or Win32Exception or TimeoutException) { return false; }
    }
    private static OwnedWebViewProcess? Read(Process process)
    {
        try { return new(process.Id, process.StartTime.ToUniversalTime().Ticks,
            Path.GetFullPath(process.MainModule!.FileName), process.SessionId, 0); }
        catch (Exception error) when (error is InvalidOperationException or Win32Exception) { return null; }
    }
    private static Dictionary<int, int> Parents()
    {
        var result = new Dictionary<int, int>();
        var handle = CreateToolhelp32Snapshot(2, 0);
        if (handle == new IntPtr(-1)) return result;
        try
        {
            var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>(), Image = "" };
            if (!Process32First(handle, ref entry)) return result;
            do { result[(int)entry.Id] = (int)entry.Parent; } while (Process32Next(handle, ref entry));
        }
        finally { CloseHandle(handle); }
        return result;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size, Usage, Id;
        public UIntPtr Heap;
        public uint Module, Threads, Parent;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Image;
    }
    [DllImport("kernel32.dll")] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint id);
    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode)] private static extern bool Process32First(IntPtr handle, ref ProcessEntry entry);
    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode)] private static extern bool Process32Next(IntPtr handle, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
}
