using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32;

namespace CepHoras.Control;

internal sealed record RegistrySetting(string Key, string Name, int Value);
internal sealed record SavedRegistry(bool Exists, int Value);
internal sealed record PolicySnapshot(Dictionary<string, string[]> Rights, SavedRegistry[] Registry);
internal sealed record ControlConfiguration(int Version, bool Active, string Phase, PolicySnapshot Original);
internal sealed record LegacyControlConfiguration(int Version, bool Active, string Phase, byte[] Salt, byte[] Hash, PolicySnapshot Original);
internal sealed record UninstallJournal(ControlConfiguration Configuration, PolicySnapshot BeforeRestore);

internal static class PolicyStore
{
    internal static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "Conceito.CepHoras.Control");
    private static readonly string FilePath = Path.Combine(Root, "policy.json");
    private static readonly string RestoreJournal = Path.Combine(Root, "restore-journal.json");
    internal static readonly RegistrySetting[] Settings =
    [
        new(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer", "HidePowerOptions", 1),
        new(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", "ShutdownWithoutLogon", 0),
        // Physical power button: do nothing on AC and battery.
        new(@"SOFTWARE\Policies\Microsoft\Power\PowerSettings\7648efa3-dd9c-4e3e-b566-50f929386280", "ACSettingIndex", 0),
        new(@"SOFTWARE\Policies\Microsoft\Power\PowerSettings\7648efa3-dd9c-4e3e-b566-50f929386280", "DCSettingIndex", 0),
        // Physical sleep button: do nothing on AC and battery.
        new(@"SOFTWARE\Policies\Microsoft\Power\PowerSettings\96996bc0-ad50-47ec-923b-6f41874dd9eb", "ACSettingIndex", 0),
        new(@"SOFTWARE\Policies\Microsoft\Power\PowerSettings\96996bc0-ad50-47ec-923b-6f41874dd9eb", "DCSettingIndex", 0),
        // Closing a laptop lid must not provide a second suspend path.
        new(@"SOFTWARE\Policies\Microsoft\Power\PowerSettings\5ca83367-6e45-459f-a27b-476b1d01c936", "ACSettingIndex", 0),
        new(@"SOFTWARE\Policies\Microsoft\Power\PowerSettings\5ca83367-6e45-459f-a27b-476b1d01c936", "DCSettingIndex", 0)
    ];

    internal static bool IsAdministrator => new WindowsPrincipal(WindowsIdentity.GetCurrent())
        .IsInRole(WindowsBuiltInRole.Administrator);

    internal static void RequireAdmin()
    {
        if (!IsAdministrator) throw new UnauthorizedAccessException("Execute com autorização de administrador.");
    }

    internal static void SecureDirectory()
    {
        RequireAdmin();
        var directory = new DirectoryInfo(Root);
        if (directory.Exists)
        {
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Diretório de configuração não pode ser um link.");
            var security = directory.GetAccessControl();
            var owner = security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
            if (owner is null || !NativePolicy.Allowed.Contains(owner.Value))
                throw new UnauthorizedAccessException("Diretório existente não pertence à TI/SYSTEM.");
            foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                if (rule.AccessControlType == AccessControlType.Allow &&
                    !NativePolicy.Allowed.Contains(rule.IdentityReference.Value) &&
                    rule.FileSystemRights != 0)
                    throw new UnauthorizedAccessException("Diretório existente permite acesso por usuário comum.");
        }
        else
        {
            var acl = new DirectorySecurity();
            acl.SetAccessRuleProtection(true, false);
            acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
            foreach (var sid in NativePolicy.Allowed)
                acl.AddAccessRule(new FileSystemAccessRule(
                    new SecurityIdentifier(sid),
                    FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None,
                    AccessControlType.Allow));
            directory.Create(acl);
        }
    }

    internal static ControlConfiguration? Read()
    {
        if (!File.Exists(FilePath)) return null;
        if ((File.GetAttributes(FilePath) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Configuração não pode ser um link.");
        var acl = new FileInfo(FilePath).GetAccessControl();
        if (acl.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner ||
            !NativePolicy.Allowed.Contains(owner.Value) ||
            acl.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Any(rule =>
                rule.AccessControlType == AccessControlType.Allow &&
                !NativePolicy.Allowed.Contains(rule.IdentityReference.Value)))
            throw new UnauthorizedAccessException("Configuração não está restrita à TI/SYSTEM.");
        var config = JsonSerializer.Deserialize<ControlConfiguration>(File.ReadAllText(FilePath))
            ?? throw new IOException("Configuração inválida.");
        if (config.Version != 2 || config.Original.Registry.Length != Settings.Length ||
            !NativePolicy.Rights.All(config.Original.Rights.ContainsKey))
            throw new IOException("Configuração incompatível.");
        return config;
    }

    private static void Save(ControlConfiguration config) => AtomicWrite(FilePath, config);

    private static void AtomicWrite<T>(string file, T value)
    {
        var temporary = Path.Combine(Root, Guid.NewGuid().ToString("N") + ".tmp");
        File.WriteAllText(temporary, JsonSerializer.Serialize(value));
        var acl = new FileSecurity();
        acl.SetAccessRuleProtection(true, false);
        acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
        foreach (var sid in NativePolicy.Allowed)
            acl.AddAccessRule(new FileSystemAccessRule(
                new SecurityIdentifier(sid), FileSystemRights.FullControl, AccessControlType.Allow));
        new FileInfo(temporary).SetAccessControl(acl);
        File.Move(temporary, file, true);
    }

    internal static PolicySnapshot Capture() => new(
        NativePolicy.Rights.ToDictionary(x => x, NativePolicy.ReadRight),
        Settings.Select(ReadRegistry).ToArray());

    private static SavedRegistry ReadRegistry(RegistrySetting setting)
    {
        using var key = Registry.LocalMachine.OpenSubKey(setting.Key);
        if (key?.GetValue(setting.Name) is not object value) return new(false, 0);
        if (key.GetValueKind(setting.Name) != RegistryValueKind.DWord)
            throw new IOException($"Valor não DWORD: {setting.Name}");
        return new(true, (int)value);
    }

    internal static bool MatchesExpected() =>
        NativePolicy.Rights.All(x => NativePolicy.ReadRight(x).Order().SequenceEqual(NativePolicy.Allowed.Order())) &&
        Settings.All(x => ReadRegistry(x) == new SavedRegistry(true, x.Value));

    internal static void Apply()
    {
        SecureDirectory();
        using var operation = LockOperation();
        using var os = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        var build = Environment.OSVersion.Version.Build;
        if (build < 26100 || os?.GetValue("InstallationType") as string != "Client" ||
            os?.GetValue("EditionID") is not string edition ||
            !(edition.StartsWith("Professional") || edition.StartsWith("Enterprise") || edition.StartsWith("Education")))
            throw new InvalidOperationException("Requer Windows 11 Pro, Enterprise ou Education 24H2 ou superior.");
        MigrateLegacyIfNeeded();
        var previous = Read();
        if (previous?.Active == true)
        {
            if (!MatchesExpected())
                throw new InvalidOperationException("A política ativa foi alterada externamente. A TI precisa revisar.");
            return;
        }
        if (previous?.Phase == "applying")
            throw new InvalidOperationException("Existe uma ativação incompleta que precisa de recuperação.");
        var config = new ControlConfiguration(2, false, "applying", Capture());
        PolicyTransaction.Apply(
            () => Save(config),
            ApplyExpected,
            MatchesExpected,
            () => RestoreSnapshot(config.Original),
            () => Save(config with { Active = true, Phase = "active" }),
            () => Save(config with { Active = false, Phase = "restored" }));
        Audit("policy-enabled", "installer");
    }

    private static void MigrateLegacyIfNeeded()
    {
        if (!File.Exists(FilePath)) return;
        using var document = JsonDocument.Parse(File.ReadAllText(FilePath));
        if (!document.RootElement.TryGetProperty("Version", out var version) || version.GetInt32() != 1) return;
        var legacy = JsonSerializer.Deserialize<LegacyControlConfiguration>(document.RootElement.GetRawText())
            ?? throw new IOException("Configuração anterior inválida.");
        if (legacy.Original.Registry.Length != 4 || !NativePolicy.Rights.All(legacy.Original.Rights.ContainsKey))
            throw new IOException("Backup anterior incompatível.");
        if (legacy.Active)
        {
            foreach (var right in NativePolicy.Rights) NativePolicy.WriteRight(right, legacy.Original.Rights[right]);
            for (var i = 0; i < legacy.Original.Registry.Length; i++)
            {
                var setting = Settings[i];
                var value = legacy.Original.Registry[i];
                using var key = Registry.LocalMachine.CreateSubKey(setting.Key);
                if (value.Exists) key.SetValue(setting.Name, value.Value, RegistryValueKind.DWord);
                else key.DeleteValue(setting.Name, false);
            }
        }
        Save(new ControlConfiguration(2, false, "restored", Capture()));
        Audit("policy-v1-migrated", "installer");
    }

    internal static void ApplyExpected()
    {
        foreach (var right in NativePolicy.Rights) NativePolicy.WriteRight(right, NativePolicy.Allowed);
        foreach (var setting in Settings)
        {
            using var key = Registry.LocalMachine.CreateSubKey(setting.Key);
            key.SetValue(setting.Name, setting.Value, RegistryValueKind.DWord);
        }
    }

    private static void RestoreSnapshot(PolicySnapshot snapshot)
    {
        foreach (var right in NativePolicy.Rights) NativePolicy.WriteRight(right, snapshot.Rights[right]);
        for (var i = 0; i < Settings.Length; i++)
        {
            var setting = Settings[i];
            var value = snapshot.Registry[i];
            using var key = Registry.LocalMachine.CreateSubKey(setting.Key);
            if (value.Exists) key.SetValue(setting.Name, value.Value, RegistryValueKind.DWord);
            else key.DeleteValue(setting.Name, false);
        }
    }

    internal static void Restore(bool forUninstall = false)
    {
        RequireAdmin();
        if (!Directory.Exists(Root)) return;
        SecureDirectory();
        using var operation = LockOperation();
        if (forUninstall && File.Exists(RestoreJournal)) File.Delete(RestoreJournal);
        var config = Read();
        if (config is null || config.Phase == "restored") return;
        if (forUninstall)
        {
            if (config.Active && !MatchesExpected())
                throw new InvalidOperationException("Política alterada externamente. Restaure pela ferramenta da TI antes de desinstalar.");
            AtomicWrite(RestoreJournal, new UninstallJournal(config, Capture()));
        }
        RestoreSnapshot(config.Original);
        Save(config with { Active = false, Phase = "restored" });
        Audit("policy-restored", "installer");
    }

    internal static void RollbackRestore()
    {
        RequireAdmin();
        if (!File.Exists(RestoreJournal)) return;
        SecureDirectory();
        using var operation = LockOperation();
        var journal = JsonSerializer.Deserialize<UninstallJournal>(File.ReadAllText(RestoreJournal))!;
        RestoreSnapshot(journal.BeforeRestore);
        Save(journal.Configuration);
        File.Delete(RestoreJournal);
    }

    internal static void FinishRestore()
    {
        RequireAdmin();
        if (!File.Exists(RestoreJournal)) return;
        SecureDirectory();
        using var operation = LockOperation();
        File.Delete(RestoreJournal);
    }

    private static FileStream LockOperation() => new(
        Path.Combine(Root, "operation.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);

    internal static void Audit(string code, string sid)
    {
        if (!Directory.Exists(Root)) return;
        var file = Path.Combine(Root, "audit.jsonl");
        if (File.Exists(file) && new FileInfo(file).Length > 5_000_000)
            File.Move(file, file + ".previous", true);
        File.AppendAllText(file, JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, code, sid }) + Environment.NewLine);
    }
}
