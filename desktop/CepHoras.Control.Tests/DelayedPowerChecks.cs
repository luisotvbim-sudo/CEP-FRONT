using CepHoras.Control;

internal static class DelayedPowerChecks
{
    internal static async Task Run()
    {
        var calls = 0;
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        // A delay that ignores cancellation reproduces the boundary after Task.Delay
        // completed, before the old executor reached its native call.
        using (var action = new DelayedPowerAction(() => calls++, _ => { }, (_, _) => release.Task))
        {
            var task = action.Schedule(TimeSpan.FromSeconds(10));
            Check(action.Cancel(), "pending cancellation confirmed");
            release.SetResult();
            await task.WaitAsync(TimeSpan.FromSeconds(5));
            Check(calls == 0, "cancelled completed delay cannot dispatch");
        }

        using var entered = new ManualResetEventSlim();
        using var finish = new ManualResetEventSlim();
        using (var action = new DelayedPowerAction(() =>
        {
            entered.Set();
            if (!finish.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException("fixture stalled");
            calls++;
        }, error => throw new InvalidOperationException("unexpected fixture error", error), (_, _) => Task.CompletedTask))
        {
            var task = action.Schedule(TimeSpan.Zero);
            try
            {
                Check(entered.Wait(TimeSpan.FromSeconds(5)), "effect reserved");
                Check(!action.Cancel(), "in-flight effect never claims cancellation");
                try { _ = action.Schedule(TimeSpan.Zero); throw new Exception("concurrent effect allowed"); }
                catch (InvalidOperationException) { }
            }
            finally { finish.Set(); }
            await task.WaitAsync(TimeSpan.FromSeconds(5));
            Check(calls == 1 && !action.Cancel(), "returned effect cannot fabricate cancellation");
            await action.Schedule(TimeSpan.Zero).WaitAsync(TimeSpan.FromSeconds(5));
            Check(calls == 2, "new independent action works after resume");
        }

        var reported = 0;
        using (var action = new DelayedPowerAction(() => throw new IOException("fixture native failure"),
            _ => reported++, (_, _) => Task.CompletedTask))
        {
            await action.Schedule(TimeSpan.Zero).WaitAsync(TimeSpan.FromSeconds(5));
            Check(reported == 1 && !action.Cancel(), "native failure is reported without false cancellation");
        }
        release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var disposedAction = new DelayedPowerAction(() => calls++, _ => { }, (_, _) => release.Task);
        var disposedTask = disposedAction.Schedule(TimeSpan.Zero);
        disposedAction.Dispose();
        release.SetResult();
        await disposedTask.WaitAsync(TimeSpan.FromSeconds(5));
        Check(calls == 2, "disposal suppresses delayed effect");
        Console.WriteLine("PASS: delayed hibernation cancellation, dispatch, resume, failure and disposal boundaries; callbacks are fixtures only.");
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
