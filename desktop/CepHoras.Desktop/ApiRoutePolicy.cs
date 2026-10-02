using System.Text.RegularExpressions;

namespace CepHoras.Desktop;

// This is the native trust boundary; UI routing is not authorization.
internal static class ApiRoutePolicy
{
    public static bool Allows(string method, string path)
    {
        if (path.Contains('\\') || path.Contains('#')) return false;
        var route = path.Split('?')[0];
        if (path == "/me/time-control/power-action-unlock" && method == "POST") return true;
        if (route == "/me/time-control/power-action-check" && method == "POST") return true;
        if (route == "/me/time-control/power-action-status" && method == "GET") return true;
        if (route == "/time-control/settings" && method is "GET" or "PATCH") return true;
        if (route == "/time-control/notification-schedules" && method is "GET" or "POST") return true;
        if (Regex.IsMatch(route, "^/time-control/notification-schedules/[0-9a-fA-F-]{36}$") && method is "PATCH" or "DELETE") return true;
        if (route == "/me/notifications" && method == "GET") return true;
        if (method == "POST" && (route == "/me/notifications/received" || Regex.IsMatch(route, "^/me/notifications/[0-9a-fA-F-]{36}/read$"))) return true;
        if (route == "/admin/organizations" && method is "GET" or "POST") return true;
        if (method == "GET" && route is "/me" or "/organization/users" or "/organization/invitations" or "/organization/audit") return true;
        if (method == "POST" && route == "/organization/invitations") return true;
        if (method == "PATCH" && route.StartsWith("/organization/users/", StringComparison.Ordinal) &&
            Guid.TryParseExact(route["/organization/users/".Length..], "D", out _)) return true;
        if (method == "POST" && Regex.IsMatch(route, "^/organization/invitations/[0-9a-fA-F-]{36}/resend$")) return true;
        const string prefix = "/organization/time-control/";
        if (!route.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var relative = route[prefix.Length..];
        const string id = "[0-9a-fA-F-]{36}";
        return method switch
        {
            "GET" => relative is "people" or "external-identities" or "history" or "teams" or "synchronizations/latest" or "analyses" or "notification-dispatches" or "notification-dispatches/preview" || Regex.IsMatch(relative, $"^(synchronizations/{id}|teams/{id}(/assignments)?)$"),
            "POST" => relative is "people/invitations" or "synchronizations" or "teams" or "notification-dispatches" || Regex.IsMatch(relative, $"^teams/{id}/assignments$"),
            "PATCH" => Regex.IsMatch(relative, $"^teams/{id}(/assignments/{id}/end)?$"),
            _ => false
        };
    }

}
