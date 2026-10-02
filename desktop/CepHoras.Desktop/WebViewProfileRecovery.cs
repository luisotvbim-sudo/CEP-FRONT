using System.Diagnostics;
using System.IO;

namespace CepHoras.Desktop;

public static class WebViewProfileRecovery
{
    private const string RestartArgument = "--recover-after";
    private static readonly string StateDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras");
    private static readonly string RequestPath = Path.Combine(StateDirectory, "webview-recovery.request");
    private static readonly string ProfilePath = Path.Combine(StateDirectory, "WebView2");

    public static void Request()
        => Request(StateDirectory);

    internal static void Request(string stateDirectory)
    {
        Directory.CreateDirectory(stateDirectory);
        File.WriteAllText(Path.Combine(stateDirectory, Path.GetFileName(RequestPath)), DateTimeOffset.UtcNow.ToString("O"));
    }

    public static ProcessStartInfo CreateRestartInfo()
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Desktop executable path is unavailable.");
        var start = new ProcessStartInfo(executable) { UseShellExecute = true };
        start.ArgumentList.Add(RestartArgument);
        start.ArgumentList.Add(Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return start;
    }

    public static void WaitForPreviousProcess(string[] arguments, TimeSpan timeout)
    {
        var index = Array.IndexOf(arguments, RestartArgument);
        if (index < 0 || index + 1 >= arguments.Length ||
            !int.TryParse(arguments[index + 1], out var processId) || processId == Environment.ProcessId)
            return;
        try
        {
            using var previous = Process.GetProcessById(processId);
            previous.WaitForExit(checked((int)timeout.TotalMilliseconds));
        }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
    }

    public static IDisposable EnterStartupGate(TimeSpan timeout)
    {
        var gate = new Mutex(false, @"Local\Conceito.CepHoras.Desktop.Recovery");
        var acquired = false;
        try
        {
            try { acquired = gate.WaitOne(timeout); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new TimeoutException("Timed out waiting for desktop recovery.");
            return new RecoveryGate(gate);
        }
        catch
        {
            gate.Dispose();
            throw;
        }
    }

    public static bool ResetIfRequested()
        => ResetIfRequested(StateDirectory);

    internal static bool ResetIfRequested(string stateDirectory)
    {
        var requestPath = Path.Combine(stateDirectory, Path.GetFileName(RequestPath));
        var profilePath = Path.Combine(stateDirectory, Path.GetFileName(ProfilePath));
        if (!File.Exists(requestPath)) return false;
        for (var attempt = 0; attempt < 30; attempt++)
        {
            try
            {
                if (Directory.Exists(profilePath))
                {
                    var backup = Path.Combine(stateDirectory,
                        $"WebView2.recovery-{DateTime.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}");
                    Directory.Move(profilePath, backup);
                }
                File.Delete(requestPath);
                return true;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                if (attempt == 29) return true;
                Thread.Sleep(100);
            }
        }
        return true;
    }

    private sealed class RecoveryGate(Mutex mutex) : IDisposable
    {
        public void Dispose()
        {
            try { mutex.ReleaseMutex(); }
            catch (ApplicationException) { }
            mutex.Dispose();
        }
    }
}
