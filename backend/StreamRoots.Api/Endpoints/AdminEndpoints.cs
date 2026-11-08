// ── Endpoints: admin + producer dashboards ───────────────────────────
// Ports of src/lib/actions/{admin,producer}.ts — the income reports are
// built from the LEDGER (each sale's split frozen at charge time), not
// from current prices, so the tables stay correct after retuning the
// percentage. Every route is role-gated server-side; producer queries
// are identity-scoped at the WHERE level, never by UI filtering.
using Microsoft.EntityFrameworkCore;
using StreamRoots.Api.Data;
using StreamRoots.Api.Models;
using StreamRoots.Api.Security;
using StreamRoots.Api.Services;

namespace StreamRoots.Api.Endpoints;

public static class AdminEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/admin").WithTags("admin");

        // requireAdmin equivalent — 403 body mirrors the TS error strings.
        g.AddEndpointFilter(async (ctx, next) =>
        {
            var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var p = await SessionToken.ResolvePrincipalAsync(db, ctx.HttpContext.Request);
            if (p is null) return EndpointExtensions.Fail("Please sign in first.");
            if (p.Role != "ADMIN") return EndpointExtensions.Fail("Admin access required.");
            ctx.HttpContext.Items["principal"] = p;
            return await next(ctx);
        });

        // adminOverview()
        g.MapGet("/overview", async (AppDbContext db) =>
        {
            var users = await db.Users.CountAsync();
            var producers = await db.Users.CountAsync(u => u.Role == "PRODUCER");
            var published = await db.Resources.CountAsync(r => r.Status == "PUBLISHED");
            var pending = await db.Resources.CountAsync(r => r.Status == "PENDING_REVIEW");
            var purchaseRevenue = await db.Purchases.Where(p => p.Status == "COMPLETED")
                .SumAsync(p => (int?)p.AmountCents) ?? 0;
            var now = DateTime.UtcNow;
            var activeMs = await db.Memberships
                .Where(m => m.Status == "ACTIVE" && m.ExpiresAt > now).ToListAsync();
            var membershipRevenue = activeMs.Sum(m => m.PriceCents);
            var ledger = await db.PayoutEntries.Select(e => new { e.Type, e.AmountCents, e.Status }).ToListAsync();

            var top = await db.Purchases.Where(p => p.Status == "COMPLETED")
                .GroupBy(p => p.ResourceId)
                .Select(gr => new { ResourceId = gr.Key, Revenue = gr.Sum(x => x.AmountCents) })
                .OrderByDescending(x => x.Revenue).Take(5).ToListAsync();
            var ids = top.Select(t => t.ResourceId).ToList();
            var titles = await db.Resources.Where(r => ids.Contains(r.Id))
                .Select(r => new { r.Id, r.Title }).ToDictionaryAsync(r => r.Id, r => r.Title);

            return EndpointExtensions.Ok(new
            {
                Users = users,
                Producers = producers,
                ActiveMemberships = activeMs.Count,
                Published = published,
                Pending = pending,
                PurchaseRevenueCents = purchaseRevenue,
                MembershipRevenueCents = membershipRevenue,
                ProducerPayableCents = ledger.Where(e => e.Type == "EARNED" && e.Status != "PAID").Sum(e => e.AmountCents),
                ProducerEarnedCents = ledger.Where(e => e.Type == "EARNED").Sum(e => e.AmountCents),
                PlatformFeesCents = ledger.Where(e => e.Type == "PLATFORM_FEE").Sum(e => e.AmountCents),
                TopTitles = top.Select(t => new { Id = t.ResourceId, Title = titles.GetValueOrDefault(t.ResourceId, "Removed title"), RevenueCents = t.Revenue })
                    .OrderByDescending(t => t.RevenueCents).ToList(),
            });
        });

        // adminResources()
        g.MapGet("/resources", async (AppDbContext db) =>
        {
            var rows = await db.Resources.AsNoTracking()
                .OrderByDescending(r => r.UpdatedAt)
                .Select(r => new
                {
                    R = r,
                    ProducerName = (string?)r.Producer!.Name,
                    Purchases = db.Purchases.Count(p => p.ResourceId == r.Id),
                })
                .ToListAsync();
            return EndpointExtensions.Ok(rows.Select(x => new
            {
                x.R.Id, x.R.Title, x.R.Genre, x.R.Status, x.R.PricingType, x.R.PriceCents,
                EffectivePriceCents = PricingService.EffectivePriceCents(x.R),
                DiscountPercent = PricingService.IsDiscountActive(x.R) ? x.R.DiscountPercent : 0,
                DiscountEndsAt = x.R.DiscountEndsAt != null ? x.R.DiscountEndsAt.Value.ToString("o") : null,
                Poster = $"/api/thumb/{x.R.Id}",
                x.ProducerName,
                x.R.ViewCount,
                x.Purchases,
                UpdatedAt = x.R.UpdatedAt.ToString("o"),
            }));
        });

        // adminUsers()
        g.MapGet("/users", async (AppDbContext db) =>
        {
            var now = DateTime.UtcNow;
            var rows = await db.Users.AsNoTracking().OrderBy(u => u.CreatedAt)
                .Select(u => new
                {
                    u.Id, u.Name, u.Email, u.Role,
                    CreatedAt = u.CreatedAt.ToString("o"),
                    MembershipActive = db.Memberships.Any(m => m.UserId == u.Id && m.Status == "ACTIVE" && m.ExpiresAt > now),
                    Purchases = db.Purchases.Count(p => p.UserId == u.Id),
                })
                .ToListAsync();
            return EndpointExtensions.Ok(rows);
        });

        // adminIncomeReport() — per-movie ledger report + totals.
        g.MapGet("/income", async (AppDbContext db) =>
        {
            var sales = await db.Purchases.Where(p => p.Status == "COMPLETED")
                .GroupBy(p => p.ResourceId)
                .Select(gr => new { ResourceId = gr.Key, Count = gr.Count(), Gross = gr.Sum(x => x.AmountCents) })
                .ToListAsync();
            var ledger = await db.PayoutEntries
                .GroupBy(e => new { e.ResourceId, e.Type })
                .Select(gr => new { gr.Key.ResourceId, gr.Key.Type, Sum = gr.Sum(x => x.AmountCents) })
                .ToListAsync();
            var resources = await db.Resources.AsNoTracking()
                .Select(r => new { r.Id, r.Title, ProducerName = (string?)r.Producer!.Name })
                .ToListAsync();
            var membershipTotal = await db.Memberships.SumAsync(m => (int?)m.PriceCents) ?? 0;
            var shareBps = await PlatformSettingsService.GetProducerShareBpsAsync(db);

            var ledgerByResource = new Dictionary<string, (int Producer, int Platform)>();
            foreach (var e in ledger)
            {
                var cur = ledgerByResource.GetValueOrDefault(e.ResourceId);
                if (e.Type == "EARNED") cur.Producer += e.Sum;
                else if (e.Type == "PLATFORM_FEE") cur.Platform += e.Sum;
                ledgerByResource[e.ResourceId] = cur;
            }
            var salesByResource = sales.ToDictionary(s => s.ResourceId);
            var titleById = resources.ToDictionary(r => r.Id);

            var rowIds = salesByResource.Keys.Concat(ledgerByResource.Keys).Distinct();
            var rows = rowIds.Select(rid =>
            {
                var s = salesByResource.GetValueOrDefault(rid);
                var l = ledgerByResource.GetValueOrDefault(rid);
                var t = titleById.GetValueOrDefault(rid);
                return new
                {
                    ResourceId = rid,
                    Title = t?.Title ?? "Removed title",
                    ProducerName = t?.ProducerName,
                    Sales = s?.Count ?? 0,
                    GrossCents = s?.Gross ?? 0,
                    ProducerCents = l.Producer,
                    PlatformCents = l.Platform,
                };
            })
            .OrderByDescending(r => r.GrossCents).ThenByDescending(r => r.Sales)
            .ToList();

            var totals = new
            {
                Sales = rows.Sum(r => r.Sales),
                GrossCents = rows.Sum(r => r.GrossCents),
                ProducerCents = rows.Sum(r => r.ProducerCents),
                PlatformCents = rows.Sum(r => r.PlatformCents),
            };
            return EndpointExtensions.Ok(new { Rows = rows, Totals = totals, MembershipRevenueCents = membershipTotal, ProducerShareBps = shareBps });
        });

        // setRevenueSplit(producerSharePercent) — 10..95 guardrail + audit.
        g.MapPut("/revenue-split", async Task<IResult> (AppDbContext db, SplitBody body, HttpContext ctx) =>
        {
            var p = Number(body.ProducerSharePercent);
            if (!double.IsFinite(p) || p < 10 || p > 95)
                return EndpointExtensions.Fail("Producer share must be between 10 and 95 percent.");
            var bps = await PlatformSettingsService.SetProducerShareBpsAsync(db, Math.Round(p * 100, MidpointRounding.AwayFromZero));
            var pct = PlatformSettingsService.BpsToPercent(bps);
            db.AuditLogs.Add(new AuditLog
            {
                Id = Ids.NewId(), ActorId = ((SessionPrincipal)ctx.Items["principal"]!).UserId,
                Action = "SET_REVENUE_SPLIT",
                Detail = $"{pct}% producer / {Trim(100 - pct)}% platform — future sales only",
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return EndpointExtensions.Ok(new { ProducerShareBps = bps });
        });
        g.MapGet("/revenue-split", async (AppDbContext db) =>
            EndpointExtensions.Ok(new { ProducerShareBps = await PlatformSettingsService.GetProducerShareBpsAsync(db) }));

        // moderate(resourceId, action, reason?)
        g.MapPost("/moderate", async Task<IResult> (AppDbContext db, ModerateBody body, HttpContext ctx) =>
        {
            var r = await db.Resources.FindAsync(body.ResourceId);
            if (r is null) return EndpointExtensions.Fail("Title not found.");
            if (body.Action == "reject" && ((body.Reason ?? "").Trim().Length < 4))
                return EndpointExtensions.Fail("A rejection reason is required.");

            var to = body.Action switch
            {
                "approve" => "PUBLISHED", "reject" => "REJECTED",
                "suspend" => "SUSPENDED", "republish" => "PUBLISHED", _ => null,
            };
            if (to is null) return EndpointExtensions.Fail("Unknown moderation action.");
            if (!ModerationService.CanTransition(r.Status, to))
                return EndpointExtensions.Fail($"Cannot move {r.Status} → {to}.");

            r.Status = to;
            r.RejectionReason = body.Action == "reject" ? body.Reason!.Trim() : null;
            db.AuditLogs.Add(new AuditLog
            {
                Id = Ids.NewId(), ActorId = ((SessionPrincipal)ctx.Items["principal"]!).UserId,
                ResourceId = r.Id, Action = $"MODERATE_{to}",
                Detail = string.IsNullOrWhiteSpace(body.Reason) ? null : body.Reason.Trim(),
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // setDiscount(resourceId, percent, days)
        g.MapPost("/discount", async Task<IResult> (AppDbContext db, DiscountBody body, HttpContext ctx) =>
        {
            var percent = Number(body.Percent); var days = Number(body.Days);
            var pr = (int)Math.Round(percent, MidpointRounding.AwayFromZero);
            if (!double.IsFinite(percent) || pr < 0 || pr > 90)
                return EndpointExtensions.Fail("Discount must be between 0 and 90 percent.");
            var d = (int)Math.Round(days, MidpointRounding.AwayFromZero);
            if (pr > 0 && (d < 1 || d > 90))
                return EndpointExtensions.Fail("Duration must be between 1 and 90 days.");

            var r = await db.Resources.FindAsync(body.ResourceId);
            if (r is null) return EndpointExtensions.Fail("Title not found.");
            if (r.Status != "PUBLISHED")
                return EndpointExtensions.Fail("Only published titles can carry a discount.");

            if (pr == 0) { r.DiscountPercent = 0; r.DiscountEndsAt = null; }
            else { r.DiscountPercent = pr; r.DiscountEndsAt = DateTime.UtcNow.AddDays(d); }
            r.UpdatedAt = DateTime.UtcNow;
            db.AuditLogs.Add(new AuditLog
            {
                Id = Ids.NewId(), ActorId = ((SessionPrincipal)ctx.Items["principal"]!).UserId,
                ResourceId = r.Id, Action = "SET_DISCOUNT",
                Detail = pr == 0 ? "cleared discount" : $"{pr}% for {d} days",
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return EndpointExtensions.OkUnit();
        });

        // sendDiscountCampaign(resourceId)
        g.MapPost("/campaign", async Task<IResult> (AppDbContext db, CampaignBody body, HttpContext ctx) =>
        {
            var r = await db.Resources.FindAsync(body.ResourceId);
            if (r is null || r.Status != "PUBLISHED")
                return EndpointExtensions.Fail("Only published titles can be promoted.");
            if (!PricingService.IsDiscountActive(r))
                return EndpointExtensions.Fail("Set an active discount first — there is nothing to announce.");

            var recipients = await db.Users.Where(u => u.Role != "ADMIN").Select(u => u.Id).ToListAsync();
            var ends = r.DiscountEndsAt?.ToString("MMM d", new System.Globalization.CultureInfo("en-US"));
            var price = PricingService.EffectivePriceCents(r);
            var title = $"{r.Title} — {r.DiscountPercent}% off";
            var text = $"\"{r.Title}\" is {r.DiscountPercent}% off{(ends is null ? "" : $" through {ends}")} — now {PriceFormat.Format(price)}. Grab it before the deal ends.";

            db.Notifications.AddRange(recipients.Select(uid => new Notification
            { Id = Ids.NewId(), UserId = uid, Kind = "CAMPAIGN", Title = title, Body = text, ResourceId = r.Id, CreatedAt = DateTime.UtcNow }));
            db.AuditLogs.Add(new AuditLog
            {
                Id = Ids.NewId(), ActorId = ((SessionPrincipal)ctx.Items["principal"]!).UserId,
                ResourceId = r.Id, Action = "DISCOUNT_CAMPAIGN",
                Detail = $"{recipients.Count} recipients • {r.DiscountPercent}% off",
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return EndpointExtensions.Ok(new { Recipients = recipients.Count });
        });
    }

    public record SplitBody(double ProducerSharePercent);
    public record ModerateBody(string ResourceId, string Action, string? Reason);
    public record DiscountBody(string ResourceId, double Percent, double Days);
    public record CampaignBody(string ResourceId);

    private static double Number(object? v) => v switch
    {
        null => double.NaN,
        double d => d,
        int i => i,
        long l => l,
        string s when double.TryParse(s, out var d2) => d2,
        _ => double.NaN,
    };

    private static string Trim(double v) => v.ToString("0.##").TrimEnd('.');
}
