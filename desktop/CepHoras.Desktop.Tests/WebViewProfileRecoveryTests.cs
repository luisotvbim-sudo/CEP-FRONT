using CepHoras.Desktop;

internal static class WebViewProfileRecoveryTests
{
    public static void Run(Action<bool, string> check, string temporaryRoot)
    {
        var profile = Path.Combine(temporaryRoot, "actual-udf");
        using (WebViewProfileRecovery.AcquireProfile(profile)) { }
        File.WriteAllText(Path.Combine(profile, "fixture.txt"), "recoverable profile");
        WebViewProfileRecovery.Request(profile);
        using (WebViewProfileRecovery.AcquireProfile(profile))
        {
            check(WebViewProfileRecovery.ResetIfRequested(profile) == ProfileRecoveryResult.Failed, "A locked profile reported successful recovery");
            check(File.Exists(profile + ".recovery.request"), "Failed recovery lost its retry request");
            check(File.Exists(Path.Combine(profile, "fixture.txt")), "Recovery modified a profile owned by another host");
        }
        check(WebViewProfileRecovery.ResetIfRequested(profile) == ProfileRecoveryResult.Completed, "An unlocked recovery was ignored");
        check(!Directory.Exists(profile), "The failed WebView profile remained active");
        check(!File.Exists(profile + ".recovery.request"), "Completed recovery retained its request");
        var backups = Directory.GetDirectories(temporaryRoot, "actual-udf.recovery-*");
        check(backups.Length == 1 && File.ReadAllText(Path.Combine(backups[0], "fixture.txt")) == "recoverable profile", "Recovery lost the real profile backup");
        check(WebViewProfileRecovery.ResetIfRequested(profile) == ProfileRecoveryResult.None, "Recovery ran without a request");
        check(WebViewProfileRecovery.TryReserveAutomaticRestart(profile), "First automatic restart was denied");
        check(!WebViewProfileRecovery.TryReserveAutomaticRestart(profile), "A new host could start an infinite restart loop");
        try { WebViewProfileRecovery.ValidateProfile(Path.GetPathRoot(profile)!); check(false, "Root accepted as profile"); }
        catch (IOException) { check(true, "Root rejected"); }
        var unrelated = Path.Combine(temporaryRoot, "other-user-data");
        Directory.CreateDirectory(unrelated);
        try { using var invalid = WebViewProfileRecovery.AcquireProfile(unrelated); check(false, "Existing unrelated data claimed as browser profile"); }
        catch (IOException) { check(true, "Unowned override rejected"); }
    }
}
