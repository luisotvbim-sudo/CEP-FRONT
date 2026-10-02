using CepHoras.Control.Protocol;

namespace CepHoras.Control;

internal sealed class DesktopLifecycleController(
    DesktopSupervisionState state,
    Action restorePolicy,
    Action applyPolicy,
    Action<string, string> audit,
    Func<bool>? maintenance = null)
{
    internal ControlResponse Suspend(uint sessionId, string sid)
    {
        if (maintenance?.Invoke() == true)
            return new("update_maintenance", "A atualização está em andamento; os controles de energia permanecem ativos.");
        restorePolicy();
        state.Suspend(sessionId, sid);
        audit("desktop-supervision-suspended-policy-restored", sid);
        return new("desktop_suspended", "O CEP Horas pode ser fechado e os controles do Windows foram restaurados.");
    }

    internal ControlResponse Resume(uint sessionId, string sid)
    {
        if (maintenance?.Invoke() == true)
            return new("update_maintenance", "Aguarde o término da atualização.");
        applyPolicy();
        if (state.Resume(sessionId, sid))
            audit("desktop-supervision-resumed-policy-applied", sid);
        return new("desktop_resumed", "A supervisão e as políticas do CEP Horas estão ativas.");
    }

    internal void ProtectAfterSessionEnd(uint sessionId)
    {
        applyPolicy();
        if (state.ResumeSession(sessionId))
            audit("desktop-supervision-resumed-after-session-end", "session:" + sessionId);
    }

    internal void ProtectAtServiceStart()
    {
        applyPolicy();
        audit("desktop-policy-applied-at-service-start", "SYSTEM");
    }
}
