using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace CepHoras.Desktop;

internal static class DailyClosePassword
{
    private const string Suffix = "#pec";

    internal static string For(DateTime localDate) =>
        localDate.ToString("ddMMyy", CultureInfo.InvariantCulture) + Suffix;

    internal static bool IsValid(string? candidate, DateTime localDate)
    {
        if (candidate is null) return false;
        var supplied = Encoding.UTF8.GetBytes(candidate);
        var expected = Encoding.UTF8.GetBytes(For(localDate));
        try { return CryptographicOperations.FixedTimeEquals(supplied, expected); }
        finally
        {
            CryptographicOperations.ZeroMemory(supplied);
            CryptographicOperations.ZeroMemory(expected);
        }
    }
}
