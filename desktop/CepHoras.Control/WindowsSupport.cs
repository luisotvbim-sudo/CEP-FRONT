using System.IO;
using Microsoft.Win32;

namespace CepHoras.Control;

internal static class WindowsSupport
{
    internal const string Requirement = "Requer Windows 11 x64 Pro, Enterprise ou Education 24H2 ou superior.";

    internal static bool IsSupported(bool x64, int build, string? installationType, string? edition) =>
        x64 && build >= 26100 && installationType == "Client" && edition is not null &&
        new[] { "Professional", "Enterprise", "Education" }.Any(family => edition.StartsWith(family, StringComparison.Ordinal));

    internal static void RequireSupported()
    {
        using var os = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        if (!IsSupported(Environment.Is64BitOperatingSystem, Environment.OSVersion.Version.Build,
                os?.GetValue("InstallationType") as string, os?.GetValue("EditionID") as string))
            throw new InvalidOperationException(Requirement);
    }
}
