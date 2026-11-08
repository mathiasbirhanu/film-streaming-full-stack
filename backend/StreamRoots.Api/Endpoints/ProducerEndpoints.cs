// ── Endpoints: producer studio + viewer engagement ───────────────────
// Ports of src/lib/actions/{producer,playlist,engage}.ts. Producer reads
// are identity-scoped in SQL (resource.producerId / payoutEntry.producerId),
// mutations re-check ownership — a producer can only ever aggregate and
// mutate their own titles, mirroring the TS guards.
using Microsoft.EntityFrameworkCore;
using StreamRoots.Api.Data;
using StreamRoots.Api.Models;
using StreamRoots.Api.Security;
using StreamRoots.Api.Services;

namespace StreamRoots.Api.Endpoints;

public static class ProducerEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/producer").WithTags("producer");

        g.AddEndpointFilter(async (ctx, next) =>
        {
            var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var p = await SessionToken.ResolvePrincipalAsync(db, ctx.HttpContext.Request);
            if (p is null) return EndpointExtensions.Fail("Please sign in first.");
            if (p.Role != "PRODUCER" && p.Role != "ADMIN") return EndpointExtensions.Fail("Producer access required.");
            ctx.HttpContext.Items["principal"] = p;
            return await next(ctx);
        });

        // myResources(): own rows + earned aggregation + stats.
        g.MapGet("/resources", async (AppDbContext db, HttpContext ctx) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var fetched = await db.Resources.AsNoTracking()
                .Where(r => r.ProducerId == me.UserId)
                .OrderByDescending(r => r.UpdatedAt)
                .Select(r => new
                {
                    R = r,
                    Purchases = db.Purchases.Count(p => p.ResourceId == r.Id),
                    EarnedCents = db.PayoutEntries
                        .Where(e => e.ResourceId == r.Id && e.Type == "EARNED")
                        .Sum(e => (int?)e.AmountCents) ?? 0,
                })
                .ToListAsync();
            var rows = fetched.Select(x => new
            {
                x.R.Id, x.R.Title, x.R.Genre, x.R.Year, x.R.Status, x.R.PricingType,
                x.R.PriceCents, x.R.DiscountPercent,
                EffectivePriceCents = PricingService.EffectivePriceCents(x.R),
                Poster = $"/api/thumb/{x.R.Id}",
                x.R.Description, x.R.ViewCount,
                x.Purchases,
                EarnedCents = x.EarnedCents,
                x.R.RejectionReason,
                UpdatedAt = x.R.UpdatedAt.ToString("o"),
            }).ToList();
            var stats = new
            {
                TotalViews = rows.Sum(r => r.ViewCount),
                TotalPurchases = rows.Sum(r => r.Purchases),
                EarnedCents = rows.Sum(r => r.EarnedCents),
                PublishedCount = rows.Count(r => r.Status == "PUBLISHED"),
                PendingCount = rows.Count(r => r.Status == "PENDING_REVIEW"),
            };
            return EndpointExtensions.Ok(new { Rows = rows, Stats = stats });
        });

        // producerIncome(): own per-movie income report + totals.
        g.MapGet("/income", async (AppDbContext db, HttpContext ctx) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var sales = await db.Purchases.Where(p => p.Status == "COMPLETED" && p.Resource!.ProducerId == me.UserId)
                .GroupBy(p => p.ResourceId)
                .Select(gr => new { ResourceId = gr.Key, Count = gr.Count(), Gross = gr.Sum(x => x.AmountCents) })
                .ToListAsync();
            var earned = await db.PayoutEntries.Where(e => e.ProducerId == me.UserId && e.Type == "EARNED")
                .GroupBy(e => e.ResourceId)
                .Select(gr => new { ResourceId = gr.Key, Sum = gr.Sum(x => x.AmountCents) })
                .ToListAsync();
            var titles = await db.Resources.Where(r => r.ProducerId == me.UserId)
                .Select(r => new { r.Id, r.Title }).ToListAsync();
            var shareBps = await PlatformSettingsService.GetProducerShareBpsAsync(db);

            var salesById = sales.ToDictionary(s => s.ResourceId);
            var earnedById = earned.ToDictionary(e => e.ResourceId, e => e.Sum);
            var titleById = titles.ToDictionary(t => t.Id, t => t.Title);

            var rows = salesById.Keys.Concat(earnedById.Keys).Distinct()
                .Select(rid =>
                {
                    var s = salesById.GetValueOrDefault(rid);
                    var mine = earnedById.GetValueOrDefault(rid);
                    return new
                    {
                        ResourceId = rid,
                        Title = titleById.GetValueOrDefault(rid, "Removed title"),
                        Sales = s?.Count ?? 0,
                        GrossCents = s?.Gross ?? 0,
                        EarnedCents = mine,
                        PlatformCents = Math.Max(0, (s?.Gross ?? 0) - mine),
                    };
                })
                .Where(r => r.Sales > 0 || r.EarnedCents > 0)
                .OrderByDescending(r => r.GrossCents).ThenByDescending(r => r.Sales)
                .ToList();

            var totals = new
            {
                Sales = rows.Sum(r => r.Sales),
                GrossCents = rows.Sum(r => r.GrossCents),
                EarnedCents = rows.Sum(r => r.EarnedCents),
                PlatformCents = rows.Sum(r => r.PlatformCents),
            };
            return EndpointExtensions.Ok(new { Rows = rows, Totals = totals, ProducerShareBps = shareBps });
        });

        // myLedger(): latest 50 EARNED entries, own only.
        g.MapGet("/ledger", async (AppDbContext db, HttpContext ctx) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var rows = await db.PayoutEntries.AsNoTracking()
                .Where(e => e.ProducerId == me.UserId && e.Type == "EARNED")
                .OrderByDescending(e => e.CreatedAt).Take(50)
                .Select(e => new
                {
                    e.Id, Title = e.Resource!.Title, e.AmountCents, e.Status,
                    CreatedAt = e.CreatedAt.ToString("o"),
                })
                .ToListAsync();
            return EndpointExtensions.Ok(rows);
        });

        // saveResource(input): create or edit (ownership-checked), edits to
        // PUBLISHED re-enter review (re-approval rule).
        g.MapPost("/resources", async Task<IResult> (AppDbContext db, HttpContext ctx, ResourceInput input) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var title = (input.Title ?? "").Trim();
            if (title.Length < 2) return EndpointExtensions.Fail("Title is required.");

            Resource? existing = null;
            if (input.Id is not null)
            {
                existing = await db.Resources.FindAsync(input.Id);
                if (existing is null) return EndpointExtensions.Fail("Title not found.");
                if (existing.ProducerId != me.UserId && me.Role != "ADMIN")
                    return EndpointExtensions.Fail("You can only edit your own titles.");
            }

            var keepSource = existing is not null && string.IsNullOrWhiteSpace(input.Youtube);
            var sourceRef = keepSource
                ? existing!.SourceRef
                : ParseYouTubeId(input.Youtube ?? "");
            if (sourceRef is null)
                return EndpointExtensions.Fail("Enter a valid YouTube link or 11-character video id.");
            if (existing is not null && keepSource && ParseYouTubeId(existing.SourceRef) is null)
                return EndpointExtensions.Fail("Existing video reference is invalid — please provide a link.");
            if (input.PricingType == "PPV" && input.PriceCents < 99)
                return EndpointExtensions.Fail("Pay-per-view price must be at least $0.99.");
            if (input.DiscountPercent < 0 || input.DiscountPercent > 90)
                return EndpointExtensions.Fail("Discount must be between 0 and 90%.");
            if (!string.IsNullOrWhiteSpace(input.PosterUrl) && !System.Text.RegularExpressions.Regex.IsMatch(input.PosterUrl.Trim(), "^https?://.+"))
                return EndpointExtensions.Fail("Poster URL must start with http(s)://.");

            var nextStatus = existing is null
                ? (input.Submit ? "PENDING_REVIEW" : "DRAFT")
                : input.Submit || existing!.Status == "PUBLISHED"
                    ? "PENDING_REVIEW"
                    : existing.Status == "SUSPENDED" ? "SUSPENDED" : "DRAFT";

            if (existing is null)
            {
                var created = new Resource
                {
                    Id = Ids.NewId(), Title = title,
                    Description = (input.Description ?? "").Trim()[..Math.Min(2000, (input.Description ?? "").Trim().Length)],
                    Genre = string.IsNullOrWhiteSpace(input.Genre) ? "General" : input.Genre,
                    Year = input.Year is > 1900 and < 2100 ? input.Year : null,
                    VideoSourceType = "YOUTUBE", SourceRef = sourceRef,
                    PosterUrl = string.IsNullOrWhiteSpace(input.PosterUrl) ? null : input.PosterUrl.Trim(),
                    PricingType = input.PricingType, PriceCents = Math.Max(0, input.PriceCents),
                    DiscountPercent = input.DiscountPercent, Status = nextStatus,
                    ProducerId = me.UserId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
                };
                db.Resources.Add(created);
                await db.SaveChangesAsync();
                return EndpointExtensions.Ok(new { Id = created.Id });
            }

            existing.Title = title;
            existing.Description = (input.Description ?? "").Trim()[..Math.Min(2000, (input.Description ?? "").Trim().Length)];
            existing.Genre = string.IsNullOrWhiteSpace(input.Genre) ? "General" : input.Genre;
            existing.Year = input.Year is > 1900 and < 2100 ? input.Year : null;
            existing.VideoSourceType = "YOUTUBE";
            existing.SourceRef = sourceRef;
            existing.PosterUrl = string.IsNullOrWhiteSpace(input.PosterUrl) ? existing.PosterUrl : input.PosterUrl!.Trim();
            existing.PricingType = input.PricingType;
            existing.PriceCents = Math.Max(0, input.PriceCents);
            existing.DiscountPercent = input.DiscountPercent;
            existing.Status = nextStatus;
            existing.RejectionReason = null;
            existing.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return EndpointExtensions.Ok(new { Id = existing.Id });
        });

        // submitResource(resourceId)
        g.MapPost("/resources/{resourceId}/submit", async Task<IResult> (AppDbContext db, HttpContext ctx, string resourceId) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var r = await db.Resources.FindAsync(resourceId);
            if (r is null) return EndpointExtensions.Fail("Title not found.");
            if (r.ProducerId != me.UserId && me.Role != "ADMIN") return EndpointExtensions.Fail("Not your title.");
            if (!ModerationService.CanTransition(r.Status, "PENDING_REVIEW"))
                return EndpointExtensions.Fail($"Cannot submit a title that is {r.Status}.");
            r.Status = "PENDING_REVIEW";
            r.RejectionReason = null;
            r.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // deleteResourceDraft(resourceId): DRAFT/REJECTED only, own only.
        g.MapDelete("/resources/{resourceId}", async Task<IResult> (AppDbContext db, HttpContext ctx, string resourceId) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var r = await db.Resources.FindAsync(resourceId);
            if (r is null) return EndpointExtensions.Fail("Title not found.");
            if (r.ProducerId != me.UserId && me.Role != "ADMIN") return EndpointExtensions.Fail("Not your title.");
            if (r.Status != "DRAFT" && r.Status != "REJECTED")
                return EndpointExtensions.Fail("Only drafts or rejected titles can be deleted.");
            db.Resources.Remove(r);
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // myPlaylists(): own playlists with ordered items.
        g.MapGet("/playlists", async (AppDbContext db, HttpContext ctx) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var lists = await db.Playlists.AsNoTracking()
                .Where(p => p.ProducerId == me.UserId)
                .OrderByDescending(p => p.UpdatedAt)
                .Include(p => p.Items)
                .ToListAsync();
            var ids = lists.SelectMany(p => p.Items.Select(i => i.ResourceId)).Distinct().ToList();
            var resById = await db.Resources.AsNoTracking()
                .Where(r => ids.Contains(r.Id))
                .Select(r => new { r.Id, r.Title, r.Status })
                .ToDictionaryAsync(r => r.Id);

            var rows = lists.Select(p => new
            {
                p.Id, p.Title, p.Description, p.Status,
                Items = p.Items.OrderBy(i => i.Position).Select(i => new
                {
                    ItemId = i.Id,
                    ResourceId = i.ResourceId,
                    Title = resById.GetValueOrDefault(i.ResourceId)?.Title ?? "",
                    Poster = $"/api/thumb/{i.ResourceId}",
                    Status = resById.GetValueOrDefault(i.ResourceId)?.Status ?? "",
                    i.Position,
                }).ToList(),
                UpdatedAt = p.UpdatedAt.ToString("o"),
            }).ToList();
            return EndpointExtensions.Ok(rows);
        });

        // savePlaylist(input): create/update own playlist metadata.
        g.MapPost("/playlists", async Task<IResult> (AppDbContext db, HttpContext ctx, PlaylistInput input) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            if ((input.Title ?? "").Trim().Length < 2) return EndpointExtensions.Fail("Playlist title is required.");
            if (input.Id is null)
            {
                var created = new Playlist
                {
                    Id = Ids.NewId(), Title = input.Title.Trim(),
                    Description = (input.Description ?? "").Trim(),
                    Status = "DRAFT", ProducerId = me.UserId,
                    CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
                };
                db.Playlists.Add(created);
                await db.SaveChangesAsync();
                return EndpointExtensions.Ok(new { Id = created.Id });
            }
            var p = await db.Playlists.FindAsync(input.Id);
            if (p is null) return EndpointExtensions.Fail("Playlist not found.");
            if (p.ProducerId != me.UserId && me.Role != "ADMIN") return EndpointExtensions.Fail("Not your playlist.");
            p.Title = input.Title.Trim();
            p.Description = (input.Description ?? "").Trim();
            p.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return EndpointExtensions.Ok(new { Id = p.Id });
        });

        // setPlaylistPublished(id, published)
        g.MapPost("/playlists/{playlistId}/publish", async Task<IResult> (AppDbContext db, HttpContext ctx, string playlistId, PublishBody body) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var p = await db.Playlists.FindAsync(playlistId);
            if (p is null) return EndpointExtensions.Fail("Playlist not found.");
            if (p.ProducerId != me.UserId && me.Role != "ADMIN") return EndpointExtensions.Fail("Not your playlist.");
            if (body.Published && !db.PlaylistItems.Any(i => i.PlaylistId == playlistId))
                return EndpointExtensions.Fail("Add at least one title before publishing.");
            p.Status = body.Published ? "PUBLISHED" : "DRAFT";
            p.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // deletePlaylist(id) — items cascade (Prisma onDelete: Cascade).
        g.MapDelete("/playlists/{playlistId}", async Task<IResult> (AppDbContext db, HttpContext ctx, string playlistId) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var p = await db.Playlists.FindAsync(playlistId);
            if (p is null) return EndpointExtensions.Fail("Playlist not found.");
            if (p.ProducerId != me.UserId && me.Role != "ADMIN") return EndpointExtensions.Fail("Not your playlist.");
            db.PlaylistItems.RemoveRange(db.PlaylistItems.Where(i => i.PlaylistId == playlistId));
            db.Playlists.Remove(p);
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // addPlaylistItem(playlistId, resourceId): own playlist + own PUBLISHED title.
        g.MapPost("/playlists/{playlistId}/items", async Task<IResult> (AppDbContext db, HttpContext ctx, string playlistId, AddItemBody body) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var p = await db.Playlists.FindAsync(playlistId);
            if (p is null) return EndpointExtensions.Fail("Playlist not found.");
            if (p.ProducerId != me.UserId && me.Role != "ADMIN") return EndpointExtensions.Fail("Not your playlist.");
            var r = await db.Resources.FindAsync(body.ResourceId);
            if (r is null || r.ProducerId != me.UserId || r.Status != "PUBLISHED")
                return EndpointExtensions.Fail("Only your own published titles can be added.");
            if (db.PlaylistItems.Any(i => i.PlaylistId == playlistId && i.ResourceId == body.ResourceId))
                return EndpointExtensions.Fail("That title is already in the playlist.");
            var next = db.PlaylistItems.Where(i => i.PlaylistId == playlistId).Count() + 1;
            db.PlaylistItems.Add(new PlaylistItem { Id = Ids.NewId(), PlaylistId = playlistId, ResourceId = body.ResourceId, Position = next });
            p.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // removePlaylistItem(itemId)
        g.MapDelete("/playlists/items/{itemId}", async Task<IResult> (AppDbContext db, HttpContext ctx, string itemId) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var item = await db.PlaylistItems.FindAsync(itemId);
            if (item is null) return EndpointExtensions.Fail("Playlist item not found.");
            var p = await db.Playlists.FindAsync(item.PlaylistId);
            if (p is null || (p.ProducerId != me.UserId && me.Role != "ADMIN")) return EndpointExtensions.Fail("Not your playlist.");
            db.PlaylistItems.Remove(item);
            p.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // movePlaylistItem(itemId, direction): swap with neighbour in a txn.
        g.MapPost("/playlists/items/{itemId}/move", async Task<IResult> (AppDbContext db, HttpContext ctx, string itemId, MoveBody body) =>
        {
            var me = (SessionPrincipal)ctx.Items["principal"]!;
            var item = await db.PlaylistItems.FindAsync(itemId);
            if (item is null) return EndpointExtensions.Fail("Playlist item not found.");
            var p = await db.Playlists.FindAsync(item.PlaylistId);
            if (p is null || (p.ProducerId != me.UserId && me.Role != "ADMIN")) return EndpointExtensions.Fail("Not your playlist.");

            var ordered = await db.PlaylistItems.Where(i => i.PlaylistId == item.PlaylistId)
                .OrderBy(i => i.Position).ToListAsync();
            var idx = ordered.FindIndex(i => i.Id == itemId);
            var swapWith = body.Direction == "up" ? idx - 1 : idx + 1;
            if (swapWith < 0 || swapWith >= ordered.Count) return EndpointExtensions.OkUnit(); // no-op at edges

            (ordered[idx].Position, ordered[swapWith].Position) = (ordered[swapWith].Position, ordered[idx].Position);
            p.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });
    }

    public record ResourceInput(string? Id, string Title, string Description, string Genre, int? Year,
        string Youtube, string? PosterUrl, string PricingType, int PriceCents, int DiscountPercent, bool Submit);
    public record PlaylistInput(string? Id, string Title, string? Description);
    public record PublishBody(bool Published);
    public record AddItemBody(string ResourceId);
    public record MoveBody(string Direction);

    // Same acceptance rules as producer.ts: URLs or bare 11-char ids.
    internal static string? ParseYouTubeId(string raw)
    {
        var s = raw.Trim();
        var m = System.Text.RegularExpressions.Regex.Match(s,
            @"(?:youtube\.com/(?:watch\?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})");
        if (m.Success) return m.Groups[1].Value;
        return System.Text.RegularExpressions.Regex.IsMatch(s, "^[A-Za-z0-9_-]{11}$") ? s : null;
    }
}

public static class EngageEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/engage").WithTags("engage");

        // myNotifications(): own list + unread count.
        g.MapGet("/notifications", async Task<IResult> (AppDbContext db, HttpRequest req) =>
        {
            var principal = await SessionToken.ResolvePrincipalAsync(db, req);
            if (principal is null) return EndpointExtensions.Ok(new { Items = Array.Empty<object>(), Unread = 0 });
            var rows = await db.Notifications.AsNoTracking()
                .Where(n => n.UserId == principal.UserId)
                .OrderByDescending(n => n.CreatedAt).Take(30)
                .Select(n => new
                {
                    n.Id, n.Kind, n.Title, n.Body, n.ResourceId,
                    Read = n.ReadAt != null,
                    CreatedAt = n.CreatedAt.ToString("o"),
                })
                .ToListAsync();
            return EndpointExtensions.Ok(new { Items = rows, Unread = rows.Count(r => !r.Read) });
        });

        // markAllRead()
        g.MapPost("/notifications/read-all", async Task<IResult> (AppDbContext db, HttpRequest req) =>
        {
            var principal = await SessionToken.ResolvePrincipalAsync(db, req);
            if (principal is null) return EndpointExtensions.Fail("Please sign in first.");
            await db.Notifications.Where(n => n.UserId == principal.UserId && n.ReadAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow));
            return EndpointExtensions.OkUnit();
        });

        // getLibrary(): own purchases + membership flag.
        g.MapGet("/library", async Task<IResult> (AppDbContext db, HttpRequest req) =>
        {
            var principal = await SessionToken.ResolvePrincipalAsync(db, req);
            if (principal is null) return EndpointExtensions.Ok(new { Purchases = Array.Empty<object>(), MembershipActive = false });
            var rows = await db.Purchases.AsNoTracking()
                .Where(p => p.UserId == principal.UserId && p.Status == "COMPLETED")
                .OrderByDescending(p => p.CreatedAt)
                .Select(p => new { P = p, R = p.Resource!, ProducerName = (string?)p.Resource!.Producer!.Name })
                .ToListAsync();
            var now = DateTime.UtcNow;
            var membership = await db.Memberships.Where(m => m.UserId == principal.UserId)
                .OrderByDescending(m => m.StartedAt).FirstOrDefaultAsync();
            var active = membership is not null && membership.Status == "ACTIVE" && membership.ExpiresAt > now;

            return EndpointExtensions.Ok(new
            {
                Purchases = rows.Select(x =>
                {
                    var c = CatalogMapper.ToCatalogItem(x.R, x.ProducerName);
                    return new
                    {
                        c.Id, c.Title, c.Description, c.Genre, c.Year, c.PricingType,
                        c.PriceCents, c.DiscountPercent, c.DiscountEndsAt, c.EffectivePriceCents,
                        c.Poster, c.ProducerName, c.ViewCount,
                        PurchasedAt = x.P.CreatedAt.ToString("o"),
                        x.P.AmountCents,
                    };
                }),
                MembershipActive = active,
            });
        });

        // getContinueWatching(): own progress on published titles.
        g.MapGet("/continue-watching", async Task<IResult> (AppDbContext db, HttpRequest req) =>
        {
            var principal = await SessionToken.ResolvePrincipalAsync(db, req);
            if (principal is null) return EndpointExtensions.Ok(Array.Empty<object>());
            var rows = await db.ViewingProgress.AsNoTracking()
                .Where(v => v.UserId == principal.UserId && v.Resource!.Status == "PUBLISHED")
                .OrderByDescending(v => v.UpdatedAt).Take(12)
                .Select(v => new { V = v, R = v.Resource! })
                .ToListAsync();
            return EndpointExtensions.Ok(rows
                .Where(x => x.V.DurationSeconds > 0)
                .Select(x => new
                {
                    ResourceId = x.V.ResourceId,
                    x.R.Title,
                    Poster = $"/api/thumb/{x.V.ResourceId}",
                    Percent = Math.Min(100, (int)Math.Round((double)x.V.PositionSeconds / x.V.DurationSeconds * 100)),
                    x.V.PositionSeconds,
                    x.R.Genre,
                    x.R.PricingType,
                }));
        });
    }
}
