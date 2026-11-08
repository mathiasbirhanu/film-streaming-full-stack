// ── Domain entities — mapped 1:1 onto the Prisma-owned PostgreSQL tables ──
// Prisma owns the schema (migrations happen ONLY via `prisma db push`).
// EF here is a consumer of those tables: every table/column name below is
// quoted exactly as Prisma created it ("User", "passwordHash", "createdAt").
// Status/role/kind stay strings to mirror the TS service-layer validation.
namespace StreamRoots.Api.Models;

public class User
{
    public string Id { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "VIEWER";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class Membership
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Status { get; set; } = "ACTIVE";
    public string Plan { get; set; } = "MONTHLY";
    public int PriceCents { get; set; } = 799;
    public DateTime StartedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public string Provider { get; set; } = "DEMO";
    public string? ProviderRef { get; set; }
}

public class Resource
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Genre { get; set; } = "General";
    public int? Year { get; set; }
    public string VideoSourceType { get; set; } = "YOUTUBE";
    public string SourceRef { get; set; } = "";
    public string? PosterUrl { get; set; }
    public string PricingType { get; set; } = "PPV";
    public int PriceCents { get; set; }
    public int DiscountPercent { get; set; }
    public DateTime? DiscountEndsAt { get; set; }
    public string Status { get; set; } = "DRAFT";
    public string? RejectionReason { get; set; }
    public string? ProducerId { get; set; }
    public int ViewCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public User? Producer { get; set; }
}

public class Playlist
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Status { get; set; } = "DRAFT";
    public string ProducerId { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public User? Producer { get; set; }
    public List<PlaylistItem> Items { get; set; } = [];
}

public class PlaylistItem
{
    public string Id { get; set; } = "";
    public string PlaylistId { get; set; } = "";
    public string ResourceId { get; set; } = "";
    public int Position { get; set; }
}

public class Purchase
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string ResourceId { get; set; } = "";
    public string Kind { get; set; } = "PPV_LIFETIME";
    public int AmountCents { get; set; }
    public string Status { get; set; } = "COMPLETED";
    public string Provider { get; set; } = "DEMO";
    public string? ProviderRef { get; set; }
    public DateTime CreatedAt { get; set; }

    public Resource Resource { get; set; } = null!;
}

public class ViewingProgress
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string ResourceId { get; set; } = "";
    public int PositionSeconds { get; set; }
    public int DurationSeconds { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Resource Resource { get; set; } = null!;
}

public class PayoutEntry
{
    public string Id { get; set; } = "";
    public string? ProducerId { get; set; }
    public string ResourceId { get; set; } = "";
    public string? PurchaseId { get; set; }
    public string Type { get; set; } = "EARNED";
    public int AmountCents { get; set; }
    public string Status { get; set; } = "PAYABLE";
    public DateTime CreatedAt { get; set; }

    public Resource Resource { get; set; } = null!;
}

public class Notification
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Kind { get; set; } = "CAMPAIGN";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? ResourceId { get; set; }
    public DateTime? ReadAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Setting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}

public class AuditLog
{
    public string Id { get; set; } = "";
    public string? ActorId { get; set; }
    public string Action { get; set; } = "";
    public string? ResourceId { get; set; }
    public string? Detail { get; set; }
    public DateTime CreatedAt { get; set; }
}
