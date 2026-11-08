// ── Session tokens — byte-for-byte compatible with src/lib/session.ts ──
// Format: base64url(JSON {uid, exp}) + "." + HMAC-SHA256(payload) in
// base64url. Same cookie name, same dev fallback secret, same 30-day
// lifetime, same timing-safe verification — a cookie minted by either
// side validates on both, so the frontend session survives the backend
// language change untouched.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StreamRoots.Api.Security;

public class SessionPrincipal
{
    public string UserId { get; init; } = "";
    public string Email { get; init; } = "";
    public string Name { get; init; } = "";
    public string Role { get; init; } = "";
}

public static class SessionToken
{
    public const string CookieName = "sr_session";
    private const int MaxAgeSeconds = 60 * 60 * 24 * 30;
    private static readonly string Secret =
        Environment.GetEnvironmentVariable("AUTH_SECRET") ?? "streamroots-dev-secret-change-me";

    private static byte[] Sign(string payload)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(Secret));
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
    }

    private static string B64Url(byte[] bytes) => Convert.ToBase64String(bytes)
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Create(string userId)
    {
        var payload = JsonSerializer.Serialize(new { uid = userId, exp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + MaxAgeSeconds * 1000L });
        var b64 = B64Url(Encoding.UTF8.GetBytes(payload));
        return $"{b64}.{B64Url(Sign(b64))}";
    }

    public static string? ReadUserId(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var parts = token.Split('.', 2);
        if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0) return null;
        var expected = Sign(parts[0]);
        var actual = Base64UrlDecode(parts[1]);
        if (actual == null || !CryptographicOperations.FixedTimeEquals(expected, actual)) return null;
        try
        {
            var json = Encoding.UTF8.GetString(Base64UrlDecode(parts[0])!);
            using var doc = JsonDocument.Parse(json);
            var uid = doc.RootElement.GetProperty("uid").GetString();
            var exp = doc.RootElement.GetProperty("exp").GetInt64();
            if (string.IsNullOrEmpty(uid) || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > exp) return null;
            return uid;
        }
        catch { return null; }
    }

    private static byte[]? Base64UrlDecode(string s)
    {
        try
        {
            var padded = s.Replace('-', '+').Replace('_', '/');
            return Convert.FromBase64String(padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '='));
        }
        catch { return null; }
    }

    // Resolves the caller from the sr_session cookie (direct browser calls)
    // or an Authorization: Bearer header (the Next.js server-action proxy).
    public static async Task<SessionPrincipal?> ResolvePrincipalAsync(
        Data.AppDbContext db, HttpRequest req)
    {
        string? token = null;
        if (req.Headers.TryGetValue("Authorization", out var auth))
        {
            var v = auth.ToString();
            if (v.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) token = v[7..].Trim();
        }
        token ??= req.Cookies[CookieName];

        var uid = ReadUserId(token);
        if (uid == null) return null;
        var user = await db.Users.FindAsync(uid);
        if (user == null) return null;
        return new SessionPrincipal { UserId = user.Id, Email = user.Email, Name = user.Name, Role = user.Role };
    }
}
