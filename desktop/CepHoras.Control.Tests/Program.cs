using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using CepHoras.Control;
using CepHoras.Control.Protocol;

// These checks never install a service, modify Windows policy or invoke a real power action.
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

var supervision = new DesktopSupervisionState();
Assert(supervision.AllowsLaunch(12), "supervision starts active");
supervision.Suspend(12, "userA");
Assert(!supervision.AllowsLaunch(12), "authorized close suspends current session");
Assert(!supervision.Resume(12, "userB") && !supervision.AllowsLaunch(12), "another identity cannot resume suspension");
Assert(supervision.Resume(12, "userA") && supervision.AllowsLaunch(12), "manual start resumes same identity");
supervision.Suspend(12, "userA");
Assert(supervision.AllowsLaunch(13) && supervision.AllowsLaunch(12), "new Windows session clears suspension");

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
