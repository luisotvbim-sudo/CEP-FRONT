using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using CepHoras.Control.Protocol;
using CepHoras.Desktop;

internal static class PowerBridgeTests
{
    private static readonly Guid UserId = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    private static readonly string Broker = Guid.Parse("dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee").ToString();
    private static PowerBridgeHandler Host(ApiSession session, Func<ControlRequest, Task<ControlResponse>> sender, TimeProvider? clock = null) =>
        new(session, async request => request.Operation == "status"
            ? new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: Broker, PowerStatusVersion: 1)
            : (await sender(request)) with { BrokerInstanceId = Broker }, clock);
    private static JsonElement Schedule(string id, string action = "shutdown") => JsonSerializer.SerializeToElement(new {
        requestId = id, action, delaySeconds = 10, authorization = new { kind = "api" }
    });
    private static JsonElement Id(string id) => JsonSerializer.SerializeToElement(new { requestId = id });
    private static HttpResponseMessage Ok(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };
    private static async Task<HttpResponseMessage> Allowed(HttpRequestMessage request)
    {
        var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync()).RootElement;
        return Ok(new { action = body.GetProperty("action").GetString(), decision = "allowed", code = "within_tolerance",
            @override = false, unlockedUntil = (object?)null, analysis = new { } });
    }
    private static ControlResponse Cancelled(ControlRequest request) => new("cancelled", "fixture", RequestId: request.RequestId, Cancelled: true);
    private static ControlResponse Scheduled(ControlRequest request) => new("scheduled", "fixture", RequestId: request.RequestId,
        Action: request.Action, ExecuteAt: DateTimeOffset.UtcNow.AddSeconds(10));
    private static async Task<ApiSession> Session(string root, string name, Func<HttpRequestMessage, Task<HttpResponseMessage>>? decision = null)
    {
        var session = new ApiSession(new Uri("https://bridge-fixture.invalid"), new Handler(request => request.RequestUri!.AbsolutePath switch {
            "/api/v1/auth/login" => Task.FromResult(Ok(new {
                accessToken = "fixture-access", refreshToken = "fixture-refresh", accessTokenExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
                refreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(1), user = new { id = UserId, role = "user" }
            })),
            "/api/v1/me" => Task.FromResult(Ok(new { id = UserId, role = "user" })),
            _ => (decision ?? Allowed)(request)
        }), Path.Combine(root, "bridge-" + name));
        await session.Execute("login", JsonSerializer.SerializeToElement(new { email = "fixture@example.invalid", password = "fixture-only" }));
        return session;
    }
    private static async Task Failure(Task operation, string code, Action<bool, string> check)
    {
        try { await operation; }
        catch (PowerBridgeFailure error) { check(error.Code == code, $"Expected {code}, got {error.Code}"); return; }
        throw new InvalidOperationException("Expected power bridge rejection: " + code);
    }

    internal static async Task Run(Action<bool, string> check, string root)
    {
        await DiscoveryChecks(check, root);
        await RecoveryChecks(check, root);
        // Pre-dispatch cancellation owns the request while API authorization is awaiting.
        var authorized = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using (var session = await Session(root, "pre-dispatch", async request => {
            entered.TrySetResult();
            return await authorized.Task;
        }))
        {
            var commands = new List<ControlRequest>();
            var host = Host(session, request => {
                commands.Add(request);
                return Task.FromResult(request.Operation == "cancel" ? Cancelled(request) : Scheduled(request));
            });
            var id = Guid.NewGuid().ToString();
            var scheduling = host.Execute("schedule", Schedule(id));
            await entered.Task;
            var status = JsonSerializer.SerializeToElement(await host.Execute("reconcile", Id(id)));
            check(status.GetProperty("state").GetString() == "pending" && commands.Count == 0, "Pre-dispatch status must not overtake schedule IPC");
            var lease = await host.QuiesceAsync();
            check(commands.Count == 1 && commands[0].Operation == "cancel" && commands[0].RequestId == id, "Quiescence lost the pre-dispatch request ID");
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_recovery_in_progress", check);
            authorized.SetResult(Ok(new { action = "shutdown", decision = "allowed", code = "within_tolerance", @override = false,
                unlockedUntil = (object?)null, analysis = new { } }));
            await Failure(scheduling, "power_request_cancelled", check);
            check(commands.All(command => command.Operation != "schedule") && !host.SessionEndingAllowed, "Cancelled authorization dispatched a late action");
            await lease.DisposeAsync();
            await lease.DisposeAsync();
        }

        // A late schedule acknowledgment cannot resurrect cancellation or replace a newer request.
        var cancelledAuthorization = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        using (var session = await Session(root, "cancel-tombstone", _ => cancelledAuthorization.Task))
        {
            var statusCalls = 0;
            var scheduleCalls = 0;
            var host = Host(session, request => {
                if (request.Operation == "cancel") throw new IOException("Fixture cancel acknowledgment lost");
                if (request.Operation == "power-status") { statusCalls++; return Task.FromResult(Cancelled(request)); }
                scheduleCalls++;
                return Task.FromResult(Scheduled(request));
            });
            var id = Guid.NewGuid().ToString();
            var scheduling = host.Execute("schedule", Schedule(id));
            await Failure(host.CancelCurrent(), "native_power_uncertain", check);
            var state = JsonSerializer.SerializeToElement(await host.Execute("reconcile", Id(id)));
            check(state.GetProperty("state").GetString() == "terminal" && statusCalls == 1, "A lost pre-dispatch cancel acknowledgment must be reconciled with its service tombstone");
            cancelledAuthorization.SetResult(Ok(new { action = "shutdown", decision = "allowed", code = "within_tolerance", @override = false,
                unlockedUntil = (object?)null, analysis = new { } }));
            await Failure(scheduling, "power_request_cancelled", check);
            await using (await host.QuiesceAsync()) { check(scheduleCalls == 0, "Reconciled pre-dispatch cancellation reached the service schedule"); }
        }

        using (var session = await Session(root, "late-reply"))
        {
            var dispatched = new TaskCompletionSource<ControlRequest>(TaskCreationOptions.RunContinuationsAsynchronously);
            var reply = new TaskCompletionSource<ControlResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
            var first = true;
            var host = Host(session, request => {
                if (request.Operation == "cancel") return Task.FromResult(Cancelled(request));
                if (!first) return Task.FromResult(Scheduled(request));
                first = false;
                dispatched.SetResult(request);
                return reply.Task;
            });
            var scheduling = host.Execute("schedule", Schedule(Guid.NewGuid().ToString()));
            var old = await dispatched.Task;
            await using (await host.QuiesceAsync()) { check(!host.SessionEndingAllowed, "Unconfirmed dispatch must not permit session ending"); }
            await host.Execute("schedule", Schedule(Guid.NewGuid().ToString(), "restart"));
            reply.SetResult(Scheduled(old));
            await Failure(scheduling, "power_request_cancelled", check);
            check(host.SessionEndingAllowed, "Stale completion discarded the newer confirmed schedule");
            await host.CancelCurrent();
            check(!host.SessionEndingAllowed, "Confirmed cancellation retained session-ending permission");
        }

        // IPC cancellation uncertainty retains identity and permanently closes dispatch until retry.
        using (var session = await Session(root, "uncertain-cancel"))
        {
            var commands = new List<ControlRequest>();
            var confirm = false;
            var host = Host(session, request => {
                commands.Add(request);
                return Task.FromResult(request.Operation == "cancel"
                    ? confirm ? Cancelled(request) : new ControlResponse("cancelled", "fixture", RequestId: Guid.NewGuid().ToString(), Cancelled: true)
                    : Scheduled(request));
            });
            var id = Guid.NewGuid().ToString();
            await host.Execute("schedule", Schedule(id));
            await Failure(host.CancelCurrent(), "native_power_uncertain", check);
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_recovery_in_progress", check);
            confirm = true;
            await using (await host.QuiesceAsync()) {
                check(commands.Where(command => command.Operation == "cancel").All(command => command.RequestId == id), "Retry must retain exact uncertain request ID");
                await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_recovery_in_progress", check);
            }
            await host.Execute("schedule", Schedule(Guid.NewGuid().ToString(), "hibernate"));
            check(!host.SessionEndingAllowed, "Hibernate must not permit Windows session ending");
            await host.CancelCurrent();
        }

        // Lost scheduling replies remain visible to recovery; cancel-before-schedule uses the same ID.
        using (var session = await Session(root, "lost-reply"))
        {
            string? cancelledId = null;
            var host = Host(session, request => {
                if (request.Operation == "schedule") throw new IOException("Fixture lost reply after dispatch");
                cancelledId = request.RequestId;
                return Task.FromResult(Cancelled(request));
            });
            var id = Guid.NewGuid().ToString();
            try { await host.Execute("schedule", Schedule(id)); throw new InvalidOperationException("Lost reply was accepted"); }
            catch (IOException) { }
            await host.CancelCurrent();
            check(cancelledId == id, "Recovery forgot a request whose service reply was lost");
        }

        // Status, not renderer wall-clock expiry, releases a confirmed hibernate action.
        using (var session = await Session(root, "terminal"))
        {
            var terminal = false;
            var host = Host(session, request => Task.FromResult(request.Operation switch {
                "cancel" => Cancelled(request),
                "power-status" => terminal
                    ? new ControlResponse("not_pending", "fixture", RequestId: request.RequestId)
                    : new ControlResponse("pending", "fixture", RequestId: request.RequestId, Action: "hibernate", ExecuteAt: DateTimeOffset.UtcNow.AddSeconds(10)),
                _ => Scheduled(request)
            }));
            var id = Guid.NewGuid().ToString();
            await host.Execute("schedule", Schedule(id, "hibernate"));
            var pending = JsonSerializer.SerializeToElement(await host.Execute("reconcile", Id(id)));
            check(pending.GetProperty("state").GetString() == "pending", "Status cleared a pending service action");
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "native_power_uncertain", check);
            terminal = true;
            var ended = JsonSerializer.SerializeToElement(await host.Execute("reconcile", Id(id)));
            check(ended.GetProperty("state").GetString() == "terminal", "Terminal service state was not reconciled");
            await host.Execute("schedule", Schedule(Guid.NewGuid().ToString()));
            await host.CancelCurrent();
        }

        using (var session = await Session(root, "leases"))
        {
            var host = Host(session, request => Task.FromResult(request.Operation == "cancel" ? Cancelled(request) : Scheduled(request)));
            var first = await host.QuiesceAsync();
            var second = await host.QuiesceAsync();
            await first.DisposeAsync();
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_recovery_in_progress", check);
            await second.DisposeAsync();
            await host.Execute("schedule", Schedule(Guid.NewGuid().ToString()));
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            try { await host.QuiesceAsync(cancelled.Token); throw new InvalidOperationException("Cancelled recovery proceeded"); }
            catch (OperationCanceledException) { }
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_recovery_in_progress", check);
            await host.CancelCurrent();
            foreach (var malformed in new[] { "null", "{}", "{\"requestId\":12}", "{\"requestId\":\"" + Guid.NewGuid() + "\",\"action\":\"shutdown\",\"delaySeconds\":\"10\"}" })
                await Failure(host.Execute("schedule", JsonDocument.Parse(malformed).RootElement), "invalid_power_request", check);
        }

        // Terminal status can precede WM_QUERYENDSESSION. Allow only a finite grace
        // for the confirmed shutdown/restart, never hibernate or canceled recovery.
        using (var session = await Session(root, "ending-grace"))
        {
            var clock = new Clock(DateTimeOffset.Parse("2026-10-04T23:00:00Z"));
            var host = Host(session, request => Task.FromResult(request.Operation switch {
                "cancel" => Cancelled(request),
                "power-status" => new ControlResponse("not_pending", "fixture", RequestId: request.RequestId),
                _ => new ControlResponse("scheduled", "fixture", RequestId: request.RequestId, Action: request.Action, ExecuteAt: clock.GetUtcNow().AddSeconds(10))
            }), clock);
            var id = Guid.NewGuid().ToString();
            await host.Execute("schedule", Schedule(id));
            clock.Advance(TimeSpan.FromSeconds(11));
            await host.Execute("reconcile", Id(id));
            check(host.SessionEndingAllowed, "Terminal status vetoed the authorized Windows shutdown");
            clock.UtcNow = clock.UtcNow.AddYears(-20);
            clock.Advance(TimeSpan.FromSeconds(60));
            check(!host.SessionEndingAllowed, "Session-ending permission did not expire after its bounded grace");
            id = Guid.NewGuid().ToString();
            await host.Execute("schedule", Schedule(id, "restart"));
            await host.Execute("cancel", Id(id));
            check(!host.SessionEndingAllowed, "Confirmed cancellation retained Windows ending grace");
            await host.Execute("schedule", Schedule(Guid.NewGuid().ToString(), "hibernate"));
            check(!host.SessionEndingAllowed, "Hibernate opened Windows ending grace");
            await host.CancelCurrent();
        }

        // A restarted broker must not claim it canceled a predecessor's Windows
        // action merely because its own in-memory pending state is empty.
        using (var session = await Session(root, "broker-change"))
        {
            var broker = Broker;
            var scheduled = 0;
            var cancellations = 0;
            var host = new PowerBridgeHandler(session, request => {
                var result = request.Operation switch {
                    "status" => new ControlResponse("ready", "fixture", Active: true, PowerStatusVersion: 1),
                    "cancel" => Cancelled(request),
                    "power-status" => new ControlResponse("not_pending", "fixture", RequestId: request.RequestId),
                    _ => Scheduled(request)
                };
                if (request.Operation == "schedule") scheduled++;
                if (request.Operation == "cancel") cancellations++;
                return Task.FromResult(result with { BrokerInstanceId = broker });
            });
            var id = Guid.NewGuid().ToString();
            await host.Execute("schedule", Schedule(id));
            broker = Guid.NewGuid().ToString();
            await Failure(host.Execute("cancel", Id(id)), "native_power_uncertain", check);
            await Failure(host.Execute("reconcile", Id(id)), "native_power_uncertain", check);
            var beforeRecovery = cancellations;
            await Failure(host.CancelCurrent(), "power_recovery_required", check);
            check(cancellations == beforeRecovery, "Lifecycle recovery automatically canceled a request inherited from another broker");
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_recovery_in_progress", check);
            check(scheduled == 1, "Broker change replayed a scheduled action or discarded uncertainty");
            broker = Broker;
            await host.Execute("cancel", Id(id));
            await host.CancelCurrent();
        }
        using (var session = await Session(root, "broker-missing"))
        {
            var calls = new List<string>();
            var host = new PowerBridgeHandler(session, request => {
                calls.Add(request.Operation);
                return Task.FromResult(new ControlResponse("ready", "fixture", Active: true));
            });
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_service_changed", check);
            check(calls.SequenceEqual(new[] { "status" }), "Host dispatched to a broker without negotiated identity");
        }
        using (var session = await Session(root, "broker-durable-proof"))
        {
            var broker = Broker;
            var original = Broker;
            var code = "not_pending";
            var cancelled = true;
            var host = new PowerBridgeHandler(session, request => Task.FromResult(request.Operation switch {
                "status" => new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: broker, PowerStatusVersion: 1),
                "schedule" => Scheduled(request) with { BrokerInstanceId = broker },
                _ => new ControlResponse(code, "fixture", RequestId: request.RequestId, Cancelled: cancelled,
                    BrokerInstanceId: broker, OriginalBrokerInstanceId: original)
            }));
            var id = Guid.NewGuid().ToString();
            await host.Execute("schedule", Schedule(id));
            broker = Guid.NewGuid().ToString();
            await Failure(host.Execute("reconcile", Id(id)), "native_power_uncertain", check);
            code = "cancelled";
            cancelled = false;
            await Failure(host.Execute("cancel", Id(id)), "native_power_uncertain", check);
            cancelled = true;
            original = Guid.NewGuid().ToString();
            await Failure(host.Execute("cancel", Id(id)), "native_power_uncertain", check);
            original = Broker;
            await host.Execute("cancel", Id(id));
            check(!host.SessionEndingAllowed, "Durably confirmed cancellation retained ending permission");
            id = Guid.NewGuid().ToString();
            await host.Execute("schedule", Schedule(id));
            original = broker;
            broker = Guid.NewGuid().ToString();
            var terminal = JsonSerializer.SerializeToElement(await host.Execute("reconcile", Id(id)));
            check(terminal.GetProperty("state").GetString() == "terminal" && !host.SessionEndingAllowed,
                "Confirmed journal cancellation for the original broker did not reconcile terminal state");
        }
    }

    private static async Task RecoveryChecks(Action<bool, string> check, string root)
    {
        foreach (var lifecycleFirst in new[] { false, true })
        using (var session = await Session(root, "new-host-" + lifecycleFirst, _ =>
            throw new InvalidOperationException("Inherited request must not trigger API authorization")))
        {
            var inheritedId = Guid.NewGuid().ToString();
            var replacementBroker = Guid.NewGuid().ToString();
            var commands = new List<ControlRequest>();
            var recovered = true;
            var host = new PowerBridgeHandler(session, request => {
                commands.Add(request);
                if (request.Operation == "status") return Task.FromResult(recovered
                    ? new ControlResponse("power_uncertain", "fixture", Active: true, RequestId: inheritedId,
                        Action: "restart", BrokerInstanceId: replacementBroker, OriginalBrokerInstanceId: Broker, PowerStatusVersion: 1)
                    : new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: replacementBroker, PowerStatusVersion: 1));
                check(request.Operation == "cancel" && request.RequestId == inheritedId && request.BrokerInstanceId == Broker,
                    "New host must cancel exactly the inherited request with its original broker identity");
                recovered = false;
                return Task.FromResult(Cancelled(request) with { BrokerInstanceId = replacementBroker, OriginalBrokerInstanceId = Broker });
            });
            try
            {
                if (lifecycleFirst) await host.QuiesceAsync();
                else await host.Execute("schedule", Schedule(Guid.NewGuid().ToString()));
                throw new InvalidOperationException("New host discarded inherited uncertainty");
            }
            catch (PowerBridgeFailure error)
            {
                check(error.Code == "power_recovery_required" && error.RequestId == inheritedId,
                    "Recovery failure must identify the inherited request, never the new renderer request");
            }
            check(commands.All(command => command.Operation == "status") && !host.SessionEndingAllowed,
                "New host replayed or implicitly canceled an inherited action");
            await host.Execute("cancel", Id(inheritedId));
            await using var lease = await host.QuiesceAsync();
            check(!host.SessionEndingAllowed && commands.Count(command => command.Operation == "cancel") == 1,
                "Explicit durable cancellation did not release lifecycle recovery");
        }
        using (var session = await Session(root, "foreign-inherited", _ =>
            throw new InvalidOperationException("Foreign recovery must not call the API")))
        {
            var commands = new List<ControlRequest>();
            var host = new PowerBridgeHandler(session, request => {
                commands.Add(request);
                return Task.FromResult(new ControlResponse("power_uncertain", "fixture", BrokerInstanceId: Broker, PowerStatusVersion: 1));
            });
            await Failure(host.Execute("schedule", Schedule(Guid.NewGuid().ToString())), "power_uncertain", check);
            await Failure(host.QuiesceAsync(), "power_uncertain", check);
            check(commands.All(command => command.Operation == "status") && !host.SessionEndingAllowed,
                "Foreign inherited state dispatched an action or leaked a cancellation identity");
        }
    }

    private static async Task DiscoveryChecks(Action<bool, string> check, string root)
    {
        foreach (var code in new[] { "ready", "power_uncertain" })
        foreach (var authenticated in new[] { false, true })
        {
            using var session = authenticated ? await Session(root, "discover-" + code) :
                new ApiSession(new Uri("https://bridge-fixture.invalid"), new Handler(_ => throw new Exception("Discovery must not use API")), Path.Combine(root, "no-login-" + code));
            var id = Guid.NewGuid().ToString();
            var commands = new List<string>();
            var pending = true;
            var host = new PowerBridgeHandler(session, request =>
            {
                commands.Add(request.Operation);
                if (request.Operation == "status") return Task.FromResult(pending
                    ? new ControlResponse(code, "fixture", Active: true, RequestId: id, Action: "restart", ExecuteAt: DateTimeOffset.UtcNow.AddSeconds(10),
                        BrokerInstanceId: Broker, OriginalBrokerInstanceId: Broker, PowerStatusVersion: 1)
                    : new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: Broker, PowerStatusVersion: 1));
                check(request.Operation == "cancel" && request.RequestId == id && request.BrokerInstanceId == Broker, "Discovery cancellation preserves native owner/broker");
                pending = false;
                return Task.FromResult(Cancelled(request) with { BrokerInstanceId = Broker });
            });
            await Failure(host.QuiesceAsync(), "power_recovery_required", check);
            var result = JsonSerializer.SerializeToElement(await host.Execute("status", JsonSerializer.SerializeToElement(new { })));
            check(result.GetProperty("requestId").GetString() == id && result.GetProperty("recovered").GetBoolean(), "Recovered pending reaches status without API login/authorization");
            check(!result.TryGetProperty("sid", out _) && !result.TryGetProperty("brokerInstanceId", out _) && commands.All(x => x == "status"), "Discovery must not disclose SID/broker or trigger effects");
            await host.Execute("cancel", Id(id));
            await using var lease = await host.QuiesceAsync();
            check(commands.Count(x => x == "cancel") == 1, "Only the explicit gesture cancels recovery");
        }
        using var noLogin = new ApiSession(new Uri("https://bridge-fixture.invalid"), new Handler(_ => throw new Exception("No API")), Path.Combine(root, "discovery-invalid"));
        foreach (var version in new int?[] { null, 0, 2 })
        {
            var host = new PowerBridgeHandler(noLogin, _ => Task.FromResult(new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: Broker, PowerStatusVersion: version)));
            await Failure(host.Execute("status", JsonSerializer.SerializeToElement(new { })), "power_service_changed", check);
            await Failure(host.QuiesceAsync(), "power_service_changed", check);
        }
        var foreign = new PowerBridgeHandler(noLogin, _ => Task.FromResult(new ControlResponse("power_uncertain", "fixture", BrokerInstanceId: Broker, PowerStatusVersion: 1)));
        var unavailable = JsonSerializer.SerializeToElement(await foreign.Execute("status", JsonSerializer.SerializeToElement(new { })));
        check(unavailable.GetProperty("state").GetString() == "unavailable" && !unavailable.TryGetProperty("requestId", out _), "Another SID's request has no cancellation identifier");
        await Failure(foreign.Execute("status", Id(Guid.NewGuid().ToString())), "invalid_power_request", check);
        var invalid = new PowerBridgeHandler(noLogin, _ => Task.FromResult(new ControlResponse("ready", "fixture", RequestId: "invalid", BrokerInstanceId: Broker, PowerStatusVersion: 1)));
        await Failure(invalid.Execute("status", JsonSerializer.SerializeToElement(new { })), "power_service_invalid_response", check);
        await Failure(invalid.QuiesceAsync(), "power_service_invalid_response", check);
        foreach (var code in new[] { "service_error", "power_storage_unavailable", "access_denied" })
        {
            var errorHost = new PowerBridgeHandler(noLogin, _ => Task.FromResult(new ControlResponse(code, "fixture", BrokerInstanceId: Broker, PowerStatusVersion: 1)));
            await Failure(errorHost.Execute("status", JsonSerializer.SerializeToElement(new { })), code, check);
            await Failure(errorHost.QuiesceAsync(), code, check);
        }
        using var lateSession = await Session(root, "discovery-late");
        var delayed = new TaskCompletionSource<ControlResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        var statusCalls = 0;
        var lateId = Guid.NewGuid().ToString();
        var lateHost = new PowerBridgeHandler(lateSession, request =>
        {
            if (request.Operation == "status") return ++statusCalls == 1 ? delayed.Task :
                Task.FromResult(new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: Broker, PowerStatusVersion: 1));
            return Task.FromResult((request.Operation == "cancel" ? Cancelled(request) : Scheduled(request)) with { BrokerInstanceId = Broker });
        });
        var lateStatus = lateHost.Execute("status", JsonSerializer.SerializeToElement(new { }));
        await lateHost.Execute("schedule", Schedule(lateId));
        await lateHost.Execute("cancel", Id(lateId));
        delayed.SetResult(new ControlResponse("ready", "fixture", RequestId: lateId, Action: "restart", BrokerInstanceId: Broker,
            OriginalBrokerInstanceId: Broker, PowerStatusVersion: 1));
        var stale = JsonSerializer.SerializeToElement(await lateStatus);
        check(stale.GetProperty("state").GetString() == "unavailable" && !stale.TryGetProperty("requestId", out _),
            "Late discovery cannot resurrect a cancelled request");
        await lateHost.Execute("schedule", Schedule(Guid.NewGuid().ToString()));
        var known = JsonSerializer.SerializeToElement(await lateHost.Execute("status", JsonSerializer.SerializeToElement(new { })));
        check(!known.GetProperty("recovered").GetBoolean(), "Known live host request must retain its normal cancellation behavior");
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        private long timestamp;
        internal DateTimeOffset UtcNow { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => UtcNow;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => timestamp;
        internal void Advance(TimeSpan elapsed) { UtcNow += elapsed; timestamp += elapsed.Ticks; }
    }

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }
}
