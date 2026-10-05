using System.IO;
using Microsoft.Win32;
using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal static class InstalledLayout
{
    internal static string Root()
    {
        using var service = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\" + ControlWire.ServiceName);
        if (service?.GetValue("ImagePath") is string image) return FromServiceImage(image);
        // Development/tests have no installed service. The MSI service and its
        // copied runner resolve their fixed SCM registration before maintenance.
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Conceito CEP Horas");
    }

    internal static string FromServiceImage(string image)
    {
        const string suffix = "\" --service";
        if (!image.StartsWith('"') || !image.EndsWith(suffix, StringComparison.Ordinal))
            throw new InvalidDataException("Registro do serviço CEP Horas incompatível.");
        var executable = image[1..^suffix.Length];
        if (!Path.IsPathFullyQualified(executable) || executable.StartsWith(@"\\", StringComparison.Ordinal) ||
            executable.Contains('"') || Path.GetFileName(executable) != "CepHoras.Control.exe")
            throw new InvalidDataException("Executável do serviço CEP Horas incompatível.");
        var control = Path.GetDirectoryName(Path.GetFullPath(executable))!;
        if (!string.Equals(Path.GetFileName(control), "control", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Layout do serviço CEP Horas incompatível.");
        return Path.GetDirectoryName(control)!;
    }
}
