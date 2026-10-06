using System.Diagnostics;
using System.Text.Json;
using CepHoras.Control;
using CepHoras.Control.Protocol;
using CepHoras.Updates;

internal static class ServiceReliabilityChecks
{
    private static int assertions;
    internal static async Task Run()
    {
        var now = DateTimeOffset.Parse("2026-10-05T02:00:00Z");
        var snapshot = new PolicySnapshot(NativePolicy.Rights.ToDictionary(right => right, _ => new[] { "S-1-5-32-545" }),
            Enumerable.Repeat(new SavedRegistry(false, 0), PolicyStore.Settings.Length).ToArray());
        var config = new ControlConfiguration(2, true, "active", snapshot);
        var power = new FixturePower();
        var authority = new PowerAuthority(() => config, () => true, power,
            (_, _) => throw new IOException("fixture audit unavailable"), () => now);
        var id = Guid.NewGuid().ToString();
        Assert(authority.Handle(new("schedule", id, "shutdown", 10), "owner").Code == "scheduled", "audit failure cannot hide a scheduled action");
        Assert(authority.Handle(new("power-status", id), "owner") is { Code: "pending", RequestId: var statusId, Action: "shutdown" } && statusId == id,
            "status preserves owner/id/action/deadline");
        Assert(authority.Handle(new("power-status", id), "other") is { Code: "not_pending", Action: null }, "status does not expose another owner action");
        power.CancelFails = true;
        Throws<IOException>(() => authority.Handle(new("cancel", id), "owner"));
        Assert(authority.Handle(new("power-status", id), "owner").Code == "pending", "failed cancellation preserves pending state");
        power.CancelFails = false;
        Assert(authority.Handle(new("cancel", id.ToUpperInvariant()), "owner").Cancelled, "canonical request id cancels despite audit failure");
        Assert(authority.Handle(new("power-status", id), "owner").Code == "cancelled", "confirmed cancellation remains terminal");
        Assert(authority.Handle(new("schedule", id, "shutdown", 10), "owner").Code == "cancelled", "late dispatch cannot undo cancellation");
        var next = Guid.NewGuid().ToString();
        authority.Handle(new("schedule", next, "hibernate", 10), "owner");
        now = now.AddSeconds(10);
        Assert(authority.Handle(new("power-status", next), "owner").Code == "not_pending", "deadline reconciles pending on resume");
        Assert(authority.Handle(new("schedule", next, "hibernate", 10), "owner").Code == "not_pending" && power.Scheduled == 2,
            "expiry cannot repeat the same action id");
        Assert(authority.Handle(new("cancel", next), "owner") is { Code: "not_pending", Cancelled: false }, "past deadline never fabricates cancellation");
        var cancelledBeforeDispatch = Guid.NewGuid().ToString();
        authority.Handle(new("cancel", cancelledBeforeDispatch), "owner");
        await Task.WhenAll(Enumerable.Range(0, 300).Select(_ => Task.Run(() => authority.Handle(new("cancel", Guid.NewGuid().ToString()), "owner"))));
        Assert(authority.Handle(new("schedule", cancelledBeforeDispatch, "restart", 10), "owner").Code == "cancelled", "more than 256 cancellations do not clear tombstones");
        var maintenanceId = Guid.NewGuid().ToString();
        authority.Handle(new("schedule", maintenanceId, "restart", 10), "owner");
        authority.CancelForMaintenance();
        Assert(authority.Handle(new("power-status", maintenanceId), "owner").Code == "cancelled", "maintenance cancellation survives failed audit sink");

        await CheckScheduleCancelRace(config, now);
        CheckBrokerEpochAndJournal(config, now);
        CheckDurableFiles();
        CheckRestorationAndValidation(snapshot, config);
        await CheckLifecycleAndSupervision(now);
        CheckAdministrationAndMaintenance(now);
        CheckOwnershipAndSupport();
        Console.WriteLine($"PASS: {assertions} reliability assertions for audit faults, uncertain cancel, concurrent schedule/cancel, terminal power reconciliation, durable file faults, policy/journal validation, restore failures, per-session supervision/backoff, maintenance races, admin recovery ordering, update lease/quota/layout and process identity. No real policy, MSI or power action executed.");
    }

    private static async Task CheckScheduleCancelRace(ControlConfiguration config, DateTimeOffset now)
    {
        using var entered = new ManualResetEventSlim();
        using var continueSchedule = new ManualResetEventSlim();
        var power = new FixturePower { OnSchedule = () => { entered.Set(); Assert(continueSchedule.Wait(TimeSpan.FromSeconds(5)), "race fixture progresses"); } };
        var authority = new PowerAuthority(() => config, () => true, power, (_, _) => { }, () => now);
        var id = Guid.NewGuid().ToString();
        var schedule = Task.Run(() => authority.Handle(new("schedule", id, "restart", 10), "owner"));
        Assert(entered.Wait(TimeSpan.FromSeconds(5)), "schedule entered executor");
        var cancel = Task.Run(() => authority.Handle(new("cancel", id), "owner"));
        continueSchedule.Set();
        Assert((await schedule).Code == "scheduled" && (await cancel).Cancelled && power.Scheduled == 1 && power.Cancelled == 1,
            "cancel serializes with in-flight schedule and cancels its exact action");
        Assert(authority.Handle(new("schedule", id, "restart", 10), "owner").Code == "cancelled", "race completion remains terminal");
    }

    private static void CheckDurableFiles()
    {
        var directory = Path.Combine(Path.GetTempPath(), "CepHoras.DurableFixture." + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "state.json");
        try
        {
            DurableStateFile.Write(path, new { Value = 1 }, temporary =>
            {
                var file = new FileInfo(temporary);
                Assert(file.Length == 0, "security precedes private bytes");
                // Exercise the real ACL API on an owned disposable file while its
                // stream is open. It changes no protected product/system directory.
                file.SetAccessControl(file.GetAccessControl());
            });
            var previous = File.ReadAllBytes(path);
            var changed = false;
            Throws<IOException>(() => PolicyTransaction.Apply(
                () => DurableStateFile.Write(path, new { Value = 2 }, _ => { }, flush: _ => throw new IOException("fixture disk full")),
                () => changed = true, () => true, () => { }, () => { }, () => { }));
            Assert(!changed && File.ReadAllBytes(path).SequenceEqual(previous), "disk flush failure preserves original journal and prevents system mutation");
            Throws<IOException>(() => DurableStateFile.Write(path, new { Value = 3 }, _ => { }, (_, _) => throw new IOException("fixture rename denied")));
            Assert(File.ReadAllBytes(path).SequenceEqual(previous), "failed rename preserves original journal");
            Throws<UnauthorizedAccessException>(() => DurableStateFile.Write(path, new { Value = 4 }, _ => throw new UnauthorizedAccessException("fixture ACL")));
            Assert(File.ReadAllBytes(path).SequenceEqual(previous) && Directory.GetFiles(directory, "*.tmp").Length == 0,
                "ACL failure preserves original journal and removes only own temporary file");
            DurableStateFile.Write(path, new { Value = 5 }, _ => { });
            using var document = JsonDocument.Parse(File.ReadAllBytes(path));
            Assert(document.RootElement.GetProperty("Value").GetInt32() == 5, "write-through replacement remains readable");
        }
        finally
        {
            var target = Path.GetFullPath(directory);
            Assert(target.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) &&
                Path.GetFileName(target).StartsWith("CepHoras.DurableFixture.", StringComparison.Ordinal), "fixture cleanup is inside explicitly created temp directory");
            Directory.Delete(target, true);
        }
    }

    private static void CheckBrokerEpochAndJournal(ControlConfiguration config, DateTimeOffset now)
    {
        var power = new FixturePower();
        var first = new PowerAuthority(() => config, () => true, power, (_, _) => { }, () => now);
        var epoch = first.Handle(new("status"), "owner").BrokerInstanceId;
        Assert(Guid.TryParse(epoch, out _), "ready reports an instance id before authorization");
        var inactive = new PowerAuthority(() => null, () => false, power, (_, _) => { }, () => now);
        Assert(inactive.Handle(new("status"), "owner") is { Active: false, BrokerInstanceId: not null }, "inactive service still reports its instance id");
        var id = Guid.NewGuid().ToString();
        Assert(first.Handle(new("schedule", id, "shutdown", 10, BrokerInstanceId: Guid.NewGuid().ToString()), "owner").Code == "broker_changed" && power.Scheduled == 0,
            "foreign epoch cannot schedule any effect");
        Assert(first.Handle(new("cancel", id, BrokerInstanceId: Guid.NewGuid().ToString()), "owner").Code == "broker_changed",
            "foreign epoch cannot create a cancellation tombstone");
        Assert(first.Handle(new("schedule", id, "restart", 10, BrokerInstanceId: epoch), "owner").Code == "scheduled" && power.Scheduled == 1,
            "valid epoch remains schedulable after refused foreign cancel");
        var restarted = new PowerAuthority(() => config, () => true, power, (_, _) => { }, () => now);
        Assert(restarted.Handle(new("cancel", id, BrokerInstanceId: epoch), "owner") is { Code: "broker_changed", Cancelled: false, OriginalBrokerInstanceId: null },
            "a new instance cannot fabricate an old broker cancellation");
        Assert(restarted.Handle(new("power-status", id, BrokerInstanceId: epoch), "owner") is { Code: "broker_changed", Cancelled: false },
            "a new instance cannot use absent memory to declare old request terminal");
        Assert(power.Cancelled == 0 && first.Handle(new("power-status", id, BrokerInstanceId: epoch), "owner").Code == "pending",
            "foreign epoch checks preserve the original pending action");

        var origin = Guid.NewGuid().ToString();
        var journal = new PowerRequestJournal(new(id, "restart", "S-1-5-32-545", now.AddSeconds(10), "scheduled", origin),
            new(StringComparer.Ordinal) { [Guid.NewGuid().ToString()] = new(true, now.AddMinutes(15), origin) });
        PowerRequestValidation.Validate(journal);
        var memory = new MemoryPowerRequestStore();
        memory.Save(journal);
        journal.Terminal.Clear();
        Assert(memory.Read()!.Terminal.Count == 1, "store isolates saved state from mutable caller dictionaries");
        var saved = memory.Read()!;
        saved.Terminal.Clear();
        Assert(memory.Read()!.Terminal.Count == 1, "read snapshots cannot alter persisted tombstones");
        var recovered = memory.Read()!;
        var encoded = JsonSerializer.SerializeToUtf8Bytes(recovered);
        var decoded = JsonSerializer.Deserialize<PowerRequestJournal>(encoded)!;
        PowerRequestValidation.Validate(decoded);
        Assert(decoded.Pending is { RequestId: var request, BrokerInstanceId: var broker, Phase: "scheduled" } && request == id && broker == origin,
            "journal roundtrip preserves intent, owner and origin proof");
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Schema = 2 }));
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Pending = recovered.Pending! with { OwnerSid = "owner" } }));
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Pending = recovered.Pending! with { Phase = "preparing" } }));
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Pending = recovered.Pending! with { ExecuteAt = null } }));
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Pending = recovered.Pending! with { BrokerInstanceId = "invalid" } }));
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Pending = recovered.Pending! with { Action = "other" } }));
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Terminal = new(StringComparer.Ordinal) { [id] = new(true, now.AddMinutes(15), origin) } }));
        Throws<InvalidDataException>(() => PowerRequestValidation.Validate(recovered with { Terminal = new(StringComparer.Ordinal) { ["not-a-guid"] = new(true, now.AddMinutes(15), origin) } }));
    }

    private static void CheckRestorationAndValidation(PolicySnapshot snapshot, ControlConfiguration config)
    {
        PolicyValidation.Configuration(config);
        PolicyValidation.Journal(new(config, snapshot));
        Throws<InvalidDataException>(() => PolicyValidation.Configuration(config with { Original = null! }));
        Throws<InvalidDataException>(() => PolicyValidation.Configuration(config with { Phase = "restored" }));
        Throws<InvalidDataException>(() => PolicyValidation.Configuration(config with { Original = snapshot with { Registry = [] } }));
        var badRights = snapshot.Rights.ToDictionary(entry => entry.Key, entry => entry.Value);
        badRights[NativePolicy.Rights[0]] = ["not-a-sid"];
        Throws<InvalidDataException>(() => PolicyValidation.Snapshot(snapshot with { Rights = badRights }, PolicyStore.Settings.Length));
        Throws<InvalidDataException>(() => PolicyValidation.Journal(new(config, snapshot, Schema: 99)));
        Throws<InvalidDataException>(() => PolicyValidation.Journal(new(config, snapshot with { Registry = null! })));
        foreach (var failure in new[] { "backup", "restore", "verify", "commit", "none" })
        {
            var backup = false;
            var mutated = false;
            var committed = false;
            try
            {
                PolicyTransaction.Restore(
                    () => { if (failure == "backup") throw new IOException(); backup = true; },
                    () => { Assert(backup, "uninstall journal precedes mutation"); mutated = true; if (failure == "restore") throw new IOException(); },
                    () => failure != "verify",
                    () => { if (failure == "commit") throw new IOException(); committed = true; });
                Assert(failure == "none" && committed, "verified restore commits only when all steps succeed");
            }
            catch (Exception) when (failure != "none")
            {
                Assert(!committed && (failure != "backup" || !mutated), "failed restore retains journal/configuration, failed backup never mutates");
            }
        }
    }

    private static async Task CheckLifecycleAndSupervision(DateTimeOffset now)
    {
        var restored = 0;
        var applied = 0;
        var state = new DesktopSupervisionState();
        var lifecycle = new DesktopLifecycleController(state, () => restored++, () => applied++, (_, _) => { }, activeSessions: () => [1, 2]);
        Assert(lifecycle.Suspend(1, "owner").Code == "multiple_sessions" && restored == 0, "multi-session close cannot release machine-wide policies");
        var maintenance = false;
        lifecycle = new(state, () => { restored++; maintenance = true; }, () => applied++, (_, _) => { }, () => maintenance);
        Assert(lifecycle.Suspend(1, "owner").Code == "update_maintenance" && applied == 1 && state.AllowsLaunch(1), "maintenance race reprotects before allowing close");
        lifecycle.ProtectAtServiceStart();
        lifecycle.ProtectAfterSessionEnd(1);
        lifecycle.ProtectAfterSessionArrival(2);
        Assert(applied == 1, "session/service callbacks do not mutate policies during maintenance");

        IReadOnlyList<uint> changingSessions = new uint[] { 1 };
        var arrivalState = new DesktopSupervisionState();
        var arrivalApplications = 0;
        var arrivalLifecycle = new DesktopLifecycleController(arrivalState,
            () => changingSessions = new uint[] { 1, 2 }, () => arrivalApplications++, (_, _) => { }, activeSessions: () => changingSessions);
        Assert(arrivalLifecycle.Suspend(1, "owner").Code == "multiple_sessions" && arrivalApplications == 1 && arrivalState.AllowsLaunch(1),
            "a session arriving during restore reapplies global policy before close acknowledgement");
        arrivalState.Suspend(1, "owner");
        arrivalLifecycle.ProtectAfterSessionArrival(2);
        Assert(arrivalApplications == 2 && !arrivalState.AllowsLaunch(1), "new session reapplies global policy without erasing another session close permission");
        var observations = 0;
        var inspectionFailure = new DesktopLifecycleController(new(), () => { }, () => arrivalApplications++, (_, _) => { },
            activeSessions: () => ++observations == 1 ? new uint[] { 1 } : throw new IOException("fixture WTS inspection failed"));
        Throws<IOException>(() => inspectionFailure.Suspend(1, "owner"));
        Assert(arrivalApplications == 3, "failed session reinspection cannot leave restored global policy released");

        using var arrivalEntered = new ManualResetEventSlim();
        using var arrivalRelease = new ManualResetEventSlim();
        arrivalApplications = 0;
        arrivalState = new();
        arrivalLifecycle = new(arrivalState, () => { arrivalEntered.Set(); Assert(arrivalRelease.Wait(TimeSpan.FromSeconds(5)), "arrival fixture progresses"); },
            () => arrivalApplications++, (_, _) => { });
        var closing = Task.Run(() => arrivalLifecycle.Suspend(1, "owner"));
        Assert(arrivalEntered.Wait(TimeSpan.FromSeconds(5)), "session restore entered before arrival callback");
        var arriving = Task.Run(() => arrivalLifecycle.ProtectAfterSessionArrival(2));
        Assert(arrivalApplications == 0, "arrival policy application waits for the restoration gate");
        arrivalRelease.Set();
        Assert((await closing).Code == "desktop_suspended", "authorized close finishes before queued arrival reapplication");
        await arriving;
        Assert(arrivalApplications == 1 && !arrivalState.AllowsLaunch(1), "arrival race ends protected while retaining original session permission");

        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        maintenance = false;
        lifecycle = new(state, () => { entered.Set(); Assert(release.Wait(TimeSpan.FromSeconds(5)), "lifecycle fixture progresses"); },
            () => applied++, (_, _) => throw new IOException("fixture audit"));
        var suspension = Task.Run(() => lifecycle.Suspend(1, "owner"));
        Assert(entered.Wait(TimeSpan.FromSeconds(5)), "restore entered before resume");
        var resume = Task.Run(() => lifecycle.Resume(1, "owner"));
        Assert(applied == 1, "concurrent resume cannot apply during restoration");
        release.Set();
        Assert((await suspension).Code == "desktop_suspended" && (await resume).Code == "desktop_resumed" && state.AllowsLaunch(1),
            "restore/resume serialize and audit failure cannot invalidate successful lifecycle");

        var sessions = new FixtureSessions { Active = [0, 1, 2, uint.MaxValue] };
        state.Suspend(1, "owner");
        var supervisor = new DesktopSupervisor(state, () => maintenance, sessions, () => now, (_, _) => { });
        supervisor.Tick();
        Assert(sessions.Launched.SequenceEqual([2u]) && !state.AllowsLaunch(1), "console/RDP enumeration preserves independent suspended session");
        supervisor.Tick();
        Assert(sessions.Launched.Count == 1, "supervisor respects initial retry delay");
        now = now.AddSeconds(5);
        supervisor.Tick();
        Assert(sessions.Launched.Count == 2, "supervisor retries at deadline");
        now = now.AddSeconds(5);
        supervisor.Tick();
        Assert(sessions.Launched.Count == 2, "repeated launch backs off");
        sessions.Running.Add(2);
        supervisor.Tick();
        sessions.Running.Clear();
        supervisor.Tick();
        Assert(sessions.Launched.Count == 3, "observed running host resets retry budget");
        var racing = new FixtureSessions { Active = [3, 4], OnLaunch = _ => maintenance = true };
        maintenance = false;
        new DesktopSupervisor(new(), () => maintenance, racing, () => now, (_, _) => { }).Tick();
        Assert(racing.Launched.SequenceEqual([3u]), "maintenance entered mid-tick prevents next session launch");
    }

    private static void CheckAdministrationAndMaintenance(DateTimeOffset now)
    {
        var order = new List<string>();
        var maintenance = false;
        new AdministrativeRecovery(() => maintenance, () => order.Add("stop"), () => order.Add("restore")).Restore();
        Assert(order.SequenceEqual(["stop", "restore"]), "TI restoration follows confirmed fixed service stop");
        order.Clear(); maintenance = true;
        Throws<InvalidOperationException>(() => new AdministrativeRecovery(() => maintenance, () => order.Add("stop"), () => order.Add("restore")).Restore());
        Assert(order.Count == 0, "administration cannot interrupt existing maintenance");
        maintenance = false;
        Throws<InvalidOperationException>(() => new AdministrativeRecovery(() => maintenance, () => { order.Add("stop"); maintenance = true; }, () => order.Add("restore")).Restore());
        Assert(order.SequenceEqual(["stop"]), "maintenance race preserves snapshot after service stop");
        var released = false;
        Throws<IOException>(() => UpdateLease.ReleaseAfterFailure(() => throw new IOException("fixture journal write"), () => released = true));
        Assert(released, "failed failure-marker persistence still releases update lease");
        var preserve = Guid.NewGuid();
        var attempts = Enumerable.Range(0, 5).Select(index => new StoredAttempt(index == 4 ? preserve : Guid.NewGuid(), now.AddDays(-index), 10)).ToArray();
        Assert(!AttemptRetention.ToRemove(attempts, preserve, now).Contains(preserve) && AttemptRetention.ToRemove(attempts, preserve, now).Length == 1,
            "retention preserves journal attempt even outside recent attempt limit");
        Assert(AttemptRetention.ToRemove([new(Guid.NewGuid(), now.AddDays(-15), 10)], null, now).Length == 1, "expired noncurrent artifacts can be reclaimed");
        Throws<IOException>(() => AttemptRetention.RequireSpace(AttemptRetention.MaximumBytes, 1, long.MaxValue));
        Throws<IOException>(() => AttemptRetention.RequireSpace(0, 100, 100));
        AttemptRetention.RequireSpace(0, 1024, 1_000_000_000);

        var release = new MsiRelease(new Version(0, 4, 9), new Uri("https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/installer-v0.4.9/CEP-Horas-Windows-win-x64.msi"),
            10, new string('A', 64), [1], [2]);
        var state = new UpdateState(1, Guid.NewGuid(), "0.4.8", "0.4.9", "ready", new("S-1-5-32-545", 1, 42, 100), now.AddMinutes(1), release);
        UpdateStateValidation.Validate(state);
        Throws<InvalidDataException>(() => UpdateStateValidation.Validate(state with { Owner = null! }));
        Throws<InvalidDataException>(() => UpdateStateValidation.Validate(state with { Release = null! }));
        Throws<InvalidDataException>(() => UpdateStateValidation.Validate(state with { InstalledVersion = "0.4.9" }));
        Throws<InvalidDataException>(() => UpdateStateValidation.Validate(state with { RunnerPid = 4 }));
        Throws<InvalidDataException>(() => UpdateStateValidation.Validate(state with { Release = release with { PackageUri = new("https://example.invalid/payload.msi") } }));
        Assert(!UpdateStore.IsVersion("256.0.0") && !UpdateStore.IsVersion("0.256.0") && !UpdateStore.IsVersion("0.0.65536"), "journal cannot exceed MSI version bounds");
    }

    private static void CheckOwnershipAndSupport()
    {
        Assert(WindowsSupport.IsSupported(true, 19045, "Client", "Professional") &&
            WindowsSupport.IsSupported(true, 19045, "Client", "Enterprise") &&
            WindowsSupport.IsSupported(true, 19045, "Client", "Education") &&
            WindowsSupport.IsSupported(true, 26100, "Client", "Professional") &&
            WindowsSupport.IsSupported(true, 26200, "Client", "Enterprise"), "supported Windows 10/11 preflight");
        Assert(!WindowsSupport.IsSupported(true, 19044, "Client", "Professional") &&
            !WindowsSupport.IsSupported(true, 22000, "Client", "Professional") &&
            !WindowsSupport.IsSupported(true, 26099, "Client", "Professional") &&
            !WindowsSupport.IsSupported(true, 19045, "Client", "Core") &&
            !WindowsSupport.IsSupported(true, 19045, "Server", "Enterprise") &&
            !WindowsSupport.IsSupported(false, 19045, "Client", "Professional") &&
            !WindowsSupport.IsSupported(true, 26100, "Client", "Core") && !WindowsSupport.IsSupported(true, 26100, "Server", "Enterprise") &&
            !WindowsSupport.IsSupported(false, 26100, "Client", "Professional"), "unsupported build/edition/server/architecture fails preflight");
        Assert(InstalledLayout.FromServiceImage("\"D:\\CEP Pilot\\control\\CepHoras.Control.exe\" --service") == "D:\\CEP Pilot",
            "service registration centralizes alternate installed path");
        Throws<InvalidDataException>(() => InstalledLayout.FromServiceImage("D:\\CEP Pilot\\control\\CepHoras.Control.exe --service"));
        Throws<InvalidDataException>(() => InstalledLayout.FromServiceImage("\"D:\\CEP Pilot\\control\\other.exe\" --service"));
        Throws<InvalidDataException>(() => InstalledLayout.FromServiceImage("\"D:\\CEP Pilot\\control\\CepHoras.Control.exe\" --service --command"));
        using var self = Process.GetCurrentProcess();
        var started = self.StartTime.ToUniversalTime().Ticks;
        Assert(UpdateStore.ProcessMatches(self.Id, started, Environment.ProcessPath!), "current process exact identity matches");
        Assert(!UpdateStore.ProcessMatches(self.Id, started + 1, Environment.ProcessPath!) &&
            !UpdateStore.ProcessMatches(self.Id, started, Path.Combine(Path.GetTempPath(), "other.exe")), "PID reuse and path mismatch deny process identity");
        Assert(!UpdateStore.ProcessMatches(self.Id, started, Environment.ProcessPath!, requireSystem: true), "interactive session process cannot substitute SYSTEM runner");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        Interlocked.Increment(ref assertions);
    }
    private static void Throws<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T) { Interlocked.Increment(ref assertions); return; }
        throw new Exception("Expected fixture failure: " + typeof(T).Name);
    }

    private sealed class FixturePower : ISystemPower
    {
        internal int Scheduled, Cancelled;
        internal bool CancelFails;
        internal Action? OnSchedule;
        public void Schedule(string action, int seconds) { OnSchedule?.Invoke(); Scheduled++; }
        public void Cancel(string action) { if (CancelFails) throw new IOException("fixture cancel uncertain"); Cancelled++; }
    }
    private sealed class FixtureSessions : IDesktopSessions
    {
        internal uint[] Active = [];
        internal List<uint> Launched = [];
        internal HashSet<uint> Running = [];
        internal Action<uint>? OnLaunch;
        public IReadOnlyList<uint> ActiveSessions() => Active;
        public bool IsRunning(uint session) => Running.Contains(session);
        public bool Launch(uint session) { Launched.Add(session); OnLaunch?.Invoke(session); return true; }
    }
}
