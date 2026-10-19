using CepHoras.Control;
using CepHoras.Control.Protocol;

internal static class ControlExchangeChecks
{
    internal static async Task Run()
    {
        using var stream = new MemoryStream();
        await ControlWire.Write(stream, new ControlRequest("desktop-suspend"), default);
        var responseOffset = stream.Position;
        stream.Position = 0;
        var state = new DesktopSupervisionState();
        var lifecycle = new DesktopLifecycleController(state, () => Thread.Sleep(5200), () => { }, (_, _) => { });
        await ControlExchange.Run(stream, _ => lifecycle.Suspend(1, "fixture-owner"), default);
        stream.Position = responseOffset;
        var response = await ControlWire.Read<ControlResponse>(stream, default);
        if (response.Code != "desktop_suspended" || state.AllowsLaunch(1))
            throw new Exception("Slow restoration must deliver the suspension acknowledgement.");
        var applications = 0;
        lifecycle = new(state, () => { }, () => applications++, (_, _) => { });
        var denied = lifecycle.Resume(1, "different-owner");
        if (denied.Code != "access_denied" || applications != 0 || state.AllowsLaunch(1))
            throw new Exception("A reused session must not acknowledge another SID's suspended supervision.");
        if (lifecycle.Resume(1, "fixture-owner").Code != "desktop_resumed" || !state.AllowsLaunch(1))
            throw new Exception("Owner resume must restore supervision.");
        if (lifecycle.Resume(1, "different-owner").Code != "desktop_resumed" || !state.AllowsLaunch(1))
            throw new Exception("No suspension must remain idempotently resumable.");
        state.Suspend(1, "fixture-owner");
        var failedResume = new DesktopLifecycleController(state, () => { }, () => throw new IOException("fixture"), (_, _) => { });
        try { failedResume.Resume(1, "fixture-owner"); throw new Exception("Failed policy application acknowledged."); }
        catch (IOException) { }
        if (state.AllowsLaunch(1)) throw new Exception("Apply failure removed suspension.");

        using var lostReply = new FailedReplyStream();
        await ControlWire.Write(lostReply, new ControlRequest("desktop-suspend"), default);
        lostReply.Position = 0;
        lostReply.FailWrites = true;
        try { await ControlExchange.Run(lostReply, _ => lifecycle.Suspend(1, "fixture-owner"), default); throw new Exception("Expected lost reply."); }
        catch (IOException) { }
        if (state.AllowsLaunch(1)) throw new Exception("Reply loss must not roll back the completed suspension.");
        if (lifecycle.Resume(1, "fixture-owner").Code != "desktop_resumed" || !state.AllowsLaunch(1))
            throw new Exception("Explicit resume after a lost reply must restore supervision.");

        using var malformed = new MemoryStream(new byte[] { 0, 0, 0, 0 });
        var handled = false;
        try { await ControlExchange.Run(malformed, _ => { handled = true; return new("fixture", "fixture"); }, default); throw new Exception("Malformed request accepted."); }
        catch (InvalidDataException) { }
        if (handled) throw new Exception("Malformed request invoked an effect.");
        using var blocked = new BlockedReadStream();
        handled = false;
        try { await ControlExchange.Run(blocked, _ => { handled = true; return new("fixture", "fixture"); }, default); throw new Exception("Read deadline ignored."); }
        catch (OperationCanceledException) { }
        if (handled) throw new Exception("Expired read invoked an effect.");
        using var stopping = new CancellationTokenSource();
        using var stoppedReply = new MemoryStream();
        await ControlWire.Write(stoppedReply, new ControlRequest("desktop-suspend"), default);
        var stopOffset = stoppedReply.Position;
        stoppedReply.Position = 0;
        try
        {
            await ControlExchange.Run(stoppedReply, _ => { var result = lifecycle.Suspend(1, "fixture-owner"); stopping.Cancel(); return result; }, stopping.Token);
            throw new Exception("Stopped service wrote a reply.");
        }
        catch (OperationCanceledException) { }
        if (stoppedReply.Length != stopOffset || state.AllowsLaunch(1)) throw new Exception("Stop must cancel writing without inferring rollback.");
        Console.WriteLine("PASS: slow lifecycle reply, lost reply and explicit reconciliation, ownership/idempotency, apply failure and malformed IPC; fake policies only.");
    }

    private sealed class FailedReplyStream : MemoryStream
    {
        internal bool FailWrites;
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken token = default) =>
            FailWrites ? ValueTask.FromException(new IOException("fixture reply lost")) : base.WriteAsync(buffer, token);
    }

    private sealed class BlockedReadStream : MemoryStream
    {
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken token = default)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return 0;
        }
    }
}
