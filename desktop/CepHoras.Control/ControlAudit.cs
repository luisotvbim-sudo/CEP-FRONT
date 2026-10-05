using System.Diagnostics;

namespace CepHoras.Control;

internal static class ControlAudit
{
    internal static void TryWrite(Action<string, string> write, string code, string sid)
    {
        try { write(code, sid); }
        catch (Exception)
        {
            // An audit sink failure cannot turn an already performed system action
            // into a failed response, lose its cancellation id, or abort recovery.
            try { Trace.TraceError("CEP Horas: local audit sink unavailable."); }
            catch (Exception) { }
        }
    }
}
