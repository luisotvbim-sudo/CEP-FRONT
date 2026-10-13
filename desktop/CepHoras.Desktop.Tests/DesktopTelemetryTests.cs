using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using CepHoras.Desktop;

internal static class DesktopTelemetryTests
{
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => send(request);
    }

    private static HttpResponseMessage Ok(object body) => new(HttpStatusCode.OK) { Content = JsonContent.Create(body) };

    internal static async Task Run(Action<bool, string> check, string directory)
    {
        var userId = Guid.NewGuid();
        var installationId = Guid.NewGuid();
        var online = false;
        var delivered = new List<Guid>();
        var telemetryCalls = 0;
        var partialAck = false;
        var reject = false;
        var forbidden = false;
        using var session = new ApiSession(new Uri("https://telemetry-fixture.invalid"),
            new Handler(async request =>
            {
                switch (request.RequestUri!.AbsolutePath)
                {
                    case "/api/v1/auth/login":
                        return Ok(new { accessToken = "fixture-access", refreshToken = "fixture-refresh",
                            accessTokenExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
                            refreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(1), user = new { id = userId, role = "user" } });
                    case "/api/v1/me": return Ok(new { id = userId, role = "user" });
                    case "/api/v1/desktop-telemetry/events":
                        telemetryCalls++;
                        check(request.Headers.Authorization?.Scheme == "Bearer", "Telemetry must use native bearer token");
                        if (forbidden) return new HttpResponseMessage(HttpStatusCode.Forbidden);
                        if (!online) throw new HttpRequestException("fixture-offline");
                        using (var payload = JsonDocument.Parse(await request.Content!.ReadAsStringAsync()))
                        {
                            var events = payload.RootElement.GetProperty("events");
                            check(events.GetArrayLength() is 1 or 2, "Unexpected telemetry batch size");
                            var item = events[0];
                            check(item.GetProperty("installationId").GetGuid() == installationId, "Installation identity changed");
                            check(item.GetProperty("operationId").ValueKind == JsonValueKind.String, "Power operation correlation was lost");
                            check(item.GetProperty("code").GetString() == "power_schedule_confirmed", "Unexpected telemetry code");
                            var id = item.GetProperty("eventId").GetGuid();
                            delivered.Add(id);
                            return Ok(new {
                                acceptedEventIds = reject ? Array.Empty<Guid>() : partialAck ? new[] { id } : events.EnumerateArray().Select(e => e.GetProperty("eventId").GetGuid()).ToArray(),
                                rejectedEventIds = reject ? new[] { id } : Array.Empty<Guid>()
                            });
                        }
                    default: throw new InvalidOperationException("Unexpected fixture route: " + request.RequestUri.AbsolutePath);
                }
            }), Path.Combine(directory, "telemetry-session"));
        await session.Execute("login", JsonSerializer.SerializeToElement(new { email = "fixture@example.invalid", password = "fixture" }));
        check(!ApiRoutePolicy.Allows("POST", "/desktop-telemetry/events"), "Renderer gained direct telemetry route");
        try
        {
            await session.Execute("api", JsonSerializer.SerializeToElement(new { method = "POST", path = "/desktop-telemetry/events", body = new { events = Array.Empty<object>() } }));
            throw new InvalidOperationException("Renderer telemetry call was accepted");
        }
        catch (ApiFailure failure) { check(failure.Code == "unsupported_route", "Wrong bridge rejection"); }

        var telemetry = new DesktopTelemetry(session, true, "0.4.20", installationId);
        var operationId = Guid.NewGuid();
        await telemetry.RecordDurableAsync("power_schedule_confirmed", "schedule", "success", "shutdown", operationId: operationId);
        var file = session.TelemetryStorePath(userId);
        check(File.Exists(file), "Confirmed schedule was not durably queued");
        var ciphertext = await File.ReadAllBytesAsync(file);
        check(!Encoding.UTF8.GetString(ciphertext).Contains("power_schedule_confirmed"), "Telemetry journal is plaintext");
        var queued = (await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!;
        check(queued.Count == 1 && queued[0].OperationId == operationId, "Queued operation ID changed");
        var eventId = queued[0].EventId;
        await telemetry.FlushAsync(); // Transport failure retains the event.
        for (var attempt = 0; telemetryCalls == 0 && attempt < 40; attempt++)
        {
            await Task.Delay(25);
            await telemetry.FlushAsync();
        }
        check(telemetryCalls > 0, "Offline transport attempt did not run");
        queued = (await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!;
        check(queued.Count == 1 && queued[0].EventId != Guid.Empty, "Offline retry lost the event");
        online = true;
        for (var attempt = 0; attempt < 40; attempt++)
        {
            await telemetry.FlushAsync();
            queued = (await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!;
            if (queued.Count == 0) break;
            await Task.Delay(25);
        }
        check(queued.Count == 0 && delivered.Count == 1 && delivered[0] == eventId, "ACK did not remove the persisted event by ID");
        check(telemetryCalls >= 2, "Offline retry was not attempted");

        online = false;
        await telemetry.RecordDurableAsync("power_schedule_confirmed", "schedule", "success", "shutdown", operationId: Guid.NewGuid());
        await telemetry.RecordDurableAsync("power_schedule_confirmed", "schedule", "success", "restart", operationId: Guid.NewGuid());
        await Task.Delay(100); // Let the automatic offline sends finish before the partial ACK.
        queued = (await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!;
        check(queued.Count == 2, "Two offline events were not queued");
        var secondId = queued[1].EventId;
        partialAck = true;
        online = true;
        for (var attempt = 0; attempt < 40; attempt++)
        {
            await telemetry.FlushAsync();
            queued = (await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!;
            if (queued.Count == 1) break;
            await Task.Delay(25);
        }
        check(queued.Count == 1 && queued[0].EventId == secondId, "Partial ACK discarded an unaccepted event");
        partialAck = false;
        await telemetry.FlushAsync();
        check((await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!.Count == 0, "Remaining event was not retried");

        var stale = new DesktopTelemetryEvent(Guid.NewGuid(), installationId, DateTimeOffset.UtcNow.AddDays(-31),
            "power_schedule_confirmed", "shutdown", "schedule", "success", "none", "0.4.20", Guid.NewGuid());
        var fresh = stale with { EventId = Guid.NewGuid(), OccurredAt = DateTimeOffset.UtcNow };
        await new ProtectedJsonFile(file).WriteAsync(new List<DesktopTelemetryEvent> { stale, fresh });
        await telemetry.FlushAsync();
        check((await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!.Count == 0 &&
            delivered.Last() == fresh.EventId, "Expired head blocked a newer valid event");

        reject = true;
        var invalid = fresh with { EventId = Guid.NewGuid(), OccurredAt = DateTimeOffset.UtcNow };
        await new ProtectedJsonFile(file).WriteAsync(new List<DesktopTelemetryEvent> { invalid });
        await telemetry.FlushAsync();
        check((await new ProtectedJsonFile(file).ReadAsync<List<DesktopTelemetryEvent>>())!.Count == 0,
            "Explicitly rejected event poisoned the queue");

        reject = false;
        forbidden = true;
        await new ProtectedJsonFile(file).WriteAsync(new List<DesktopTelemetryEvent> { fresh with { EventId = Guid.NewGuid() } });
        var beforeForbidden = telemetryCalls;
        await telemetry.FlushAsync();
        await telemetry.FlushAsync();
        check(telemetryCalls == beforeForbidden + 1, "403 should suspend account retries for this process");
    }
}
