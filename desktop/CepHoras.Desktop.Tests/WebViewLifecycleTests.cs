using CepHoras.Desktop;

internal static class WebViewLifecycleTests
{
    public static void Run(Action<bool, string> check)
    {
        var state = new WebViewLifecycle();
        state.Begin(10, 0);
        var old = state.Token;
        state.Begin(11, 100);
        check(!state.Complete(10, false) && state.Failure is null, "Cancelled old navigation failed a new document");
        check(state.Complete(11, true) && !state.Ready, "HTML success prematurely dismissed native loading");
        check(!state.Respond(old, true, true, false, 150) && !state.Ready, "Old document handshake readied a new navigation");
        state.Respond(state.Token, false, true, false, 200);
        check(!state.Ready, "Visible content without React mount marked ready");
        state.Respond(state.Token, true, true, false, 300);
        check(state.Ready && state.Check(5_000) is null, "Healthy renderer failed while API may be unavailable");
        state.Resume(500_000);
        check(state.Check(500_001) is null, "Suspend elapsed time was treated as renderer failure");
        check(state.Check(506_001) == "renderer-unresponsive", "Blocked JavaScript/bridge was not detected");
        state.Begin(12, 1_000);
        state.Complete(12, true);
        check(state.Check(31_000) == "loading-timeout", "Missing bundle/React was not detected");
        state.Begin(13, 0);
        state.Complete(13, true);
        state.Respond(state.Token, true, true, true, 1);
        check(state.Failure == "asset-failed", "Render boundary/asset failure was ignored");
        state.Begin(14, 0);
        state.Complete(14, true);
        state.Respond(state.Token, true, true, false, 1);
        for (var i = 0; i < 3; i++) state.Respond(state.Token, true, false, false, 2+i);
        check(state.Failure == "rendered-root-empty", "White screen after mount was ignored");
        var plan = new WebViewRecoveryPlan();
        check(plan.Next()?.Stage == WebViewRecoveryStage.Reload && plan.Next()?.Stage == WebViewRecoveryStage.Reload &&
            plan.Next()?.Stage == WebViewRecoveryStage.Recreate && plan.Next()?.Stage == WebViewRecoveryStage.Restart && plan.Next() is null,
            "Recovery stages are not bounded/gradual");
        var process = new OwnedWebViewProcess(42, 100, "runtime.exe", 1, 0);
        check(!WebViewProcessOwnership.SameIdentity(process, process with { Started = 101 }), "Reused PID could be terminated");
        check(!WebViewProcessOwnership.SameIdentity(process, process with { Session = 2 }), "Another session could be terminated");
        check(!WebViewProcessOwnership.SameIdentity(process, process with { Image = "edge.exe" }), "A different executable could be terminated");
        check(WebViewProcessOwnership.DescendsFrom(3, 1, new Dictionary<int,int> {{3,2},{2,1}}), "Owned renderer ancestry lost");
        check(!WebViewProcessOwnership.DescendsFrom(3, 1, new Dictionary<int,int> {{3,2},{2,3}}), "Cyclic/shared ancestry accepted");
    }
}
