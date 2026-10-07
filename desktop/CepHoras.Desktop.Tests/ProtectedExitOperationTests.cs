using CepHoras.Control.Protocol;
using CepHoras.Desktop;

internal static class ProtectedExitOperationTests
{
    internal static async Task Run(Action<bool, string> check)
    {
        foreach (var failure in new[] { "reply-lost", "post-ack", "resume-rejected", "resume-lost", "closed-disposal", "none", "refused" })
        {
            var operations = new List<string>();
            var warnings = 0;
            var finished = false;
            var open = true;
            async Task<ControlResponse> Send(ControlRequest request)
            {
                operations.Add(request.Operation);
                await Task.Yield();
                if (request.Operation == "desktop-suspend")
                {
                    if (failure is "reply-lost" or "resume-rejected" or "resume-lost") throw new IOException("fixture");
                    return new(failure == "refused" ? "multiple_sessions" : "desktop_suspended", "fixture");
                }
                if (failure == "resume-lost") throw new IOException("fixture");
                return new(failure == "resume-rejected" ? "access_denied" : "desktop_resumed", "fixture");
            }
            try
            {
                await ProtectedExitOperation.Run(Send, () =>
                {
                    if (failure == "post-ack") throw new IOException("fixture callback");
                    if (failure == "closed-disposal") { open = false; throw new IOException("fixture disposal after Closed"); }
                    finished = true;
                    return Task.CompletedTask;
                }, () => warnings++, () => open);
                check(failure is "none" or "refused", "Failure must remain visible to the host");
            }
            catch (IOException) { check(failure is not ("none" or "refused"), "Successful exit unexpectedly failed"); }
            check(finished == (failure == "none"), "A lost reply/refusal/post-ack error must not finish exit");
            check(operations.SequenceEqual(failure is "none" or "closed-disposal" ? new[] { "desktop-suspend" } : new[] { "desktop-suspend", "desktop-resume" }),
                "Suspend must not repeat; every failed attempt explicitly resumes");
            check(warnings == (failure is "resume-rejected" or "resume-lost" ? 1 : 0), "Unconfirmed protection must warn, never claim success");
        }
    }
}
