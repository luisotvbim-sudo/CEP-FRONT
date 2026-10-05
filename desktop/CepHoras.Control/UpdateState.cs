using CepHoras.Updates;

namespace CepHoras.Control;

internal sealed record UpdateClient(string Sid, uint SessionId, int ProcessId, long ProcessStartedUtcTicks);

// Stored only in the SYSTEM/Administrators directory. No client controls paths or commands.
internal sealed record UpdateState(
    int Schema, Guid AttemptId, string InstalledVersion, string TargetVersion, string Phase,
    UpdateClient Owner, DateTimeOffset Deadline, MsiRelease Release,
    int RunnerPid = 0, long RunnerStartedUtcTicks = 0,
    int InstallerPid = 0, long InstallerStartedUtcTicks = 0,
    int? ExitCode = null, bool RestartRequired = false, string? Diagnostic = null,
    Guid BootId = default)
{
    internal bool InMaintenance => Phase is "ready" or "installing";
    internal bool IsOwner(UpdateClient client) => Owner == client;
}

internal static class UpdateRecovery
{
    internal static UpdateState Reconcile(UpdateState state, DateTimeOffset now, bool runnerAlive,
        bool installerAlive, string installedVersion, Guid? currentBootId = null)
    {
        if (!state.InMaintenance && state.Phase != "downloading") return state;
        // The new service may start before InstallFinalize. An installed file version
        // is never evidence that a running installer committed its transaction.
        if (runnerAlive || installerAlive) return state;
        if (currentBootId is { } bootId && bootId != Guid.Empty && state.BootId != Guid.Empty && state.BootId != bootId)
            return state with { Phase = "failed", InstalledVersion = installedVersion,
                Diagnostic = "interrupted_update", ExitCode = null };
        if (state.Phase == "ready" && now < state.Deadline) return state;
        if (state.Phase == "installing" && now < state.Deadline) return state;
        return state with { Phase = "failed", InstalledVersion = installedVersion,
            Diagnostic = "interrupted_update", ExitCode = null };
    }

    internal static UpdateState Completed(UpdateState state, int exitCode, string installedVersion)
    {
        var committed = exitCode is 0 or 3010;
        // A successful MSI return without the expected payload is not a successful update.
        var versionMatches = installedVersion == state.TargetVersion;
        return state with { Phase = committed && versionMatches ? "success" : "failed",
            InstalledVersion = installedVersion, ExitCode = exitCode,
            RestartRequired = exitCode == 3010,
            Diagnostic = exitCode == 3010 ? "restart_required" : committed && !versionMatches ? "installed_version_mismatch" : committed ? null : "installer_failed" };
    }
}

internal static class UpdateAuthorization
{
    internal static bool CanAcknowledge(UpdateState? state, UpdateClient client, string? approvedVersion, DateTimeOffset now, bool busy)
        => !busy && state is { Phase: "ready" } && state.TargetVersion == approvedVersion && state.IsOwner(client) && now < state.Deadline;
}

internal static class UpdateStatusProjection
{
    internal static string Phase(string cached, string? persisted, bool preferCached, bool busy)
        => preferCached || busy ? cached : persisted ?? cached;
}
