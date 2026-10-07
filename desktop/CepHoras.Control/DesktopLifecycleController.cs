using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class DesktopLifecycleController(
    DesktopSupervisionState state,
    Action restorePolicy,
    Action applyPolicy,
    Action<string, string> audit,
    Func<bool>? maintenance = null,
    Func<IReadOnlyList<uint>>? activeSessions = null)
{
    private readonly object gate = new();

    internal ControlResponse Suspend(uint sessionId, string sid)
    {
        lock (gate)
        {
            if (maintenance?.Invoke() == true)
                return new("update_maintenance", "A atualização está em andamento; os controles de energia permanecem ativos.");
            if (!IsOnlyActiveSession(sessionId))
                return new("multiple_sessions", "Há outra sessão interativa. A restauração das políticas da máquina exige revisão da TI.");
            restorePolicy();
            // Update preparation may have started while restoration was running.
            // Reprotect before reporting a close that would release global controls.
            if (maintenance?.Invoke() == true)
            {
                applyPolicy();
                return new("update_maintenance", "A atualização começou; os controles de energia permanecem ativos.");
            }
            bool stillAlone;
            try { stillAlone = IsOnlyActiveSession(sessionId); }
            catch { applyPolicy(); throw; }
            if (!stillAlone)
            {
                applyPolicy();
                return new("multiple_sessions", "Outra sessão foi iniciada; os controles da máquina permanecem ativos.");
            }
            state.Suspend(sessionId, sid);
            ControlAudit.TryWrite(audit, "desktop-supervision-suspended-policy-restored", sid);
            return new("desktop_suspended", "O CEP Horas pode ser fechado e os controles do Windows foram restaurados.");
        }
    }

    internal ControlResponse Resume(uint sessionId, string sid)
    {
        lock (gate)
        {
            if (!state.MayResume(sessionId, sid))
                return new("access_denied", "A supervisão desta sessão exige revisão da TI.");
            if (maintenance?.Invoke() == true)
                return new("update_maintenance", "Aguarde o término da atualização.");
            applyPolicy();
            if (state.Resume(sessionId, sid))
                ControlAudit.TryWrite(audit, "desktop-supervision-resumed-policy-applied", sid);
            return new("desktop_resumed", "A supervisão e as políticas do CEP Horas estão ativas.");
        }
    }

    internal void ProtectAfterSessionEnd(uint sessionId)
    {
        lock (gate)
        {
            if (maintenance?.Invoke() != true) applyPolicy();
            if (state.ResumeSession(sessionId))
                ControlAudit.TryWrite(audit, "desktop-supervision-resumed-after-session-end", "session:" + sessionId);
        }
    }

    internal void ProtectAtServiceStart()
    {
        lock (gate)
        {
            if (maintenance?.Invoke() == true) return;
            applyPolicy();
            ControlAudit.TryWrite(audit, "desktop-policy-applied-at-service-start", "SYSTEM");
        }
    }

    internal void ProtectAfterSessionArrival(uint sessionId)
    {
        lock (gate)
        {
            if (maintenance?.Invoke() == true) return;
            // A restoration previously allowed for one interactive session must
            // not leave machine-wide controls released for a new console/RDP user.
            // The original session's permission to keep its host closed survives.
            applyPolicy();
            ControlAudit.TryWrite(audit, "desktop-policy-applied-after-session-arrival", "session:" + sessionId);
        }
    }

    private bool IsOnlyActiveSession(uint sessionId)
    {
        var sessions = activeSessions?.Invoke() ?? [sessionId];
        return sessions.Count == 1 && sessions[0] == sessionId;
    }
}
