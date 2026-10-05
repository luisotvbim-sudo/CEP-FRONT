namespace CepHoras.Desktop;

// Pure state: navigation success, React commit and a round-trip bridge are
// separate observations. No API/session state participates in renderer health.
internal sealed class WebViewLifecycle
{
    public string Token { get; private set; } = Guid.NewGuid().ToString("N");
    public ulong NavigationId { get; private set; }
    public long Generation { get; private set; }
    public bool NavigationCompleted { get; private set; }
    public bool Ready { get; private set; }
    public string? Failure { get; private set; }
    private long started, lastResponse, healthySince;
    private int emptyResponses;

    public void Begin(ulong navigationId, long now)
    {
        NavigationId = navigationId;
        Generation++;
        Token = Guid.NewGuid().ToString("N");
        NavigationCompleted = Ready = false;
        Failure = null;
        emptyResponses = 0;
        started = lastResponse = healthySince = now;
    }

    public bool Complete(ulong id, bool success)
    {
        if (id != NavigationId || Failure is not null) return false;
        NavigationCompleted = success;
        if (!success) Fail("navigation-failed");
        return true;
    }

    public bool Respond(string? token, bool mounted, bool visible, bool assetFault, long now)
    {
        if (token != Token || !NavigationCompleted || Failure is not null) return false;
        lastResponse = now;
        if (assetFault) { Fail("asset-failed"); return true; }
        if (mounted && visible)
        {
            emptyResponses = 0;
            if (!Ready) healthySince = now;
            Ready = true;
        }
        else if (Ready && ++emptyResponses >= 3) Fail("rendered-root-empty");
        return true;
    }

    public string? Check(long now)
    {
        if (Failure is not null) return Failure;
        if (!Ready && now - started >= 30_000) Fail("loading-timeout");
        else if (Ready && now - lastResponse >= 6_000) Fail("renderer-unresponsive");
        return Failure;
    }

    public bool Stable(long now) => Ready && Failure is null && now - healthySince >= 60_000;
    public void Resume(long now)
    {
        lastResponse = healthySince = now;
        if (!Ready) started = now;
        emptyResponses = 0;
    }
    public void Fail(string code) { Failure ??= code; Ready = false; }
}

internal enum WebViewRecoveryStage { Reload, Recreate, Restart }
internal sealed class WebViewRecoveryPlan
{
    private int attempts;
    public (WebViewRecoveryStage Stage, TimeSpan Delay)? Next()
        => attempts++ switch
        {
            0 => (WebViewRecoveryStage.Reload, TimeSpan.FromSeconds(1)),
            1 => (WebViewRecoveryStage.Reload, TimeSpan.FromSeconds(3)),
            2 => (WebViewRecoveryStage.Recreate, TimeSpan.FromSeconds(8)),
            3 => (WebViewRecoveryStage.Restart, TimeSpan.FromSeconds(15)),
            _ => null
        };
    public void Reset() => attempts = 0;
}
