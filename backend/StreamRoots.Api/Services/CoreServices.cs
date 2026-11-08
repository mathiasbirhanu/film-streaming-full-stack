// ── Business services — line-for-line ports of src/lib/services/*.ts ──
// Pure logic first (identical integer math), DB-backed settings second.
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using StreamRoots.Api.Data;
using StreamRoots.Api.Models;
using StreamRoots.Api.Security;

namespace StreamRoots.Api.Services;

// ── Pricing (pricing.ts) ─────────────────────────────────────────────
public static class PricingService
{
    public record PriceView(bool HasDiscount, int OriginalPriceCents, int EffectivePriceCents, int DiscountPercent);

    public static bool IsDiscountActive(Resource r, DateTimeOffset? now = null)
    {
        if (r.DiscountPercent <= 0) return false;
        if (r.DiscountEndsAt is null) return true;
        return new DateTimeOffset(r.DiscountEndsAt.Value, TimeSpan.Zero).ToUnixTimeMilliseconds()
             > (now ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds();
    }

    public static int EffectivePriceCents(Resource r, DateTimeOffset? now = null)
    {
        if (IsDiscountActive(r, now))
            return Math.Max(0, (int)Math.Round((decimal)r.PriceCents * (100 - r.DiscountPercent) / 100, MidpointRounding.AwayFromZero));
        return r.PriceCents;
    }

    public static PriceView View(Resource r, DateTimeOffset? now = null)
    {
        var active = IsDiscountActive(r, now);
        return new PriceView(active, r.PriceCents, EffectivePriceCents(r, now), active ? r.DiscountPercent : 0);
    }
}

// ── Platform settings (platform-settings.ts) ─────────────────────────
public static class PlatformSettingsService
{
    public const string ShareKey = "producerShareBps";
    public const int DefaultProducerShareBps = 7000;
    private const int MinBps = 1000, MaxBps = 9500;

    public static int ClampShareBps(double bps)
    {
        if (!double.IsFinite(bps)) return DefaultProducerShareBps;
        return (int)Math.Min(MaxBps, Math.Max(MinBps, Math.Round(bps, MidpointRounding.AwayFromZero)));
    }

    public static double BpsToPercent(int bps) => Math.Round(bps / 100.0, 2);

    public static async Task<int> GetProducerShareBpsAsync(AppDbContext db)
    {
        var row = await db.Settings.FindAsync(ShareKey);
        if (row is null) return DefaultProducerShareBps;
        return int.TryParse(row.Value, out var v) ? ClampShareBps(v) : DefaultProducerShareBps;
    }

    public static async Task<int> SetProducerShareBpsAsync(AppDbContext db, double bps)
    {
        var v = ClampShareBps(bps);
        var row = await db.Settings.FindAsync(ShareKey);
        if (row is null)
            db.Settings.Add(new Setting { Key = ShareKey, Value = v.ToString(), UpdatedAt = DateTime.UtcNow });
        else { row.Value = v.ToString(); row.UpdatedAt = DateTime.UtcNow; }
        await db.SaveChangesAsync();
        return v;
    }
}

// ── Entitlement (entitlement.ts) ─────────────────────────────────────
public static class EntitlementService
{
    public record AccessCheck(bool CanWatch, string Reason, bool HasDiscount, int OriginalPriceCents, int EffectivePriceCents, int DiscountPercent);

    public static bool MembershipIsActive(Membership? m) =>
        m is not null && m.Status == "ACTIVE" && new DateTimeOffset(m.ExpiresAt, TimeSpan.Zero).ToUnixTimeMilliseconds() > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public static AccessCheck Resolve(SessionPrincipal? user, Resource resource, Membership? membership, Purchase? purchase)
    {
        var price = PricingService.View(resource);
        AccessCheck Check(bool can, string reason) =>
            new(can, reason, price.HasDiscount, price.OriginalPriceCents, price.EffectivePriceCents, price.DiscountPercent);

        if (resource.Status != "PUBLISHED") return Check(false, "UNAVAILABLE");
        if (user is null) return Check(false, "LOGIN_REQUIRED");
        if (resource.PricingType == "FREE") return Check(true, "ENTITLED");
        if (resource.PricingType == "MEMBERSHIP")
            return MembershipIsActive(membership) ? Check(true, "ENTITLED") : Check(false, "NEED_SUBSCRIPTION");
        if (purchase is not null && purchase.Status == "COMPLETED") return Check(true, "ENTITLED");
        return Check(false, "NEED_PURCHASE");
    }
}

// ── Moderation state machine (moderation.ts) ─────────────────────────
public static class ModerationService
{
    public static readonly Dictionary<string, string[]> Transitions = new()
    {
        ["DRAFT"] = ["PENDING_REVIEW", "PUBLISHED"],
        ["PENDING_REVIEW"] = ["PUBLISHED", "REJECTED"],
        ["PUBLISHED"] = ["SUSPENDED", "PENDING_REVIEW"],
        ["REJECTED"] = ["PENDING_REVIEW", "PUBLISHED"],
        ["SUSPENDED"] = ["PUBLISHED"],
    };

    public static bool CanTransition(string from, string to) =>
        Transitions.TryGetValue(from, out var tos) && tos.Contains(to);
}

// ── Payments gateway seam (payments-gateway.ts) ──────────────────────
public enum PaymentMethod { TELEBIRR, CBE_BIRR, CHAPA, CARD }

public static class PaymentsGateway
{
    public const int EtbPerUsd = 132;
    public static readonly string[] ValidMethods = ["TELEBIRR", "CBE_BIRR", "CHAPA", "CARD"];

    public record ChargeResult(string Provider, string ProviderRef);

    public static bool IsPaymentMethod(string v) => ValidMethods.Contains(v);

    public static string EtbFromCents(int cents) =>
        Math.Round((decimal)cents / 100 * EtbPerUsd, MidpointRounding.AwayFromZero)
            .ToString("N0", new System.Globalization.CultureInfo("en-US"));

    public static async Task<ChargeResult> AuthorizeChargeAsync(int amountCents, PaymentMethod method, string description)
    {
        _ = description; _ = amountCents; // unused, mirrors the TS signature
        // Simulated authorization latency so the checkout UX matches live rails.
        await Task.Delay(1200);
        var prefix = method switch
        {
            PaymentMethod.TELEBIRR => "tb_",
            PaymentMethod.CBE_BIRR => "cbe_",
            PaymentMethod.CHAPA => "chp_",
            _ => "crd_",
        };
        return new ChargeResult(method.ToString(), $"{prefix}{Guid.NewGuid().ToString()[..12]}");
    }
}

// ── Shared helpers ───────────────────────────────────────────────────
public static class Ids
{
    // cuid-shaped 25-char id (c + timestamp + randomness) — format is not a
    // contract, uniqueness is; Prisma treats it as opaque text.
    public static string NewId()
    {
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString("X11");
        var rand = RandomNumberGenerator.GetBytes(7);
        return "c" + ts.ToLowerInvariant() + Convert.ToHexString(rand).ToLowerInvariant();
    }
}

public static class PriceFormat
{
    public static string Format(int cents) => $"${((decimal)cents / 100).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)}";
}

public static class Constants
{
    public const int MembershipPriceCents = 799;
    public static readonly string[] Genres =
        ["Animation", "Documentary", "Drama", "Comedy", "Action", "Family", "Music", "Sci-Fi", "General"];
}
