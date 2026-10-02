using System.Runtime.InteropServices;
using System.Text;

namespace CepHoras.Updates;

public static class MsiPackageIdentity
{
    internal const string ExpectedUpgradeCode = "8D0D0DC8-E744-42E7-A57A-20F489145ED8";

    public static void Verify(string packagePath, Version expectedVersion)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("A identidade MSI requer Windows.");
        Check(MsiOpenDatabase(packagePath, IntPtr.Zero, out var database)); // MSIDBOPEN_READONLY
        try
        {
            var properties = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var property in new[] { "ProductName", "Manufacturer", "ProductVersion", "UpgradeCode", "ALLUSERS" })
                properties.Add(property, ReadProperty(database, property));
            Check(MsiGetSummaryInformation(database, null, 0, out var summary));
            try
            {
                var buffer = new StringBuilder(1025);
                uint size = 1024;
                Check(MsiSummaryInfoGetProperty(summary, 7, out var type, out _, out _, buffer, ref size)); // PID_TEMPLATE
                if (type != 30) throw new InvalidDataException("O MSI não possui plataforma declarada."); // VT_LPSTR
                Validate(properties, buffer.ToString(), expectedVersion);
            }
            finally { MsiCloseHandle(summary); }
        }
        finally { MsiCloseHandle(database); }
    }

    internal static void Validate(IReadOnlyDictionary<string, string> properties, string template, Version expectedVersion)
    {
        if (!properties.TryGetValue("ProductName", out var name) || name != "CEP Horas" ||
            !properties.TryGetValue("Manufacturer", out var manufacturer) || manufacturer != "Conceito" ||
            !properties.TryGetValue("ProductVersion", out var version) || version != expectedVersion.ToString(3) ||
            !properties.TryGetValue("UpgradeCode", out var upgrade) || !Guid.TryParse(upgrade, out var code) ||
            code != Guid.Parse(ExpectedUpgradeCode) || !properties.TryGetValue("ALLUSERS", out var allUsers) || allUsers != "1" ||
            template.Split(';')[0] != "x64")
            throw new InvalidDataException("Produto, fabricante, versão ou arquitetura do MSI não corresponde ao CEP Horas.");
    }

    private static string ReadProperty(uint database, string property)
    {
        Check(MsiDatabaseOpenView(database, $"SELECT `Value` FROM `Property` WHERE `Property`='{property}'", out var view));
        try
        {
            Check(MsiViewExecute(view, 0));
            Check(MsiViewFetch(view, out var record));
            try
            {
                var buffer = new StringBuilder(1025);
                uint size = 1024;
                Check(MsiRecordGetString(record, 1, buffer, ref size));
                return buffer.ToString();
            }
            finally { MsiCloseHandle(record); }
        }
        finally { MsiCloseHandle(view); }
    }

    private static void Check(uint error)
    {
        if (error != 0) throw new InvalidDataException($"Não foi possível validar o banco MSI (código {error}).");
    }

    [DllImport("msi.dll", EntryPoint = "MsiOpenDatabaseW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiOpenDatabase(string path, IntPtr persistence, out uint database);
    [DllImport("msi.dll", EntryPoint = "MsiDatabaseOpenViewW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiDatabaseOpenView(uint database, string query, out uint view);
    [DllImport("msi.dll", ExactSpelling = true)] private static extern uint MsiViewExecute(uint view, uint record);
    [DllImport("msi.dll", ExactSpelling = true)] private static extern uint MsiViewFetch(uint view, out uint record);
    [DllImport("msi.dll", EntryPoint = "MsiRecordGetStringW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiRecordGetString(uint record, uint field, StringBuilder value, ref uint size);
    [DllImport("msi.dll", EntryPoint = "MsiGetSummaryInformationW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiGetSummaryInformation(uint database, string? path, uint updateCount, out uint summary);
    [DllImport("msi.dll", EntryPoint = "MsiSummaryInfoGetPropertyW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint MsiSummaryInfoGetProperty(uint summary, uint property, out uint type, out int integer,
        out System.Runtime.InteropServices.ComTypes.FILETIME filetime, StringBuilder value, ref uint size);
    [DllImport("msi.dll", ExactSpelling = true)] private static extern uint MsiCloseHandle(uint handle);
}
