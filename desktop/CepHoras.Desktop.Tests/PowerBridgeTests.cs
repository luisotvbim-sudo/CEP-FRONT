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
            ? new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: Broker)
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
                    "status" => new ControlResponse("ready", "fixture", Active: true),
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
                "status" => new ControlResponse("ready", "fixture", Active: true, BrokerInstanceId: broker),
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
