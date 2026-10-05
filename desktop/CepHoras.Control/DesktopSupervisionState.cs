namespace CepHoras.Control;

internal sealed class DesktopSupervisionState
{
    private readonly object gate = new();
    private readonly Dictionary<uint, string> suspended = [];

    internal void Suspend(uint sessionId, string sid)
    {
        lock (gate)
        {
            suspended[sessionId] = sid;
        }
    }

    internal bool Resume(uint sessionId, string sid)
    {
        lock (gate)
        {
            if (!suspended.TryGetValue(sessionId, out var owner) || !string.Equals(owner, sid, StringComparison.Ordinal))
                return false;
            return suspended.Remove(sessionId);
        }
    }

    internal bool ResumeSession(uint sessionId)
    {
        lock (gate)
        {
            return suspended.Remove(sessionId);
        }
    }

    internal bool AllowsLaunch(uint activeSessionId)
    {
        lock (gate)
        {
            return !suspended.ContainsKey(activeSessionId);
        }
    }
}
