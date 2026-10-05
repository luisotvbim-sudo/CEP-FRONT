using System.IO;
using System.Security.Principal;

namespace CepHoras.Control;

internal static class UpdateLease
{
    internal static void ReleaseAfterFailure(Action saveFailure, Action release)
    {
        try { saveFailure(); }
        finally { release(); }
    }
}

internal static class UpdateStateValidation
{
    internal static void Validate(UpdateState? state)
    {
        if (state is null || state.Schema != 1 || state.AttemptId == Guid.Empty ||
            !UpdateStore.IsVersion(state.TargetVersion) || !UpdateStore.IsVersion(state.InstalledVersion) ||
            state.Release?.Version is null || state.Release.Version.ToString(3) != state.TargetVersion ||
            state.Release.PackageUri is null || !state.Release.PackageUri.IsAbsoluteUri ||
            state.Release.PackageUri.AbsoluteUri != $"https://github.com/luisotvbim-sudo/CEP-FRONT/releases/download/installer-v{state.TargetVersion}/CEP-Horas-Windows-win-x64.msi" ||
            state.Release.Size is < 1 or > 536_870_912 || state.Release.Sha256 is not { Length: 64 } hash || !hash.All(char.IsAsciiHexDigit) ||
            state.Release.Manifest is not { Length: > 0 and <= 65536 } || state.Release.Signature is not { Length: > 0 and <= 1024 } ||
            state.Owner is null || state.Owner.ProcessId < 1 || state.Owner.ProcessStartedUtcTicks < 1 || state.Owner.SessionId == 0 ||
            state.RunnerPid < 0 || state.RunnerStartedUtcTicks < 0 || (state.RunnerPid == 0) != (state.RunnerStartedUtcTicks == 0) ||
            state.InstallerPid < 0 || state.InstallerStartedUtcTicks < 0 || (state.InstallerPid == 0) != (state.InstallerStartedUtcTicks == 0) ||
            state.Phase is not ("downloading" or "ready" or "installing" or "success" or "failed") ||
            state.Deadline == DateTimeOffset.MinValue ||
            (state.Phase is "downloading" or "ready" or "installing" && Version.Parse(state.TargetVersion) <= Version.Parse(state.InstalledVersion)) ||
            (state.Phase == "success" && state.TargetVersion != state.InstalledVersion))
            throw new InvalidDataException("Estado de atualização incompatível.");
        try
        {
            if (new SecurityIdentifier(state.Owner.Sid).Value != state.Owner.Sid)
                throw new InvalidDataException("Identidade de atualização inválida.");
        }
        catch (ArgumentException error) { throw new InvalidDataException("Identidade de atualização inválida.", error); }
    }
}

internal sealed record StoredAttempt(Guid Id, DateTimeOffset CreatedAt, long Bytes);

internal static class AttemptRetention
{
    internal const long MaximumBytes = 2L * 1024 * 1024 * 1024;

    internal static Guid[] ToRemove(IEnumerable<StoredAttempt> attempts, Guid? preserve, DateTimeOffset now) =>
        attempts.OrderByDescending(attempt => attempt.CreatedAt).Where((attempt, index) =>
            attempt.Id != preserve && (index >= 3 || attempt.CreatedAt < now.AddDays(-14))).Select(attempt => attempt.Id).ToArray();

    internal static void RequireSpace(long stored, long incoming, long free)
    {
        if (stored < 0 || incoming < 1 || stored > MaximumBytes || incoming > MaximumBytes - stored ||
            free < incoming || free - incoming < 100L * 1024 * 1024)
            throw new IOException("Armazenamento de atualização insuficiente. Preserve a tentativa atual e solicite suporte à TI.");
    }
}
