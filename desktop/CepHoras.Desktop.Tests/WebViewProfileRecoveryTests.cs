using CepHoras.Desktop;

internal static class WebViewProfileRecoveryTests
{
    public static void Run(Action<bool, string> check, string temporaryRoot)
    {
        var state = Path.Combine(temporaryRoot, "webview-recovery");
        var profile = Path.Combine(state, "WebView2");
        Directory.CreateDirectory(profile);
        File.WriteAllText(Path.Combine(profile, "fixture.txt"), "recoverable profile");

        WebViewProfileRecovery.Request(state);
        check(WebViewProfileRecovery.ResetIfRequested(state), "A requested WebView profile recovery was ignored");
        check(!Directory.Exists(profile), "The failed WebView profile remained active");
        check(!File.Exists(Path.Combine(state, "webview-recovery.request")), "The completed recovery request was not cleared");

        var backups = Directory.GetDirectories(state, "WebView2.recovery-*");
        check(backups.Length == 1, "The WebView profile was not preserved in exactly one recovery backup");
        check(File.ReadAllText(Path.Combine(backups[0], "fixture.txt")) == "recoverable profile",
            "The recovered WebView profile backup lost its contents");
        check(!WebViewProfileRecovery.ResetIfRequested(state), "Recovery ran without a pending request");
    }
}
