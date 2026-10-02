namespace CepHoras.Control;

internal sealed class DesktopSupervisionState
{
    private readonly object gate = new();
    private uint? suspendedSession;
    private string? suspendedSid;

    internal void Suspend(uint sessionId, string sid)
    {
        lock (gate)
        {
            suspendedSession = sessionId;
            suspendedSid = sid;
        }
    }

    internal bool Resume(uint sessionId, string sid)
    {
        lock (gate)
        {
            if (suspendedSession != sessionId || !string.Equals(suspendedSid, sid, StringComparison.Ordinal))
                return false;
            suspendedSession = null;
            suspendedSid = null;
            return true;
        }
    }

    internal bool AllowsLaunch(uint activeSessionId)
    {
        lock (gate)
        {
            if (suspendedSession is null) return true;
            if (suspendedSession == activeSessionId) return false;
            suspendedSession = null;
            suspendedSid = null;
            return true;
        }
    }
}
