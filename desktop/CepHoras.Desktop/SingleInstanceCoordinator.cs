namespace CepHoras.Desktop;

public sealed class SingleInstanceCoordinator : IDisposable
{
    private readonly string activationEventName;
    private readonly Mutex mutex;
    private readonly EventWaitHandle? activationEvent;
    private readonly CancellationTokenSource lifetime = new();
    private Task? listener;
    private bool disposed;

    public SingleInstanceCoordinator(string applicationName)
    {
        if (string.IsNullOrWhiteSpace(applicationName))
            throw new ArgumentException("Application name is required.", nameof(applicationName));

        var safeName = applicationName.Trim();
        activationEventName = $@"Local\{safeName}.Activate";
        mutex = new Mutex(initiallyOwned: true, $@"Local\{safeName}.Mutex", out var createdNew);
        IsPrimary = createdNew;
        if (IsPrimary)
            activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, activationEventName);
    }

    public bool IsPrimary { get; }

    public void StartListening(Action activate)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        ArgumentNullException.ThrowIfNull(activate);
        if (!IsPrimary || activationEvent is null)
            throw new InvalidOperationException("Only the primary instance can listen for activation.");
        if (listener is not null)
            throw new InvalidOperationException("The activation listener is already running.");

        listener = Task.Run(() =>
        {
            var handles = new WaitHandle[] { activationEvent, lifetime.Token.WaitHandle };
            while (WaitHandle.WaitAny(handles) == 0)
            {
                if (lifetime.IsCancellationRequested) return;
                activate();
            }
        });
    }

    public bool SignalPrimary(TimeSpan timeout)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        if (IsPrimary) return false;

        var deadline = DateTime.UtcNow + timeout;
        do
        {
            try
            {
                using var existing = EventWaitHandle.OpenExisting(activationEventName);
                return existing.Set();
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                if (DateTime.UtcNow >= deadline) return false;
                Thread.Sleep(50);
            }
        } while (true);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        lifetime.Cancel();
        activationEvent?.Set();
        try { listener?.Wait(TimeSpan.FromSeconds(1)); }
        catch (AggregateException exception) when (exception.InnerExceptions.All(item => item is OperationCanceledException)) { }
        activationEvent?.Dispose();
        lifetime.Dispose();
        if (IsPrimary)
        {
            try { mutex.ReleaseMutex(); }
            catch (ApplicationException) { }
        }
        mutex.Dispose();
    }
}
