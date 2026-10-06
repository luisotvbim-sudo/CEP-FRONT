using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace CepHoras.Control;

internal sealed class UpdateStore
{
    private static readonly HashSet<string> TrustedOwners = ["S-1-5-18", "S-1-5-32-544"];
    internal static readonly string InstalledRoot = InstalledLayout.Root();
    internal static readonly string InstalledControl = Path.Combine(InstalledRoot, "control");
    internal static readonly string InstalledDesktop = Path.Combine(InstalledRoot, "CepHoras.exe");
    internal static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Conceito.CepHoras.Updates");
    private static string StatePath => Path.Combine(Root, "state.json");

    internal void Initialize()
    {
        RequireSystem();
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        RejectReparseAncestors(programData);
        CreatePrivateDirectory(Root);
        CreatePrivateDirectory(Path.Combine(Root, "attempts"));
    }

    internal static void RequireSystem()
    {
        using var identity = WindowsIdentity.GetCurrent();
        if (!identity.IsSystem) throw new UnauthorizedAccessException("Atualização permitida somente ao serviço SYSTEM.");
    }

    internal static void RejectReparseAncestors(string path)
    {
        for (var directory = new DirectoryInfo(Path.GetFullPath(path)); directory is not null; directory = directory.Parent)
            if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Diretório de atualização não pode conter links.");
    }

    internal static void CreatePrivateDirectory(string path)
    {
        RejectReparseAncestors(Path.GetDirectoryName(path)!);
        var directory = new DirectoryInfo(path);
        if (!directory.Exists)
        {
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            security.SetOwner(new SecurityIdentifier("S-1-5-18"));
            foreach (var sid in TrustedOwners)
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            directory.Create(security);
        }
        ValidatePrivate(directory);
    }

    internal static void ValidatePrivate(FileSystemInfo item)
    {
        RejectReparseAncestors(item is DirectoryInfo ? item.FullName : Path.GetDirectoryName(item.FullName)!);
        if (!item.Exists || (item.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Arquivo de atualização inexistente ou link.");
        FileSystemSecurity security = item is DirectoryInfo directory ? directory.GetAccessControl() : ((FileInfo)item).GetAccessControl();
        if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !TrustedOwners.Contains(owner.Value) ||
            security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Any(rule =>
                rule.AccessControlType == AccessControlType.Allow && rule.FileSystemRights != 0 && !TrustedOwners.Contains(rule.IdentityReference.Value)))
            throw new UnauthorizedAccessException("Atualização exige diretório privado SYSTEM/Administradores.");
    }

    internal string AttemptDirectory(Guid attempt)
    {
        if (attempt == Guid.Empty) throw new InvalidDataException("Identificador de atualização inválido.");
        return Path.Combine(Root, "attempts", attempt.ToString("N"));
    }
    internal string PackagePath(Guid attempt) => Path.Combine(AttemptDirectory(attempt), "approved.msi");
    internal string RunnerDirectory(Guid attempt) => Path.Combine(AttemptDirectory(attempt), "runner");
    internal string RunnerPath(Guid attempt) => Path.Combine(RunnerDirectory(attempt), "CepHoras.Control.exe");
    internal string LogPath(Guid attempt) => Path.Combine(AttemptDirectory(attempt), "installer.log");

    internal FileStream AcquireLock()
    {
        ValidatePrivate(new DirectoryInfo(Root));
        var path = Path.Combine(Root, "update.lock");
        if (File.Exists(path)) ValidatePrivate(new FileInfo(path));
        var stream = UpdateExclusiveLock.Open(path);
        try { ValidatePrivate(new FileInfo(path)); return stream; }
        catch { stream.Dispose(); throw; }
    }

    internal UpdateState? Read()
    {
        ValidatePrivate(new DirectoryInfo(Root));
        if (!File.Exists(StatePath)) return null;
        var file = new FileInfo(StatePath);
        ValidatePrivate(file);
        if (file.Length > 196608) throw new InvalidDataException("Estado de atualização fora do limite.");
        var state = JsonSerializer.Deserialize<UpdateState>(File.ReadAllText(StatePath)) ?? throw new InvalidDataException("Estado inválido.");
        UpdateStateValidation.Validate(state);
        return state;
    }

    internal void Save(UpdateState state)
    {
        ValidatePrivate(new DirectoryInfo(Root));
        UpdateStateValidation.Validate(state);
        if (File.Exists(StatePath)) ValidatePrivate(new FileInfo(StatePath));
        DurableStateFile.Write(StatePath, state, path => ValidatePrivate(new FileInfo(path)));
    }

    internal static bool IsVersion(string? value) => Version.TryParse(value, out var version) &&
        version.Major <= 255 && version.Minor <= 255 && version.Build is >= 0 and <= 65535 &&
        version.Revision == -1 && version.ToString(3) == value;

    internal static string InstalledVersion()
    {
        var version = FileVersionInfo.GetVersionInfo(InstalledDesktop);
        return new Version(version.FileMajorPart, version.FileMinorPart, version.FileBuildPart).ToString(3);
    }

    internal static Guid CurrentBootId() => NtQuerySystemInformation(90, out var boot, Marshal.SizeOf<BootEnvironment>(), out _) == 0
        ? boot.Identifier : Guid.Empty;

    [StructLayout(LayoutKind.Sequential)]
    private struct BootEnvironment { internal Guid Identifier; internal uint Firmware; internal ulong Flags; }
    [DllImport("ntdll.dll")]
    private static extern int NtQuerySystemInformation(int informationClass, out BootEnvironment information, int size, out int returned);

    internal static bool ProcessMatches(int id, long startedTicks, string expectedPath, bool requireSystem = false)
    {
        if (id < 1 || startedTicks < 1) return false;
        try
        {
            using var process = Process.GetProcessById(id);
            return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == startedTicks &&
                string.Equals(Path.GetFullPath(process.MainModule?.FileName ?? ""), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase) &&
                (!requireSystem || process.SessionId == 0 && IsSystemProcess(process));
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException)
        { return false; }
    }

    private static bool IsSystemProcess(Process process)
    {
        if (!OpenProcessToken(process.Handle, 0x8, out var token)) return false;
        using (token)
        using (var identity = new WindowsIdentity(token.DangerousGetHandle())) return identity.IsSystem;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(nint process, uint access, out SafeAccessTokenHandle token);

    // Caller holds the update lease. Never prune the current journal's attempt,
    // including failed/interrupted attempts that may still require recovery.
    internal void PrepareAttemptStorage(long packageBytes)
    {
        var attemptsRoot = Path.Combine(Root, "attempts");
        ValidatePrivate(new DirectoryInfo(attemptsRoot));
        var preserve = Read()?.AttemptId;
        var attempts = new List<StoredAttempt>();
        foreach (var directory in new DirectoryInfo(attemptsRoot).GetDirectories())
        {
            if (!Guid.TryParseExact(directory.Name, "N", out var id))
                throw new InvalidDataException("Diretório de tentativa incompatível.");
            ValidateTree(directory);
            attempts.Add(new(id, directory.CreationTimeUtc, TreeBytes(directory)));
        }
        foreach (var id in AttemptRetention.ToRemove(attempts, preserve, DateTimeOffset.UtcNow))
        {
            var path = Path.GetFullPath(AttemptDirectory(id));
            if (!path.StartsWith(Path.GetFullPath(attemptsRoot) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException("Remoção fora do armazenamento de tentativas.");
            ValidateTree(new DirectoryInfo(path));
            Directory.Delete(path, recursive: true);
        }
        var stored = TreeBytes(new DirectoryInfo(attemptsRoot));
        ValidateInstalled(new DirectoryInfo(InstalledControl));
        var required = checked(packageBytes + TreeBytes(new DirectoryInfo(InstalledControl)));
        var drive = new DriveInfo(Path.GetPathRoot(Root)!);
        AttemptRetention.RequireSpace(stored, required, drive.AvailableFreeSpace);
    }

    private static long TreeBytes(DirectoryInfo directory) => checked(directory.GetFiles().Sum(file => file.Length) +
        directory.GetDirectories().Sum(TreeBytes));

    private static void ValidateTree(DirectoryInfo directory)
    {
        ValidatePrivate(directory);
        foreach (var file in directory.GetFiles()) ValidatePrivate(file);
        foreach (var child in directory.GetDirectories()) ValidateTree(child);
    }

    internal void CopyRunner(Guid attempt)
    {
        var target = RunnerDirectory(attempt);
        CreatePrivateDirectory(target);
        CopyTrustedDirectory(new DirectoryInfo(InstalledControl), new DirectoryInfo(target));
        ValidatePrivate(new FileInfo(RunnerPath(attempt)));
    }

    private static void CopyTrustedDirectory(DirectoryInfo source, DirectoryInfo target)
    {
        RejectReparseAncestors(source.FullName);
        ValidateInstalled(source);
        foreach (var file in source.GetFiles())
        {
            ValidateInstalled(file);
            var destination = Path.Combine(target.FullName, file.Name);
            if (File.Exists(destination)) throw new IOException("Payload já existe.");
            file.CopyTo(destination);
            ValidatePrivate(new FileInfo(destination));
        }
        foreach (var child in source.GetDirectories())
        {
            ValidateInstalled(child);
            var destination = new DirectoryInfo(Path.Combine(target.FullName, child.Name));
            CreatePrivateDirectory(destination.FullName);
            CopyTrustedDirectory(child, destination);
        }
    }

    private static void ValidateInstalled(FileSystemInfo item)
    {
        if ((item.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Payload instalado não pode ser um link.");
        FileSystemSecurity acl = item is DirectoryInfo directory ? directory.GetAccessControl() : ((FileInfo)item).GetAccessControl();
        const FileSystemRights mutation = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        if (acl.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !TrustedOwners.Contains(owner.Value) ||
            acl.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().Any(rule =>
                rule.AccessControlType == AccessControlType.Allow && (rule.FileSystemRights & mutation) != 0 && !TrustedOwners.Contains(rule.IdentityReference.Value)))
            throw new UnauthorizedAccessException("Payload instalado permite alteração fora de SYSTEM/Administradores.");
    }
}

internal static class UpdateExclusiveLock
{
    internal static FileStream Open(string path) => new(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
}
