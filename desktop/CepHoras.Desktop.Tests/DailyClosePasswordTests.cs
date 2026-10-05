using CepHoras.Desktop;

internal static class DailyClosePasswordTests
{
    internal static void Run(Action<bool, string> check)
    {
        var date = new DateTime(2026, 10, 2, 23, 59, 59, DateTimeKind.Local);
        check(DailyClosePassword.For(date) == "021026#pec", "Daily close password must use ddMMyy#pec");
        check(DailyClosePassword.IsValid("021026#pec", date), "Expected daily close password rejected");
        check(!DailyClosePassword.IsValid("210026#pec", date), "Day without leading zero accepted");
        check(!DailyClosePassword.IsValid("02102026#pec", date), "Four-digit year accepted");
        check(!DailyClosePassword.IsValid("021026#PEC", date), "Password suffix must be exact");
        check(!DailyClosePassword.IsValid(null, date), "Null password accepted");
    }
}
