// ── Endpoints: catalog, playlists (public), playback, checkout ───────
// Ports of src/lib/actions/{catalog,playlist,playback,checkout}.ts.
// Response shapes mirror the TS server actions exactly (camelCase JSON,
// ActionResult envelope {ok,error?,data?}); public payloads never include
// sourceRef — the embed URL is built only after the entitlement check.
using Microsoft.EntityFrameworkCore;
using StreamRoots.Api.Data;
using StreamRoots.Api.Models;
using StreamRoots.Api.Security;
using StreamRoots.Api.Services;

namespace StreamRoots.Api.Endpoints;

public record CatalogItemDto(string Id, string Title, string Description, string Genre, int? Year,
    string PricingType, int PriceCents, int DiscountPercent, string? DiscountEndsAt,
    int EffectivePriceCents, string Poster, string? ProducerName, int ViewCount);

public static class CatalogMapper
{
    public static CatalogItemDto ToCatalogItem(Resource r, string? producerName) =>
        new(r.Id, r.Title, r.Description, r.Genre, r.Year, r.PricingType, r.PriceCents,
            PricingService.IsDiscountActive(r) ? r.DiscountPercent : 0,
            r.DiscountEndsAt?.ToString("o"),
            PricingService.EffectivePriceCents(r),
            $"/api/thumb/{r.Id}", producerName, r.ViewCount);
}

public static class EndpointExtensions
{
    public static IResult Ok<T>(T? data) => Results.Json(new { ok = true, data });
    public static IResult OkUnit() => Results.Json(new { ok = true });
    public static IResult Fail(string error) => Results.Json(new { ok = false, error });

    public static async Task<SessionPrincipal?> RequireAsync(AppDbContext db, HttpRequest req, params string[] roles)
    {
        var p = await SessionToken.ResolvePrincipalAsync(db, req);
        if (p is null || (roles.Length > 0 && !roles.Contains(p.Role))) return null;
        return p;
    }
}

public static class AuthEndpoints
{
    public record AuthBody(string Email, string Password, string? Name);

    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/auth").WithTags("auth");

        g.MapPost("/register", async (AppDbContext db, AuthBody body, HttpResponse res) =>
        {
            var email = (body.Email ?? "").Trim().ToLowerInvariant();
            if (!email.Contains('@')) return EndpointExtensions.Fail("Enter a valid email address.");
            if ((body.Password ?? "").Length < 8) return EndpointExtensions.Fail("Password must be at least 8 characters.");
            if ((body.Name ?? "").Trim().Length < 2) return EndpointExtensions.Fail("Your name is required.");
            if (await db.Users.AnyAsync(u => u.Email == email))
                return EndpointExtensions.Fail("That email is already registered — sign in instead.");

            var user = new User
            {
                Id = Ids.NewId(), Email = email, Name = body.Name!.Trim(),
                PasswordHash = ScryptHasher.Hash(body.Password),
                Role = "VIEWER", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();

            res.Cookies.Append(SessionToken.CookieName, SessionToken.Create(user.Id), new CookieOptions
            { HttpOnly = true, SameSite = SameSiteMode.Lax, Secure = false, Path = "/", MaxAge = TimeSpan.FromDays(30) });
            return EndpointExtensions.Ok(new { user.Id, user.Email, user.Name, user.Role });
        });

        g.MapPost("/login", async (AppDbContext db, AuthBody body, HttpResponse res) =>
        {
            var email = (body.Email ?? "").Trim().ToLowerInvariant();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
            if (user is null || !ScryptHasher.Verify(body.Password ?? "", user.PasswordHash))
                return EndpointExtensions.Fail("Wrong email or password.");

            res.Cookies.Append(SessionToken.CookieName, SessionToken.Create(user.Id), new CookieOptions
            { HttpOnly = true, SameSite = SameSiteMode.Lax, Secure = false, Path = "/", MaxAge = TimeSpan.FromDays(30) });
            return EndpointExtensions.Ok(new { user.Id, user.Email, user.Name, user.Role });
        });

        g.MapGet("/me", async Task<IResult> (AppDbContext db, HttpRequest req) =>
        {
            var p = await SessionToken.ResolvePrincipalAsync(db, req);
            return p is null ? EndpointExtensions.Fail("Please sign in first.")
                : EndpointExtensions.Ok(new { Id = p.UserId, p.Email, p.Name, p.Role });
        });

        g.MapPost("/logout", (HttpResponse res) =>
        {
            res.Cookies.Delete(SessionToken.CookieName);
            return EndpointExtensions.Ok<object?>(null);
        });
    }
}

public static class CatalogEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/catalog").WithTags("catalog");

        // Public catalog — getCatalog(): PUBLISHED only, newest first.
        g.MapGet("", async (AppDbContext db) =>
        {
            var rows = await db.Resources.AsNoTracking()
                .Where(r => r.Status == "PUBLISHED")
                .OrderByDescending(r => r.CreatedAt)
                .Select(r => new { R = r, ProducerName = (string?)r.Producer!.Name })
                .ToListAsync();
            return rows.Select(x => CatalogMapper.ToCatalogItem(x.R, x.ProducerName));
        });

        // Up Next — getUpNext(excludeId): same genre first, then newest, cap 8.
        g.MapGet("upnext/{id}", async (AppDbContext db, string id) =>
        {
            var current = await db.Resources.Where(r => r.Id == id).Select(r => (string?)r.Genre).FirstOrDefaultAsync();
            var rows = await db.Resources.AsNoTracking()
                .Where(r => r.Status == "PUBLISHED" && r.Id != id)
                .OrderByDescending(r => r.CreatedAt)
                .Take(24)
                .Select(r => new { R = r, ProducerName = (string?)r.Producer!.Name })
                .ToListAsync();
            var items = rows.Select(x => CatalogMapper.ToCatalogItem(x.R, x.ProducerName)).ToList();
            var same = current is null ? [] : items.Where(i => i.Genre == current).ToList();
            var others = current is null ? items : items.Where(i => i.Genre != current).ToList();
            return same.Concat(others).Take(8);
        });

        // Home playlists rail — getPlaylists(): published with ≥1 item.
        g.MapGet("playlists", async (AppDbContext db) =>
        {
            var rows = await db.Playlists.AsNoTracking()
                .Where(p => p.Status == "PUBLISHED" && db.PlaylistItems.Any(i => i.PlaylistId == p.Id))
                .OrderByDescending(p => p.CreatedAt)
                .Select(p => new
                {
                    p.Id, p.Title, p.Description,
                    ProducerName = (string?)p.Producer!.Name,
                    ItemCount = db.PlaylistItems.Count(i => i.PlaylistId == p.Id),
                    FirstItemId = db.PlaylistItems.Where(i => i.PlaylistId == p.Id)
                        .OrderBy(i => i.Position).Select(i => (string?)i.ResourceId).FirstOrDefault(),
                })
                .ToListAsync();
            return rows.Select(p => new
            {
                p.Id, p.Title, p.Description, p.ProducerName, p.ItemCount,
                Poster = p.FirstItemId is null ? null : $"/api/thumb/{p.FirstItemId}",
                PosterId = p.FirstItemId,
            });
        });

        // Playlist detail — getPlaylistDetail(id): ordered PUBLISHED items.
        g.MapGet("playlists/{id}", async (AppDbContext db, string id) =>
        {
            var p = await db.Playlists.AsNoTracking()
                .Include(pl => pl.Items)
                .FirstOrDefaultAsync(pl => pl.Id == id);
            if (p is null || p.Status != "PUBLISHED") return Results.Json<object?>(null);

            var itemIds = p.Items.OrderBy(i => i.Position).Select(i => i.ResourceId).ToList();
            var resources = await db.Resources.AsNoTracking()
                .Where(r => itemIds.Contains(r.Id) && r.Status == "PUBLISHED")
                .Select(r => new { R = r, ProducerName = (string?)r.Producer!.Name })
                .ToListAsync();
            var byId = resources.ToDictionary(x => x.R.Id, x => CatalogMapper.ToCatalogItem(x.R, x.ProducerName));
            var items = itemIds.Where(byId.ContainsKey).Select(i => byId[i]).ToList();
            var firstId = p.Items.OrderBy(i => i.Position).Select(i => i.ResourceId).FirstOrDefault();

            return Results.Json(new
            {
                p.Id, p.Title, p.Description,
                ProducerName = (string?)db.Users.Where(u => u.Id == p.ProducerId).Select(u => u.Name).FirstOrDefault(),
                ItemCount = items.Count,
                Poster = firstId is null ? null : $"/api/thumb/{firstId}",
                PosterId = (string?)firstId,
                Items = items,
            });
        });
    }
}

public static class PlaybackEndpoints
{
    public static string BuildEmbedUrl(string sourceRef, int startAt)
    {
        var p = new Dictionary<string, string>
        {
            ["controls"] = "0", ["rel"] = "0", ["iv_load_policy"] = "3",
            ["modestbranding"] = "1", ["playsinline"] = "1", ["autoplay"] = "1", ["color"] = "white",
        };
        if (startAt > 0) p["start"] = Math.Floor((double)startAt).ToString();
        var qs = string.Join('&', p.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));
        return $"https://www.youtube-nocookie.com/embed/{sourceRef}?{qs}";
    }

    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/playback").WithTags("playback");

        // getPlayback(resourceId): entitlement gate → embed URL + watermark.
        g.MapGet("{resourceId}", async Task<IResult> (AppDbContext db, HttpRequest req, string resourceId) =>
        {
            var principal = await SessionToken.ResolvePrincipalAsync(db, req);
            var resource = await db.Resources.Include(r => r.Producer).FirstOrDefaultAsync(r => r.Id == resourceId);
            if (resource is null) return Results.Json(new { ok = false, reason = "UNAVAILABLE" });

            Membership? membership = null; Purchase? purchase = null; ViewingProgress? progress = null;
            if (principal is not null)
            {
                membership = await db.Memberships.Where(m => m.UserId == principal.UserId)
                    .OrderByDescending(m => m.StartedAt).FirstOrDefaultAsync();
                purchase = await db.Purchases.FirstOrDefaultAsync(p =>
                    p.UserId == principal.UserId && p.ResourceId == resourceId && p.Kind == "PPV_LIFETIME");
                progress = await db.ViewingProgress.FirstOrDefaultAsync(v =>
                    v.UserId == principal.UserId && v.ResourceId == resourceId);
            }

            var check = EntitlementService.Resolve(principal, resource, membership, purchase);
            var item = CatalogMapper.ToCatalogItem(resource, resource.Producer?.Name);
            if (!check.CanWatch)
                return Results.Json(new { ok = false, reason = check.Reason, resource.Title, Item = (object?)item });

            await db.Resources.Where(r => r.Id == resourceId)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.ViewCount, r => r.ViewCount + 1));

            var licenseRef = resource.PricingType switch
            {
                "FREE" => $"FREE-{principal!.UserId[^8..].ToUpperInvariant()}",
                "MEMBERSHIP" when EntitlementService.MembershipIsActive(membership) =>
                    $"MEM-{membership!.Id[^8..].ToUpperInvariant()}",
                _ => $"PPV-{purchase!.Id[^8..].ToUpperInvariant()}",
            };

            return Results.Json(new
            {
                ok = true,
                resource.Title,
                resource.Description,
                resource.Genre,
                ProducerName = (string?)resource.Producer?.Name,
                EmbedUrl = BuildEmbedUrl(resource.SourceRef, progress?.PositionSeconds ?? 0),
                ResumeAt = progress?.PositionSeconds ?? 0,
                Watermark = new { Name = principal!.Name, ShortId = principal.UserId[^8..].ToUpperInvariant(), Email = principal.Email, LicenseRef = licenseRef },
                Item = (object)item,
            });
        });

        // saveProgress(resourceId, position, duration): 15s beacon upsert.
        g.MapPost("{resourceId}/progress", async Task<IResult> (AppDbContext db, HttpRequest req, string resourceId, ProgressBody body) =>
        {
            var principal = await SessionToken.ResolvePrincipalAsync(db, req);
            if (principal is null) return Results.Json(new { ok = false });
            var resource = await db.Resources.FirstOrDefaultAsync(r => r.Id == resourceId);
            if (resource is null || resource.Status != "PUBLISHED") return Results.Json(new { ok = false });

            var membership = await db.Memberships.Where(m => m.UserId == principal.UserId)
                .OrderByDescending(m => m.StartedAt).FirstOrDefaultAsync();
            var purchase = await db.Purchases.FirstOrDefaultAsync(p =>
                p.UserId == principal.UserId && p.ResourceId == resourceId && p.Kind == "PPV_LIFETIME");
            var check = EntitlementService.Resolve(principal, resource, membership, purchase);
            if (!check.CanWatch) return Results.Json(new { ok = false });

            var pos = Math.Max(0, Math.Floor(body.PositionSeconds));
            var dur = Math.Max(0, Math.Floor(body.DurationSeconds));
            var existing = await db.ViewingProgress.FirstOrDefaultAsync(v =>
                v.UserId == principal.UserId && v.ResourceId == resourceId);
            if (existing is null)
                db.ViewingProgress.Add(new ViewingProgress
                { Id = Ids.NewId(), UserId = principal.UserId, ResourceId = resourceId, PositionSeconds = (int)pos, DurationSeconds = (int)dur, UpdatedAt = DateTime.UtcNow });
            else
            {
                existing.PositionSeconds = (int)pos; existing.DurationSeconds = (int)dur; existing.UpdatedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync();
            return Results.Json(new { ok = true });
        });
    }

    public record ProgressBody(double PositionSeconds, double DurationSeconds);
}

public static class CheckoutEndpoints
{
    public record MethodBody(string? Method);

    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/checkout").WithTags("checkout");

        // buyMembership()
        g.MapPost("/membership", async Task<IResult> (AppDbContext db, HttpRequest req, MethodBody body) =>
        {
            var principal = await EndpointExtensions.RequireAsync(db, req);
            if (principal is null) return EndpointExtensions.Fail("Please sign in first.");

            var current = await db.Memberships.Where(m => m.UserId == principal.UserId)
                .OrderByDescending(m => m.StartedAt).FirstOrDefaultAsync();
            if (EntitlementService.MembershipIsActive(current))
                return EndpointExtensions.Fail("Your membership is already active.");

            var method = ParseMethod(body?.Method);
            var charge = await PaymentsGateway.AuthorizeChargeAsync(Constants.MembershipPriceCents, method, "StreamRoots membership");

            var baseTime = current is not null && current.ExpiresAt > DateTime.UtcNow
                ? current.ExpiresAt : DateTime.UtcNow;
            db.Memberships.Add(new Membership
            {
                Id = Ids.NewId(), UserId = principal.UserId, Status = "ACTIVE", Plan = "MONTHLY",
                PriceCents = Constants.MembershipPriceCents, StartedAt = DateTime.UtcNow,
                ExpiresAt = baseTime.AddDays(30), Provider = charge.Provider, ProviderRef = charge.ProviderRef,
            });
            await db.SaveChangesAsync();
            return EndpointExtensions.Ok(new { ExpiresAt = baseTime.AddDays(30).ToString("o") });
        });

        // cancelMembership()
        g.MapPost("/membership/cancel", async Task<IResult> (AppDbContext db, HttpRequest req) =>
        {
            var principal = await EndpointExtensions.RequireAsync(db, req);
            if (principal is null) return EndpointExtensions.Fail("Please sign in first.");
            var current = await db.Memberships
                .Where(m => m.UserId == principal.UserId && m.Status == "ACTIVE")
                .OrderByDescending(m => m.StartedAt).FirstOrDefaultAsync();
            if (current is null) return EndpointExtensions.Fail("No active membership to cancel.");
            current.Status = "CANCELED";
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // purchaseResource(resourceId): snapshot the share at charge time.
        g.MapPost("/purchase/{resourceId}", async Task<IResult> (AppDbContext db, HttpRequest req, string resourceId, MethodBody body) =>
        {
            var principal = await EndpointExtensions.RequireAsync(db, req);
            if (principal is null) return EndpointExtensions.Fail("Please sign in first.");

            var resource = await db.Resources.FindAsync(resourceId);
            if (resource is null || resource.Status != "PUBLISHED")
                return EndpointExtensions.Fail("This title is not available for purchase.");
            if (resource.PricingType != "PPV")
                return EndpointExtensions.Fail("This title is not a pay-per-view item.");

            var existing = await db.Purchases.FirstOrDefaultAsync(p =>
                p.UserId == principal.UserId && p.ResourceId == resourceId && p.Kind == "PPV_LIFETIME");
            if (existing is not null && existing.Status == "COMPLETED")
                return EndpointExtensions.Fail("You already own this title.");

            var amount = PricingService.EffectivePriceCents(resource);
            var method = ParseMethod(body?.Method);
            var charge = await PaymentsGateway.AuthorizeChargeAsync(amount, method, $"StreamRoots: {resource.Title}");

            // Snapshot the admin-configured share at charge time — the ledger
            // rows freeze this split forever, so later retunes never re-history.
            var shareBps = await PlatformSettingsService.GetProducerShareBpsAsync(db);
            var producerCents = (int)Math.Round((decimal)amount * shareBps / 10000, MidpointRounding.AwayFromZero);

            var purchase = new Purchase
            {
                Id = Ids.NewId(), UserId = principal.UserId, ResourceId = resourceId,
                Kind = "PPV_LIFETIME", AmountCents = amount, Status = "COMPLETED",
                Provider = charge.Provider, ProviderRef = charge.ProviderRef, CreatedAt = DateTime.UtcNow,
            };
            db.Purchases.Add(purchase);

            if (resource.ProducerId is not null)
                db.PayoutEntries.Add(new PayoutEntry
                {
                    Id = Ids.NewId(), ProducerId = resource.ProducerId, ResourceId = resourceId,
                    PurchaseId = purchase.Id, Type = "EARNED", AmountCents = producerCents,
                    Status = "PAYABLE", CreatedAt = DateTime.UtcNow,
                });
            db.PayoutEntries.Add(new PayoutEntry
            {
                Id = Ids.NewId(), ProducerId = null, ResourceId = resourceId, PurchaseId = purchase.Id,
                Type = "PLATFORM_FEE", AmountCents = amount - producerCents, // always sums to the charge
                Status = "PAYABLE", CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return EndpointExtensions.Ok(new { AmountCents = amount, resource.Title });
        });
    }

    internal static PaymentMethod ParseMethod(string? method)
    {
        method = (method ?? "TELEBIRR").ToUpperInvariant();
        return method switch
        {
            "CBE_BIRR" => PaymentMethod.CBE_BIRR,
            "CHAPA" => PaymentMethod.CHAPA,
            "CARD" => PaymentMethod.CARD,
            _ => PaymentMethod.TELEBIRR,
        };
    }
}
