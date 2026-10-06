namespace CepHoras.Control;

// Cancellation and reservation of the native effect share one boundary. A cancelled
// timer cannot run its callback; an already reserved effect cannot claim cancellation.
internal sealed class DelayedPowerAction(Action execute, Action<Exception> report,
    Func<TimeSpan, CancellationToken, Task>? delay = null) : IDisposable
{
    private readonly object gate = new();
    private readonly Func<TimeSpan, CancellationToken, Task> wait = delay ?? Task.Delay;
    private Attempt? current;
    private bool disposed;

    private sealed class Attempt
    {
        internal readonly CancellationTokenSource Stop = new();
        internal bool Cancelled, Dispatched, Completed;
    }

    internal Task Schedule(TimeSpan duration)
    {
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (current?.Completed == true) current = null;
            if (!CancelLocked()) throw new InvalidOperationException("A ação anterior já iniciou.");
            var attempt = new Attempt();
            current = attempt;
            return Task.Run(() => Run(attempt, duration));
        }
    }

    private async Task Run(Attempt attempt, TimeSpan duration)
    {
        try
        {
            await wait(duration, attempt.Stop.Token);
            lock (gate)
            {
                if (attempt.Cancelled || disposed) return;
                attempt.Dispatched = true;
            }
            execute();
        }
        catch (OperationCanceledException) when (attempt.Stop.IsCancellationRequested) { }
        catch (Exception error) { ControlAudit.TryWrite((_, _) => report(error), "delayed-power-failed", "SYSTEM"); }
        finally
        {
            lock (gate)
            {
                attempt.Completed = true;
                attempt.Stop.Dispose();
            }
        }
    }

    internal bool Cancel()
    {
        lock (gate) return CancelLocked();
    }

    private bool CancelLocked()
    {
        if (current is null) return true;
        if (current.Dispatched) return false;
        current.Cancelled = true;
        if (!current.Completed) current.Stop.Cancel();
        current = null;
        return true;
    }

    public void Dispose()
    {
        lock (gate)
        {
            disposed = true;
            CancelLocked();
        }
    }
}
