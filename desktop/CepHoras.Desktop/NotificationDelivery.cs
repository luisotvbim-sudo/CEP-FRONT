using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;

namespace CepHoras.Desktop;

/// <summary>One durable receipt ledger per API and account; never stores tokens or message bodies.</summary>
internal sealed class NotificationDelivery(ApiSession session)
{
    private bool running;
    private DateTimeOffset lastPopup;
    private int queuedCount;
    private Guid? queuedUser;

    public async Task Poll(Action<int> showSummary)
    {
        if (running || session.CurrentUserId is not { } userId) return;
        running = true;
        try
        {
            if (queuedUser != userId) { queuedCount = 0; lastPopup = default; queuedUser = userId; }
            var store = new ProtectedJsonFile(session.NotificationStorePath(userId));
            var known = store.Exists ? await store.ReadAsync<HashSet<Guid>>() ?? [] : [];
            var pending = new HashSet<Guid>();
            for (var page = 1; ; page++)
            {
                // Do not acknowledge until all pages are collected: doing so shifts later pages.
                var result = await session.NotificationRequest("GET", $"/me/notifications?pendingOnly=true&page={page}&pageSize=100");
                if (session.CurrentUserId != userId) return;
                var items = result.GetProperty("items");
                foreach (var item in items.EnumerateArray()) pending.Add(item.GetProperty("id").GetGuid());
                if (items.GetArrayLength() == 0 || (long)page * 100 >= result.GetProperty("total").GetInt32()) break;
            }
            var fresh = pending.Count(id => !known.Contains(id));
            known.UnionWith(pending);
            if (pending.Count > 0)
            {
                await store.WriteAsync(known);
                queuedCount += fresh;
                foreach (var ids in pending.Chunk(100))
                {
                    if (session.CurrentUserId != userId) return;
                    await session.NotificationRequest("POST", "/me/notifications/received", new { ids });
                }
            }
            // Group startup backlog and throttle nearby manual/scheduled arrivals to one popup.
            if (queuedCount > 0 && DateTimeOffset.UtcNow - lastPopup >= TimeSpan.FromMinutes(5) && session.CurrentUserId == userId)
            {
                showSummary(queuedCount);
                queuedCount = 0;
                lastPopup = DateTimeOffset.UtcNow;
            }
        }
        catch (Exception exception) when (exception is ApiFailure or HttpRequestException or TaskCanceledException or IOException or CryptographicException or JsonException or InvalidOperationException or KeyNotFoundException or UnauthorizedAccessException)
        {
            // Keep the inbox and pending receipts intact. A later tick retries without a popup storm.
        }
        finally { running = false; }
    }
}
