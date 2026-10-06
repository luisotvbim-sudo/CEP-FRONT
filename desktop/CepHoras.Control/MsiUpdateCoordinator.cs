using System.Diagnostics;
using System.IO;
using CepHoras.Control.Protocol;
using CepHoras.Updates;

namespace CepHoras.Control;

internal sealed class MsiUpdateCoordinator(CancellationToken stopping) : IDisposable
{
    private readonly object gate = new();
    private readonly UpdateStore store = new();
    private readonly GitHubMsiUpdates updates = new();
    private readonly CancellationTokenSource lifetime = CancellationTokenSource.CreateLinkedTokenSource(stopping);
    private MsiRelease? available;
    private string phase = "idle";
    private bool busy;
    private bool initialized;
    private bool disposed;
    private bool preferCachedStatus;
    private FileStream? lease;
    private Action? cancelPower;

    internal void Initialize(Action cancelPendingPower)
    {
        cancelPower = cancelPendingPower;
        store.Initialize();
        lock (gate) phase = RefreshState()?.Phase ?? "idle";
        initialized = true;
    }

    internal bool InMaintenance
    {
        get
        {
            // Failed initialization can mean an unreadable maintenance journal.
            // Absence of a successfully read state is not proof that MSI is idle.
            if (!initialized) return true;
            lock (gate)
            {
                try { return RefreshState()?.InMaintenance == true; }
                catch { return true; } // Never reopen Windows controls on an unreadable journal.
            }
        }
    }

    internal ControlResponse Handle(ControlRequest request, UpdateClient client)
    {
        lock (gate)
        {
            if (disposed) return new("update_maintenance", "O serviço está encerrando. Aguarde a manutenção.", UpdatePhase: "failed");
            if (!initialized) return new("update_unavailable", "O atualizador local precisa de revisão da TI; o controle de energia permanece ativo.", UpdatePhase: "failed");
            var state = RefreshState();
            if (request.Operation == "update-status") return Response(state);
            if (request.Operation == "update-check")
            {
                if (state?.RestartRequired == true) return Response(state);
                if (!busy && state?.InMaintenance != true)
                {
                    busy = true;
                    phase = "checking";
                    preferCachedStatus = true;
                    _ = Task.Run(CheckAsync);
                }
                return Response(state, preferCached: true);
            }
            if (!UpdateStore.IsVersion(request.ApprovedVersion)) return Denied("Versão aprovada inválida.");
            if (request.Operation == "update-start")
            {
                if (state?.RestartRequired == true) return Response(state);
                if (busy || state?.InMaintenance == true) return Response(state, "update_busy");
                if (available is null || available.Version.ToString(3) != request.ApprovedVersion)
                    return Denied("A versão disponível mudou. Consulte novamente.");
                lease = store.AcquireLock();
                busy = true;
                phase = "downloading";
                preferCachedStatus = true;
                var approved = request.ApprovedVersion!;
                _ = Task.Run(() => DownloadAsync(approved, client));
                return Response(null, "update_started", preferCached: true);
            }
            if (request.Operation == "update-ready")
            {
                if (busy) return Response(state, "update_busy");
                if (state is null || !UpdateAuthorization.CanAcknowledge(state, client, request.ApprovedVersion, DateTimeOffset.UtcNow, busy))
                    return Denied("Não existe uma atualização pronta autorizada para esta instância.");
                lease ??= store.AcquireLock();
                // The full helper payload was copied during download, outside the bounded pipe request.
                UpdateStore.ValidatePrivate(new FileInfo(store.RunnerPath(state.AttemptId)));
                state = state with { Phase = "installing", Deadline = DateTimeOffset.UtcNow.AddMinutes(40) };
                store.Save(state);
                phase = "installing";
                preferCachedStatus = false;
                var runnerStarted = false;
                try
                {
                    using var runner = Process.Start(new ProcessStartInfo(store.RunnerPath(state.AttemptId))
                    {
                        UseShellExecute = false, CreateNoWindow = true,
                        WorkingDirectory = store.RunnerDirectory(state.AttemptId), Arguments = "--run-update"
                    }) ?? throw new IOException("O executor não iniciou.");
                    runnerStarted = true;
                    state = state with { RunnerPid = runner.Id, RunnerStartedUtcTicks = runner.StartTime.ToUniversalTime().Ticks };
                    store.Save(state);
                    PolicyStore.Audit("update-runner-started:" + state.TargetVersion, client.Sid);
                    return Response(state, "update_installing");
                }
                catch
                {
                    if (!runnerStarted)
                    {
                        state = state with { Phase = "failed", Diagnostic = "update_runner_start_failed" };
                        store.Save(state);
                        phase = "failed";
                    }
                    // A helper may already exist. Leave its journal intact until its
                    // liveness/deadline can be reconciled; never start a second one.
                    throw;
                }
                finally { lease.Dispose(); lease = null; }
            }
            return Denied("Operação de atualização inválida.");
        }
    }

    private async Task CheckAsync()
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            timeout.CancelAfter(TimeSpan.FromMinutes(2));
            var release = await updates.CheckAsync(Version.Parse(UpdateStore.InstalledVersion()), timeout.Token);
            lock (gate)
            {
                if (disposed) return;
                available = release;
                phase = release is null ? "idle" : "available";
            }
        }
        catch (Exception error)
        {
            lock (gate) { if (!disposed) { phase = "failed"; available = null; } }
            PolicyStore.Audit("update-check-failed:" + error.GetType().Name, "SYSTEM");
        }
        finally { lock (gate) busy = false; }
    }

    private async Task DownloadAsync(string approvedVersion, UpdateClient client)
    {
        UpdateState? state = null;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            timeout.CancelAfter(TimeSpan.FromMinutes(15));
            var installed = UpdateStore.InstalledVersion();
            var fresh = await updates.CheckAsync(Version.Parse(installed), timeout.Token);
            if (fresh is null || fresh.Version.ToString(3) != approvedVersion)
                throw new InvalidDataException("A release aprovada mudou.");
            timeout.Token.ThrowIfCancellationRequested();
            store.PrepareAttemptStorage(fresh.Size);
            timeout.Token.ThrowIfCancellationRequested();
            var attempt = Guid.NewGuid();
            UpdateStore.CreatePrivateDirectory(store.AttemptDirectory(attempt));
            state = new(1, attempt, installed, approvedVersion, "downloading", client, DateTimeOffset.UtcNow.AddMinutes(15), fresh,
                BootId: UpdateStore.CurrentBootId());
            lock (gate)
            {
                timeout.Token.ThrowIfCancellationRequested();
                if (disposed) throw new OperationCanceledException();
                store.Save(state);
            }
            var path = await updates.DownloadAsync(fresh, store.AttemptDirectory(attempt), timeout.Token);
            if (!string.Equals(Path.GetDirectoryName(Path.GetFullPath(path)), store.AttemptDirectory(attempt), StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException("O download saiu do diretório privado.");
            UpdateStore.ValidatePrivate(new FileInfo(path));
            updates.VerifyDownloadedPackage(path, fresh);
            File.Move(path, store.PackagePath(attempt));
            UpdateStore.ValidatePrivate(new FileInfo(store.PackagePath(attempt)));
            store.CopyRunner(attempt);
            timeout.Token.ThrowIfCancellationRequested();
            lock (gate)
            {
                timeout.Token.ThrowIfCancellationRequested();
                if (disposed) throw new OperationCanceledException();
                // Set maintenance before cancelling so no parallel request can schedule
                // power between cancellation and the ready marker.
                state = state with { Phase = "ready", Deadline = DateTimeOffset.UtcNow.AddMinutes(2) };
                store.Save(state);
                available = fresh;
            }
            // Do not invert the coordinator/power locks. The durable marker already
            // rejects new actions, and ready acknowledgement is refused until this ends.
            cancelPower?.Invoke();
            lock (gate) { phase = "ready"; preferCachedStatus = false; }
            PolicyStore.Audit("update-ready:" + approvedVersion, client.Sid);
        }
        catch (Exception error)
        {
            lock (gate)
            {
                phase = "failed";
                preferCachedStatus = false;
                UpdateLease.ReleaseAfterFailure(
                    () => { if (!disposed && state is not null) store.Save(state with { Phase = "failed", Diagnostic = "update_download_failed" }); },
                    () => { lease?.Dispose(); lease = null; });
            }
            PolicyStore.Audit("update-download-failed:" + error.GetType().Name, "SYSTEM");
        }
        finally { lock (gate) busy = false; }
    }

    private UpdateState? RefreshState()
    {
        var state = store.Read();
        if (state is null) return null;
        if (state.Phase == "downloading" && busy) return state;
        var runnerAlive = UpdateStore.ProcessMatches(state.RunnerPid, state.RunnerStartedUtcTicks, store.RunnerPath(state.AttemptId), requireSystem: true);
        var installerAlive = UpdateStore.ProcessMatches(state.InstallerPid, state.InstallerStartedUtcTicks,
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "msiexec.exe"), requireSystem: true);
        if (state.RestartRequired && !runnerAlive && !installerAlive && state.BootId != Guid.Empty &&
            UpdateStore.CurrentBootId() is var bootId && bootId != Guid.Empty && bootId != state.BootId &&
            UpdateStore.InstalledVersion() == state.TargetVersion)
        {
            state = state with { Phase = state.ExitCode == 3010 ? "success" : state.Phase,
                InstalledVersion = state.TargetVersion, RestartRequired = false, Diagnostic = null };
            store.Save(state);
        }
        var recovered = UpdateRecovery.Reconcile(state, DateTimeOffset.UtcNow, runnerAlive, installerAlive,
            UpdateStore.InstalledVersion(), UpdateStore.CurrentBootId());
        if (recovered != state)
        {
            store.Save(recovered);
            lease?.Dispose(); lease = null;
            phase = recovered.Phase;
            preferCachedStatus = false;
            PolicyStore.Audit("update-recovered:" + recovered.Phase, "SYSTEM");
        }
        return recovered;
    }

    private ControlResponse Response(UpdateState? state, string code = "update_status", bool preferCached = false)
    {
        var cached = preferCached || busy || preferCachedStatus;
        var shownPhase = UpdateStatusProjection.Phase(phase, state?.Phase, cached, busy);
        var installed = UpdateStore.InstalledVersion();
        var restart = state?.RestartRequired == true && !cached;
        var message = restart ? "A instalação requer reinício do Windows para concluir a troca. Salve seu trabalho e reinicie pelo fluxo autorizado."
            : shownPhase switch
            {
                "checking" => "Verificando atualizações.", "available" => "Uma nova versão está disponível.",
                "downloading" => "Baixando e validando a atualização.", "ready" => "A atualização está pronta. O aplicativo será fechado para instalar.",
                "installing" => state?.Diagnostic == "installer_timeout" ? "A instalação ultrapassou o prazo esperado. Aguarde ou solicite suporte à TI." : "Instalando a atualização. Aguarde.",
                "success" => "Atualização concluída.", "failed" => "A atualização não foi concluída. O aplicativo pode ser usado; tente novamente ou solicite suporte à TI.",
                _ => "O CEP Horas está atualizado."
            };
        return new(restart ? "update_restart_required" : code, message,
            UpdateVersion: cached ? available?.Version.ToString(3) : state?.TargetVersion ?? available?.Version.ToString(3),
            UpdatePhase: shownPhase, InstalledVersion: installed);
    }

    private ControlResponse Denied(string message) => new("update_denied", message,
        UpdateVersion: available?.Version.ToString(3), UpdatePhase: phase, InstalledVersion: UpdateStore.InstalledVersion());

    public void Dispose()
    {
        lock (gate)
        {
            disposed = true;
            lifetime.Cancel();
            lease?.Dispose(); lease = null;
        }
        // Async workers may still unwind their linked tokens. Do not dispose the
        // source underneath them; the service process owns its remaining lifetime.
    }
}
