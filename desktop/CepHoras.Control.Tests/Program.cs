using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using CepHoras.Control;
using CepHoras.Control.Protocol;
using CepHoras.Updates;

// These checks never install a service, modify Windows policy or invoke a real power action.
await ControlExchangeChecks.Run();
var original = new PolicySnapshot(
    new() { ["SeShutdownPrivilege"] = ["S-1-5-32-545"], ["SeRemoteShutdownPrivilege"] = [] },
    []);
ControlConfiguration? configuration = new(2, true, "active", original);
var healthy = true;
var now = DateTimeOffset.Parse("2026-09-30T22:00:00Z");
var system = new FakePower();
var audits = new List<string>();
var authority = new PowerAuthority(
    () => configuration,
    () => healthy,
    system,
    (code, sid) => audits.Add(code + ":" + sid),
    () => now);

Assert(authority.Handle(new("status"), "userA").Active, "active status");
foreach (var action in new[] { "shutdown", "restart", "hibernate" })
{
    var requestId = Guid.NewGuid().ToString();
    var scheduled = authority.Handle(new("schedule", requestId, action, 10), "userA");
    Assert(scheduled.Code == "scheduled" && scheduled.Action == action && scheduled.ExecuteAt == now.AddSeconds(10), action + " scheduled");
    Assert(authority.Handle(new("schedule", requestId, action, 10), "userA").Code == "scheduled", "idempotent schedule");
    Assert(authority.Handle(new("cancel", requestId), "userB").Code == "not_pending", "foreign cancel cannot control another owner");
    var ownerCancel = authority.Handle(new("cancel", requestId), "userA");
    Assert(ownerCancel.Code == "cancelled" && ownerCancel.Cancelled, "owner cancel");
    Assert(authority.Handle(new("schedule", requestId, action, 10), "userA").Code == "cancelled", "cancel wins late schedule");
}
Assert(system.Scheduled.SequenceEqual(new[] { "shutdown", "restart", "hibernate" }), "only requested fixed actions scheduled");
Assert(system.Cancelled.SequenceEqual(new[] { "shutdown", "restart", "hibernate" }), "all fixed actions cancel");
Assert(authority.Handle(new("schedule", Guid.NewGuid().ToString(), "execute", 10), "userA").Code == "invalid_request", "arbitrary action denied");
Assert(authority.Handle(new("schedule", Guid.NewGuid().ToString(), "shutdown", 30), "userA").Code == "invalid_request", "delay fixed at ten seconds");
healthy = false;
Assert(authority.Handle(new("schedule", Guid.NewGuid().ToString(), "shutdown", 10), "userA").Code == "policy_changed", "policy drift denies");
healthy = true;
configuration = null;
Assert(authority.Handle(new("schedule", Guid.NewGuid().ToString(), "shutdown", 10), "userA").Code == "inactive", "missing policy denies");
Assert(audits.All(value => !value.Contains("password", StringComparison.OrdinalIgnoreCase)), "audit has no credential");

configuration = new(2, true, "active", original);
var inMaintenance = false;
using (var unreadableUpdater = new MsiUpdateCoordinator(CancellationToken.None))
    Assert(unreadableUpdater.InMaintenance, "uninitialized updater cannot reopen energy or supervision before reading maintenance state");
var updatePower = new FakePower();
var guardedAuthority = new PowerAuthority(() => configuration, () => true, updatePower, (_, _) => { }, () => now, () => inMaintenance);
var beforeUpdateId = Guid.NewGuid().ToString();
Assert(guardedAuthority.Handle(new("schedule", beforeUpdateId, "shutdown", 10), "owner").Code == "scheduled", "power before update accepted");
inMaintenance = true;
guardedAuthority.CancelForMaintenance();
Assert(updatePower.Cancelled.SequenceEqual(["shutdown"]), "update cancels pending power");
Assert(guardedAuthority.Handle(new("schedule", Guid.NewGuid().ToString(), "restart", 10), "owner").Code == "update_maintenance", "maintenance denies new power");
inMaintenance = false;
Assert(guardedAuthority.Handle(new("schedule", beforeUpdateId, "shutdown", 10), "owner").Code == "cancelled", "cancelled power cannot reappear after maintenance");
var restoreCount = 0;
var guardedLifecycle = new DesktopLifecycleController(new(), () => restoreCount++, () => { }, (_, _) => { }, () => inMaintenance);
inMaintenance = true;
Assert(guardedLifecycle.Suspend(1, "owner").Code == "update_maintenance" && restoreCount == 0, "update never restores power policies through desktop-suspend");
Assert(guardedLifecycle.Resume(1, "owner").Code == "update_maintenance", "manual resume cannot bypass update maintenance");

var updateOwner = new UpdateClient("owner", 2, 42, 1000);
var release = new MsiRelease(new Version(0, 4, 8), new Uri("https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/installer-v0.4.8/CEP-Horas-Windows-win-x64.msi"), 1, new string('A', 64), [], []);
var ready = new UpdateState(1, Guid.NewGuid(), "0.4.7", "0.4.8", "ready", updateOwner, now.AddMinutes(2), release);
Assert(UpdateAuthorization.CanAcknowledge(ready, updateOwner, "0.4.8", now, false), "owner can acknowledge exact approved update");
Assert(!UpdateAuthorization.CanAcknowledge(ready, updateOwner with { Sid = "foreign" }, "0.4.8", now, false), "another SID cannot close owner for update");
Assert(!UpdateAuthorization.CanAcknowledge(ready, updateOwner with { SessionId = 3 }, "0.4.8", now, false), "another session cannot acknowledge");
Assert(!UpdateAuthorization.CanAcknowledge(ready, updateOwner with { ProcessStartedUtcTicks = 1001 }, "0.4.8", now, false), "reused PID cannot acknowledge");
Assert(!UpdateAuthorization.CanAcknowledge(ready, updateOwner, "0.4.9", now, false), "version changed cannot install");
Assert(!UpdateAuthorization.CanAcknowledge(ready, updateOwner, "0.4.8", ready.Deadline, false), "ready timeout exact boundary denies");
Assert(!UpdateAuthorization.CanAcknowledge(ready, updateOwner, "0.4.8", now, true), "unfinished preparation cannot start concurrent runner");
Assert(UpdateRecovery.Reconcile(ready, now.AddMinutes(3), false, false, "0.4.7").Phase == "failed", "expired readiness resumes normal operation");
var installing = ready with { Phase = "installing", Deadline = now.AddMinutes(40), RunnerPid = 99 };
Assert(UpdateRecovery.Reconcile(installing, now.AddHours(2), true, false, "0.4.8").InMaintenance, "alive helper prevents premature completion even after deadline");
Assert(UpdateRecovery.Reconcile(installing, now.AddHours(2), false, true, "0.4.8").InMaintenance, "alive installer keeps maintenance after helper crash");
Assert(UpdateRecovery.Reconcile(installing, now.AddMinutes(1), false, false, "0.4.8").InMaintenance, "starting installer gap cannot be mistaken for commit");
Assert(UpdateRecovery.Reconcile(installing, now.AddHours(2), false, false, "0.4.7").Phase == "failed", "abandoned expired update recovers baseline");
var previousBoot = Guid.NewGuid();
Assert(UpdateRecovery.Reconcile(installing with { BootId = previousBoot }, now.AddSeconds(1), false, false, "0.4.7", Guid.NewGuid())
    is { Phase: "failed", InstalledVersion: "0.4.7" }, "reboot immediately recovers interrupted installation without waiting forty minutes");
Assert(UpdateRecovery.Reconcile(installing with { BootId = previousBoot }, now.AddSeconds(1), false, false, "0.4.8", Guid.NewGuid()).Phase == "failed",
    "reboot and new file version cannot fabricate an installer commit");
Assert(UpdateRecovery.Reconcile(installing with { BootId = previousBoot }, now.AddSeconds(1), true, false, "0.4.7", previousBoot).InMaintenance,
    "same boot service restart preserves live runner maintenance");
Assert(UpdateRecovery.Completed(installing, 0, "0.4.8").Phase == "success", "MSI commit requires expected installed version");
Assert(UpdateRecovery.Completed(installing, 1603, "0.4.7").Phase == "failed", "MSI failure exits maintenance after return");
Assert(UpdateRecovery.Completed(installing, 0, "0.4.7").Phase == "failed", "zero exit alone cannot fabricate installed version");
Assert(UpdateRecovery.Completed(installing, 3010, "0.4.8") is { Phase: "success", RestartRequired: true }, "3010 retains restart requirement");
Assert(UpdateRecovery.Completed(installing, 3010, "0.4.7") is { Phase: "failed", RestartRequired: true }, "3010 old payload never claims fully installed");
Assert(UpdateStatusProjection.Phase("available", "success", true, false) == "available", "new release overrides old successful marker");
Assert(UpdateStatusProjection.Phase("downloading", "failed", false, true) == "downloading", "new worker overrides previous failure");
Assert(UpdateStatusProjection.Phase("installing", "success", false, false) == "success", "runner result becomes visible without service restart");
Assert(!UpdateStore.IsVersion("0.4.8.0") && !UpdateStore.IsVersion("../0.4.8") && UpdateStore.IsVersion("0.4.8"), "approved version is canonical three parts only");
var exclusiveFixture = Path.Combine(Path.GetTempPath(), "CepHoras.UpdateLock." + Guid.NewGuid().ToString("N"));
try
{
    using (var held = UpdateExclusiveLock.Open(exclusiveFixture))
    {
        var deniedLeases = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() =>
        {
            try { using var duplicate = UpdateExclusiveLock.Open(exclusiveFixture); return false; }
            catch (IOException) { return true; }
        })));
        Assert(deniedLeases.All(x => x), "service/helper global file lease rejects every concurrent installer");
    }
    using var next = UpdateExclusiveLock.Open(exclusiveFixture);
    Assert(next.CanWrite, "file lease can transfer to helper after service releases it");
}
finally { if (File.Exists(exclusiveFixture)) File.Delete(exclusiveFixture); }

var supervision = new DesktopSupervisionState();
Assert(supervision.AllowsLaunch(12), "supervision starts active");
supervision.Suspend(12, "userA");
Assert(!supervision.AllowsLaunch(12), "authorized close suspends current session");
Assert(!supervision.Resume(12, "userB") && !supervision.AllowsLaunch(12), "another identity cannot resume suspension");
Assert(supervision.Resume(12, "userA") && supervision.AllowsLaunch(12), "manual start resumes same identity");
supervision.Suspend(12, "userA");
Assert(supervision.AllowsLaunch(13) && !supervision.AllowsLaunch(12), "another session cannot discard the existing suspension");

var lifecycleOrder = new List<string>();
var lifecycleState = new DesktopSupervisionState();
var lifecycle = new DesktopLifecycleController(
    lifecycleState,
    () => lifecycleOrder.Add("restore"),
    () => lifecycleOrder.Add("apply"),
    (code, _) => lifecycleOrder.Add(code));
Assert(lifecycle.Suspend(21, "userA").Code == "desktop_suspended", "protected close accepted");
Assert(lifecycleOrder[0] == "restore" && !lifecycleState.AllowsLaunch(21), "policy restored before relaunch suspension");
Assert(lifecycle.Resume(21, "userA").Code == "desktop_resumed", "manual open accepted");
Assert(lifecycleOrder.Contains("apply") && lifecycleState.AllowsLaunch(21), "policy applied before supervision resumes");
lifecycleState.Suspend(21, "userA");
lifecycle.ProtectAfterSessionEnd(21);
Assert(lifecycleState.AllowsLaunch(21), "session end reapplies policy and clears session suspension");
lifecycle.ProtectAtServiceStart();
Assert(lifecycleOrder.Count(value => value == "apply") == 3, "service start reapplies policy before user launch");

var failedRestoreState = new DesktopSupervisionState();
var failedRestore = new DesktopLifecycleController(
    failedRestoreState,
    () => throw new IOException("fixture"),
    () => { },
    (_, _) => { });
try { failedRestore.Suspend(22, "userA"); throw new Exception("close accepted without policy restore"); }
catch (IOException) { }
Assert(failedRestoreState.AllowsLaunch(22), "failed restore must keep supervision active");

var failedApplyState = new DesktopSupervisionState();
failedApplyState.Suspend(23, "userA");
var failedApply = new DesktopLifecycleController(
    failedApplyState,
    () => { },
    () => throw new IOException("fixture"),
    (_, _) => { });
try { failedApply.Resume(23, "userA"); throw new Exception("supervision resumed without policy apply"); }
catch (IOException) { }
Assert(!failedApplyState.AllowsLaunch(23), "failed apply must keep supervision suspended");

foreach (var failure in new[] { "none", "backup", "apply", "verify", "commit", "restore" })
{
    var state = "original";
    var saved = false;
    var active = false;
    var restored = false;
    try
    {
        PolicyTransaction.Apply(
            () => { if (failure == "backup") throw new IOException("fixture"); saved = true; },
            () => { Assert(saved, "backup before mutation"); state = "partial"; if (failure is "apply" or "restore") throw new IOException("fixture"); state = "restricted"; },
            () => failure != "verify",
            () => { if (failure == "restore") throw new IOException("fixture recovery"); state = "original"; restored = true; },
            () => { if (failure == "commit") throw new IOException("fixture commit"); active = true; },
            () => active = false);
        Assert(failure == "none" && state == "restricted" && active, "transaction commit");
    }
    catch
    {
        Assert(failure != "none", "unexpected transaction error");
        Assert(!active, "failed activation not active");
        if (failure == "restore") Assert(saved && state == "partial", "backup preserved when restore fails");
        else Assert(state == "original" && (failure == "backup" || restored), "rollback restored original");
    }
}

using (var stream = new MemoryStream())
{
    await ControlWire.Write(stream, new ControlRequest("status"), CancellationToken.None);
    stream.Position = 0;
    Assert((await ControlWire.Read<ControlRequest>(stream, CancellationToken.None)).Operation == "status", "wire roundtrip");
}
foreach (var size in new[] { -1, 0, 4097, int.MaxValue })
{
    using var stream = new MemoryStream(BitConverter.GetBytes(size));
    try { await ControlWire.Read<ControlRequest>(stream, CancellationToken.None); throw new Exception("oversized accepted"); }
    catch (InvalidDataException) { }
}
var security = ControlService.CreateSecurity();
var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<PipeAccessRule>().ToArray();
Assert(rules.Any(x => x.IdentityReference.Value == "S-1-5-2" && x.AccessControlType == AccessControlType.Deny), "network denied");
Assert(rules.Where(x => x.AccessControlType == AccessControlType.Allow && x.IdentityReference.Value != "S-1-5-18")
    .All(x => (x.PipeAccessRights & PipeAccessRights.CreateNewInstance) == 0), "clients cannot create server instances");

var fixturePipe = "CepHoras.Control.Fixture." + Guid.NewGuid().ToString("N");
using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
using (var server = new NamedPipeServerStream(fixturePipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly))
using (var client = new NamedPipeClientStream(".", fixturePipe, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification))
{
    var waiting = server.WaitForConnectionAsync(deadline.Token);
    await client.ConnectAsync(deadline.Token);
    await waiting;
    using var identity = WindowsIdentity.GetCurrent();
    var expected = identity.Groups?.Any(x => x.Value == "S-1-5-4") == true ? identity.User!.Value : null;
    Assert(ControlService.CallerSid(server) == expected, "caller SID comes from Windows token");
}

Console.WriteLine("PASS: fixed power actions, ten-second scheduling, idempotency, cancellation, policy fail-closed, rollback and bounded IPC. No system action executed.");
Console.WriteLine("PASS: update owner/version/expiry, recovery, maintenance power cancellation and status projection. Privileged MSI/ACL/StopServices validation remains deferred to a SYSTEM pilot.");
await ServiceReliabilityChecks.Run();
await DelayedPowerChecks.Run();
PowerRecoveryChecks.Run();
PolicyProfileChecks.Run();

static void Assert(bool value, string message)
{
    if (!value) throw new Exception(message);
}

sealed class FakePower : ISystemPower
{
    internal List<string> Scheduled { get; } = [];
    internal List<string> Cancelled { get; } = [];
    public void Schedule(string action, int delaySeconds)
    {
        if (delaySeconds != 10) throw new InvalidOperationException();
        Scheduled.Add(action);
    }
    public void Cancel(string action) => Cancelled.Add(action);
}
