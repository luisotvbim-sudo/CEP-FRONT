using System.Diagnostics;
using System.Globalization;
using System.IO;

namespace CepHoras.Desktop;

internal enum ProfileRecoveryResult { None, Completed, Failed }

public static class WebViewProfileRecovery
{
    private const string RestartArgument = "--recover-after";
    public static string GetProfilePath()
    {
        var configured = Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER");
        return ValidateProfile(string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras", "WebView2")
            : configured);
    }
    private static string DefaultProfile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Conceito", "CepHoras", "WebView2");
    private static string ProfileIdentity(string profile) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(profile.ToUpperInvariant())));

    internal static string ValidateProfile(string path)
    {
        var full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
        if (SamePath(full, Path.GetPathRoot(full)!)) throw new IOException("A root directory cannot be a browser profile.");
        for (var directory = new DirectoryInfo(full); directory is not null; directory = directory.Parent)
            if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("A browser profile cannot traverse a reparse point.");
        return full;
    }

    internal static bool SamePath(string left, string right) => string.Equals(
        Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar),
        Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);

    internal static FileStream AcquireProfile(string profile)
    {
        profile = ValidateProfile(profile);
        Directory.CreateDirectory(Path.GetDirectoryName(profile)!);
        var lease = new FileStream(profile + ".host.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        try
        {
            var marker = Path.Combine(profile, ".cep-profile-owner");
            var identity = ProfileIdentity(profile);
            if (Directory.Exists(profile) && !File.Exists(marker) && !SamePath(profile, DefaultProfile))
                throw new IOException("An existing override directory is not a CEP-owned profile.");
            if (File.Exists(marker) && File.ReadAllText(marker) != identity)
                throw new IOException("The profile ownership marker does not match its path.");
            Directory.CreateDirectory(profile);
            if (!File.Exists(marker))
            {
                using var stream = new FileStream(marker, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                stream.Write(System.Text.Encoding.UTF8.GetBytes(identity));
                stream.Flush(true);
            }
            return lease;
        }
        catch { lease.Dispose(); throw; }
    }

    public static void Request(string profile)
    {
        profile = ValidateProfile(profile);
        Directory.CreateDirectory(Path.GetDirectoryName(profile)!);
        if (!File.Exists(Path.Combine(profile, ".cep-profile-owner")) ||
            File.ReadAllText(Path.Combine(profile, ".cep-profile-owner")) != ProfileIdentity(profile))
            throw new IOException("Only an owned CEP profile can be backed up during recovery.");
        using var stream = new FileStream(profile + ".recovery.request", FileMode.Create, FileAccess.Write, FileShare.None);
        stream.Write(System.Text.Encoding.UTF8.GetBytes(DateTimeOffset.UtcNow.ToString("O")));
        stream.Flush(true);
    }

    public static ProcessStartInfo CreateRestartInfo()
    {
        using var current = Process.GetCurrentProcess();
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Desktop executable path is unavailable.");
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(RestartArgument);
        start.ArgumentList.Add(Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
        start.ArgumentList.Add(current.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture));
        return start;
    }

    public static async Task WaitForPreviousProcessAsync(string[] arguments, TimeSpan timeout)
    {
        var index = Array.IndexOf(arguments, RestartArgument);
        if (index < 0) return;
        if (index + 2 >= arguments.Length || !int.TryParse(arguments[index + 1], out var id) ||
            !long.TryParse(arguments[index + 2], out var ticks) || id == Environment.ProcessId)
            throw new InvalidOperationException("Invalid recovery process identity.");
        try
        {
            using var previous = Process.GetProcessById(id);
            using var current = Process.GetCurrentProcess();
            if (previous.StartTime.ToUniversalTime().Ticks != ticks || previous.SessionId != current.SessionId ||
                !SamePath(previous.MainModule!.FileName, Environment.ProcessPath!)) return;
            await previous.WaitForExitAsync().WaitAsync(timeout);
        }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
    }

    internal static async Task<FileStream> EnterStartupGateAsync(string profile, TimeSpan timeout)
    {
        profile = ValidateProfile(profile);
        Directory.CreateDirectory(Path.GetDirectoryName(profile)!);
        var started = Environment.TickCount64;
        while (true)
        {
            try { return new FileStream(profile + ".startup.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (Environment.TickCount64 - started < timeout.TotalMilliseconds)
            { await Task.Delay(100); }
        }
    }

    internal static ProfileRecoveryResult ResetIfRequested(string profile)
    {
        profile = ValidateProfile(profile);
        var request = profile + ".recovery.request";
        if (!File.Exists(request)) return ProfileRecoveryResult.None;
        try
        {
            using var lease = AcquireProfile(profile);
            if (Directory.Exists(profile))
                Directory.Move(profile, profile + $".recovery-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}");
            File.Delete(request);
            return ProfileRecoveryResult.Completed;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { return ProfileRecoveryResult.Failed; }
    }

    internal static bool TryReserveAutomaticRestart(string profile)
    {
        profile = ValidateProfile(profile);
        var path = profile + ".restart-budget";
        // A supervisor relaunch must not start a fresh infinite restart loop.
        if (File.Exists(path))
        {
            if (!DateTimeOffset.TryParse(File.ReadAllText(path), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var last)) return false;
            if (DateTimeOffset.UtcNow - last < TimeSpan.FromMinutes(10)) return false;
        }
        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);
        stream.Write(System.Text.Encoding.UTF8.GetBytes(DateTimeOffset.UtcNow.ToString("O")));
        stream.Flush(true);
        return true;
    }
}
