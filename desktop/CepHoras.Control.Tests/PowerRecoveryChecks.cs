using CepHoras.Control;
using CepHoras.Control.Protocol;

internal static class PowerRecoveryChecks
{
    private const string Owner = "S-1-5-21-100-200-300-1001";
    private const string Other = "S-1-5-21-100-200-300-1002";
    private static int assertions;
    private static void Check(bool value, string message)
    { if (!value) throw new InvalidOperationException(message); assertions++; }
    private static void Throws<T>(Action action) where T : Exception
    { try { action(); } catch (T) { assertions++; return; } throw new InvalidOperationException("Expected " + typeof(T).Name); }

    internal static void Run()
    {
        var now = DateTimeOffset.Parse("2026-10-05T16:00:00Z");
        var config = new ControlConfiguration(2, true, "active", new(new(), []));
        var store = new FaultStore();
        var power = new FakePower();
        PowerAuthority Create() => new(() => config, () => true, power, (_, _) => { }, () => now, store: store);
        var first = Create();
        var origin = first.Handle(new("status"), Owner).BrokerInstanceId!;
        var id = Guid.NewGuid().ToString();
        power.BeforeSchedule = () => Check(store.Read()!.Pending is { Phase: "preparing", ExecuteAt: null, OwnerSid: Owner }, "durable intention precedes executor");
        var result = first.Handle(new("schedule", id, "restart", 10, BrokerInstanceId: origin), Owner);
        Check(result.Code == "scheduled" && store.Read()!.Pending!.Phase == "scheduled", "completion is persisted after effect");
        var writes = store.Writes;
        var restarted = Create();
        restarted.Initialize();
        Check(store.Writes == writes && power.Scheduled == 1 && power.Cancelled == 0, "restart only reads and never replays/cancels");
        var recovered = restarted.Handle(new("status"), Owner);
        Check(recovered is { Code: "power_uncertain", RequestId: var recoveredId, OriginalBrokerInstanceId: var previous } && recoveredId == id && previous == origin,
            "new host can discover only its inherited identity and origin");
        Check(restarted.Handle(new("status"), Other) is { Code: "power_uncertain", RequestId: null, Action: null, OriginalBrokerInstanceId: null }, "foreign owner sees no private metadata");
        Check(restarted.Handle(new("schedule", Guid.NewGuid().ToString(), "shutdown", 10), Other).Code == "power_uncertain" && power.Scheduled == 1, "inherited action blocks all new dispatch");
        Throws<InvalidOperationException>(restarted.CancelForMaintenance);
        Check(power.Cancelled == 0, "maintenance never cancels inherited action implicitly");
        now = now.AddMinutes(1);
        Check(restarted.Handle(new("power-status", id, BrokerInstanceId: origin), Owner).Code == "power_uncertain", "expired inherited deadline is not proof of absence");
        Check(restarted.Handle(new("cancel", id, BrokerInstanceId: Guid.NewGuid().ToString()), Owner).Code == "broker_changed", "wrong origin cannot cancel");
        Check(restarted.Handle(new("cancel", id, BrokerInstanceId: recovered.BrokerInstanceId), Owner).Code == "power_uncertain", "current epoch is not inherited origin proof");
        Check(restarted.Handle(new("cancel", id, BrokerInstanceId: origin), Other).Code == "broker_changed" && power.Cancelled == 0, "owner identity checked before effects");
        power.CancelFails = true;
        Throws<IOException>(() => restarted.Handle(new("cancel", id, BrokerInstanceId: origin), Owner));
        Check(store.Read()!.Pending?.RequestId == id, "failed cancellation preserves durable intent");
        power.CancelFails = false;
        var cancelled = restarted.Handle(new("cancel", id, BrokerInstanceId: origin), Owner);
        Check(cancelled.Cancelled && cancelled.OriginalBrokerInstanceId == origin && cancelled.BrokerInstanceId != origin && store.Read()!.Pending is null,
            "explicit cancellation proves origin and persists terminal state");
        Check(restarted.Handle(new("schedule", id, "restart", 10), Owner).Code == "cancelled" && power.Scheduled == 1, "completed ID never replays");
        var third = Create();
        Check(third.Handle(new("cancel", id, BrokerInstanceId: origin), Owner) is { Code: "cancelled", Cancelled: true, OriginalBrokerInstanceId: var cancelledOrigin } && cancelledOrigin == origin,
            "proof of cancellation survives another restart");

        // Crash between preparation and effect is deliberately uncertain, not replayable.
        store = new FaultStore(); power = new FakePower();
        store.Save(new(new(id, "shutdown", Owner, null, "preparing", origin), new()));
        var prepared = Create();
        prepared.Initialize();
        Check(power.Scheduled == 0 && power.Cancelled == 0, "preparing phase cannot produce a startup effect");
        Check(prepared.Handle(new("schedule", Guid.NewGuid().ToString(), "shutdown", 10), Owner).Code == "power_uncertain", "preparing recovery blocks a new request");
        Check(prepared.Handle(new("cancel", id, BrokerInstanceId: origin), Owner).Cancelled && power.Cancelled == 1, "only explicit matching cancellation reconciles preparing phase");

        // Failed durable preparation has no OS effect; time starts after the flush.
        store = new FaultStore { FailSave = _ => true }; power = new FakePower();
        var blocked = Create(); id = Guid.NewGuid().ToString();
        Check(blocked.Handle(new("schedule", id, "shutdown", 10), Owner).Code == "power_storage_unavailable" && power.Scheduled == 0, "disk failure before effect prevents dispatch");
        store.FailSave = _ => false;
        store.AfterSave = journal => { if (journal.Pending?.Phase == "preparing") now = now.AddMinutes(1); };
        result = blocked.Handle(new("schedule", id, "shutdown", 10), Owner);
        Check(result.ExecuteAt == now.AddSeconds(10) && power.Scheduled == 1, "slow preparation cannot shorten the ten-second countdown");

        // Disk failure after a real effect must preserve its visible success and block further effects.
        store = new FaultStore { FailSave = count => count >= 2 }; power = new FakePower();
        var afterEffect = Create(); id = Guid.NewGuid().ToString();
        result = afterEffect.Handle(new("schedule", id, "restart", 10), Owner);
        Check(result.Code == "scheduled" && power.Scheduled == 1 && store.Read()!.Pending?.Phase == "preparing", "post-effect disk failure cannot hide scheduling");
        Check(afterEffect.Handle(new("schedule", Guid.NewGuid().ToString(), "shutdown", 10), Owner).Code == "power_storage_unavailable" && power.Scheduled == 1, "dirty completion blocks a second effect");
        Throws<IOException>(afterEffect.CancelForMaintenance);
        Check(power.Cancelled == 0, "maintenance does not continue with unwritable state");
        var afterCrash = Create();
        Check(afterCrash.Handle(new("status"), Owner).Code == "power_uncertain" && power.Scheduled == 1, "post-effect crash recovers durable preparation without replay");
        store.FailSave = _ => false;
        var savedOrigin = store.Read()!.Pending!.BrokerInstanceId;
        Check(afterCrash.Handle(new("cancel", id, BrokerInstanceId: savedOrigin), Owner).Cancelled, "post-effect crash can be cancelled by its owner");

        // Executor exceptions can follow an effect, so retaining the intention is mandatory.
        store = new FaultStore(); power = new FakePower { ScheduleFailsAfterEffect = true };
        var uncertain = Create(); id = Guid.NewGuid().ToString();
        Throws<IOException>(() => uncertain.Handle(new("schedule", id, "restart", 10), Owner));
        Check(uncertain.Handle(new("status"), Owner).Code == "power_uncertain", "throwing executor remains uncertain");
        Check(uncertain.Handle(new("schedule", id, "restart", 10), Owner).Code == "power_uncertain" && power.Scheduled == 1, "ambiguous execution never retries schedule");
        Check(uncertain.Handle(new("cancel", id), Owner).Cancelled, "explicit cancel reconciles ambiguous executor result");

        // A failed completion write must not undo a confirmed cancellation.
        store = new FaultStore(); power = new FakePower();
        var cancelDisk = Create(); id = Guid.NewGuid().ToString();
        cancelDisk.Handle(new("schedule", id, "restart", 10), Owner);
        store.FailSave = _ => true;
        Check(cancelDisk.Handle(new("cancel", id), Owner).Cancelled && power.Cancelled == 1, "OS cancellation remains successful after completion write failure");
        Check(cancelDisk.Handle(new("schedule", Guid.NewGuid().ToString(), "shutdown", 10), Owner).Code == "power_storage_unavailable", "unpersisted cancellation gates new effects");
        var cancelRestart = Create();
        Check(cancelRestart.Handle(new("status"), Owner).Code == "power_uncertain", "restart conservatively recovers the older durable intention");
        store.FailSave = _ => false;
        savedOrigin = store.Read()!.Pending!.BrokerInstanceId;
        Check(cancelRestart.Handle(new("cancel", id, BrokerInstanceId: savedOrigin), Owner).Cancelled, "absence/cancel retry reconciles older durable state");

        store = new FaultStore { FailSave = _ => true }; power = new FakePower();
        var preCancel = Create(); id = Guid.NewGuid().ToString();
        Check(preCancel.Handle(new("cancel", id), Owner) is { Code: "power_storage_unavailable", Cancelled: false }, "pre-dispatch cancellation is not confirmed before durable tombstone");
        Check(preCancel.Handle(new("schedule", id, "shutdown", 10), Owner).Code == "power_storage_unavailable" && power.Scheduled == 0, "late dispatch cannot pass unwritten cancellation");
        store.FailSave = _ => false;
        Check(preCancel.Handle(new("schedule", id, "shutdown", 10), Owner).Code == "cancelled" && power.Scheduled == 0, "persisted tombstone defeats late dispatch");

        store = new FaultStore { InvalidRead = true }; power = new FakePower();
        Throws<InvalidDataException>(() => Create().Initialize());
        Check(power.Scheduled == 0 && power.Cancelled == 0, "invalid journal prevents readiness without OS calls");
        Console.WriteLine($"PASS: {assertions} durable power recovery checks; executors are fake, no Windows power/policy/service operation performed.");
    }

    private sealed class FaultStore : IPowerRequestStore
    {
        private readonly MemoryPowerRequestStore memory = new();
        internal int Writes;
        internal Func<int, bool> FailSave = _ => false;
        internal Action<PowerRequestJournal>? AfterSave;
        internal bool InvalidRead;
        public PowerRequestJournal? Read() => InvalidRead ? new(null, new(), Schema: 99) : memory.Read();
        public void Save(PowerRequestJournal value)
        {
            Writes++;
            if (FailSave(Writes)) throw new IOException("fixture disk full");
            PowerRequestValidation.Validate(value);
            memory.Save(value);
            AfterSave?.Invoke(value);
        }
    }
    private sealed class FakePower : ISystemPower
    {
        internal int Scheduled, Cancelled;
        internal bool CancelFails, ScheduleFailsAfterEffect;
        internal Action? BeforeSchedule;
        public void Schedule(string action, int seconds)
        { BeforeSchedule?.Invoke(); Scheduled++; if (ScheduleFailsAfterEffect) throw new IOException("fixture lost response"); }
        public void Cancel(string action)
        { if (CancelFails) throw new IOException("fixture cancel unavailable"); Cancelled++; }
    }
}
