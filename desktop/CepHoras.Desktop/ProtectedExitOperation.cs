using CepHoras.Control.Protocol;

namespace CepHoras.Desktop;

internal static class ProtectedExitOperation
{
    internal static async Task<ControlResponse> Run(
        Func<ControlRequest, Task<ControlResponse>> send, Func<Task> finish, Action protectionUnconfirmed, Func<bool> remainsOpen)
    {
        try
        {
            var response = await send(new("desktop-suspend"));
            if (response.Code != "desktop_suspended")
            {
                await Resume(send, protectionUnconfirmed);
                return response;
            }
            await finish();
            return response;
        }
        catch
        {
            // No replay of suspend and no inference of completion after a lost
            // reply. This host remains open and explicitly requests protection.
            if (remainsOpen()) await Resume(send, protectionUnconfirmed);
            throw;
        }
    }

    private static async Task Resume(Func<ControlRequest, Task<ControlResponse>> send, Action protectionUnconfirmed)
    {
        try
        {
            if ((await send(new("desktop-resume"))).Code == "desktop_resumed") return;
        }
        catch { }
        protectionUnconfirmed();
    }
}
