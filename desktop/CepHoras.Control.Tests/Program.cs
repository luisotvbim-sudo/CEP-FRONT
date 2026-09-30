using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using CepHoras.Control;
using CepHoras.Control.Protocol;

// NO Windows policy writes, service installation or actual shutdown calls in this test executable.
var admxPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "PolicyDefinitions", "StartMenu.admx");
if (File.Exists(admxPath))
{
    var admx = System.Xml.Linq.XDocument.Load(admxPath);
    var setting = PolicyStore.Settings[0];
    Assert(admx.Descendants().Any(x => x.Name.LocalName == "policy" && (string?)x.Attribute("class") == "Machine" &&
        (string?)x.Attribute("valueName") == setting.Name && string.Equals((string?)x.Attribute("key"), setting.Key, StringComparison.OrdinalIgnoreCase)),
        "power-menu setting must match the installed Windows machine ADMX, not a user-only policy");
}
var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(20));
var salt = RandomNumberGenerator.GetBytes(16);
var original = new PolicySnapshot(new() { ["SeShutdownPrivilege"] = ["S-1-5-32-545"], ["SeRemoteShutdownPrivilege"] = [] }, []);
ControlConfiguration? config = new(1, true, "active", salt,
    Rfc2898DeriveBytes.Pbkdf2(password, salt, 600_000, HashAlgorithmName.SHA256, 32), original);
long now = 1_000;
var healthy = true; var shutdowns = 0; var cancellations = 0; var audits = new List<string>();
var authority = new ShutdownAuthority(() => config, () => healthy, () => shutdowns++, () => cancellations++, (code, sid) => audits.Add(code + sid), () => now);
Assert(authority.Handle(new("status"), "userA").Active, "active status");
Assert(authority.Handle(new("shutdown", password), "userA").Code == "invalid_request", "must confirm");
Assert(authority.Handle(new("execute", password, true), "userA").Code == "invalid_request", "no arbitrary operations");
for (var i = 0; i < 5; i++) Assert(authority.Handle(new("shutdown", "wrong-value", true), "userA").Code == "denied", "incorrect password denied");
Assert(authority.Handle(new("shutdown", password, true), "userA").Code == "rate_limited", "rate limit applies even to correct password during cooldown");
Assert(shutdowns == 0, "no unauthorized shutdown");
now += 60_001;
Assert(authority.Handle(new("shutdown", password, true), "userA").Code == "scheduled" && shutdowns == 1, "authenticated confirmed shutdown");
Assert(authority.Handle(new("shutdown", password, true), "userA").Code == "pending" && shutdowns == 1, "duplicate request does not repeat shutdown");
Assert(authority.Handle(new("cancel"), "userB").Code == "not_pending" && cancellations == 0, "other user cannot cancel");
Assert(authority.Handle(new("cancel"), "userA").Code == "canceled" && cancellations == 1, "request owner can cancel");
healthy = false;
Assert(authority.Handle(new("shutdown", password, true), "userA").Code == "policy_changed" && shutdowns == 1, "external policy drift denies");
healthy = true; config = config with { Active = false };
Assert(authority.Handle(new("shutdown", password, true), "userA").Code == "inactive", "inactive configuration denies");
config = null;
Assert(authority.Handle(new("shutdown", password, true), "userA").Code == "inactive", "missing configuration denies");
Assert(audits.All(x => !x.Contains(password)), "no secrets in audit");

foreach (var failure in new[] { "none", "backup", "apply", "verify", "commit", "restore" })
{
    var state = "original"; var saved = false; var active = false; var restored = false;
    try
    {
        PolicyTransaction.Apply(
            () => { if (failure == "backup") throw new IOException("fixture"); saved = true; },
            () => { Assert(saved, "durable backup before mutation"); state = "partial"; if (failure is "apply" or "restore") throw new IOException("fixture"); state = "restricted"; },
            () => failure != "verify",
            () => { if (failure == "restore") throw new IOException("fixture recovery"); state = "original"; restored = true; },
            () => { if (failure == "commit") throw new IOException("fixture commit"); active = true; },
            () => active = false);
        Assert(failure == "none" && state == "restricted" && active, "transaction commit");
    }
    catch (Exception)
    {
        Assert(failure != "none", "unexpected transaction error");
        Assert(!active, "failed activation must not mark active");
        if (failure == "restore") Assert(saved && state == "partial", "failed rollback preserves recovery backup");
        else Assert(state == "original" && (failure == "backup" || restored), "rollback restored original state");
    }
}

using (var stream = new MemoryStream())
{
    await ControlWire.Write(stream, new ControlRequest("status"), CancellationToken.None); stream.Position = 0;
    Assert((await ControlWire.Read<ControlRequest>(stream, CancellationToken.None)).Action == "status", "wire roundtrip");
}
foreach (var size in new[] { -1, 0, 4097, int.MaxValue })
{
    using var stream = new MemoryStream(BitConverter.GetBytes(size));
    try { await ControlWire.Read<ControlRequest>(stream, CancellationToken.None); throw new Exception("oversized message accepted"); }
    catch (InvalidDataException) { }
}
var security = ControlService.CreateSecurity();
var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<PipeAccessRule>().ToArray();
Assert(rules.Any(x => x.IdentityReference.Value == "S-1-5-2" && x.AccessControlType == AccessControlType.Deny), "remote network callers denied");
Assert(rules.Where(x => x.AccessControlType == AccessControlType.Allow && x.IdentityReference.Value != "S-1-5-18").All(x => (x.PipeAccessRights & PipeAccessRights.CreateNewInstance) == 0), "clients cannot create pipe instances");
var fixturePipe = "CepHoras.Control.Fixture." + Guid.NewGuid().ToString("N");
using var testDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
using (var server = new NamedPipeServerStream(fixturePipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly))
using (var client = new NamedPipeClientStream(".", fixturePipe, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification))
{
    var waiting = server.WaitForConnectionAsync(testDeadline.Token); await client.ConnectAsync(testDeadline.Token); await waiting;
    var reading = ControlWire.Read<ControlRequest>(server, testDeadline.Token);
    await ControlWire.Write(client, new ControlRequest("status"), testDeadline.Token);
    await reading;
    using var identity = WindowsIdentity.GetCurrent();
    var expected = identity.Groups?.Any(x => x.Value == "S-1-5-4") == true ? identity.User!.Value : null;
    Assert(ControlService.CallerSid(server) == expected, "caller identity comes from Windows identification token, not request JSON");
}
// A rogue process owns the well-known name in this isolated test, but the client must reject it before sending a password.
if (ControlClient.GetServiceProcessId() == 0)
{
    using var rogue = new NamedPipeServerStream(ControlWire.PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly | PipeOptions.FirstPipeInstance);
    var connection = rogue.WaitForConnectionAsync();
    try { await ControlClient.Send(new("shutdown", password, true)); throw new Exception("rogue pipe accepted"); }
    catch (UnauthorizedAccessException) { }
    await connection;
    Assert(rogue.ReadByte() == -1, "password never transmitted to rogue server");
}
try
{
    foreach (var right in NativePolicy.Rights)
        foreach (var sid in NativePolicy.ReadRight(right)) _ = new SecurityIdentifier(sid);
    Console.WriteLine("PASS: read-only LSA enumeration on Windows.");
}
catch (System.ComponentModel.Win32Exception error) when (error.NativeErrorCode == 5)
{ Console.WriteLine("SKIP: read-only LSA enumeration requires administrative access on this computer."); }
Console.WriteLine("PASS: authorization, cooldown, confirmation, duplicate/cancel ownership, policy drift, absent configuration, redacted audit, rollback failures, bounded IPC, pipe identity/ACL and rogue-server rejection. No system changes or shutdown requested.");
static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
