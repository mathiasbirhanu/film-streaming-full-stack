// ── EF Core context over the Prisma-owned schema ─────────────────────
// Every table/column is named EXACTLY as Prisma created it in PostgreSQL
// (PascalCase tables, camelCase columns, quoted identifiers). This context
// never migrates — `prisma db push` remains the only schema owner.
using Microsoft.EntityFrameworkCore;
using StreamRoots.Api.Models;

namespace StreamRoots.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Resource> Resources => Set<Resource>();
    public DbSet<Playlist> Playlists => Set<Playlist>();
    public DbSet<PlaylistItem> PlaylistItems => Set<PlaylistItem>();
    public DbSet<Purchase> Purchases => Set<Purchase>();
    public DbSet<ViewingProgress> ViewingProgress => Set<ViewingProgress>();
    public DbSet<PayoutEntry> PayoutEntries => Set<PayoutEntry>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // Prisma column names are camelCase of the TS field names.
        void Map<T>(string table, params (string prop, string col)[] overrides) where T : class
        {
            var e = mb.Entity<T>().ToTable(table);
            foreach (var (prop, col) in overrides) e.Property(prop).HasColumnName(col);
        }

        Map<User>("User", ("Id", "id"), ("Email", "email"), ("Name", "name"),
            ("PasswordHash", "passwordHash"), ("Role", "role"),
            ("CreatedAt", "createdAt"), ("UpdatedAt", "updatedAt"));
        Map<Membership>("Membership", ("Id", "id"), ("UserId", "userId"), ("Status", "status"),
            ("Plan", "plan"), ("PriceCents", "priceCents"), ("StartedAt", "startedAt"),
            ("ExpiresAt", "expiresAt"), ("Provider", "provider"), ("ProviderRef", "providerRef"));
        Map<Resource>("Resource", ("Id", "id"), ("Title", "title"), ("Description", "description"),
            ("Genre", "genre"), ("Year", "year"), ("VideoSourceType", "videoSourceType"),
            ("SourceRef", "sourceRef"), ("PosterUrl", "posterUrl"), ("PricingType", "pricingType"),
            ("PriceCents", "priceCents"), ("DiscountPercent", "discountPercent"),
            ("DiscountEndsAt", "discountEndsAt"), ("Status", "status"),
            ("RejectionReason", "rejectionReason"), ("ProducerId", "producerId"),
            ("ViewCount", "viewCount"), ("CreatedAt", "createdAt"), ("UpdatedAt", "updatedAt"));
        Map<Playlist>("Playlist", ("Id", "id"), ("Title", "title"), ("Description", "description"),
            ("Status", "status"), ("ProducerId", "producerId"),
            ("CreatedAt", "createdAt"), ("UpdatedAt", "updatedAt"));
        Map<PlaylistItem>("PlaylistItem", ("Id", "id"), ("PlaylistId", "playlistId"),
            ("ResourceId", "resourceId"), ("Position", "position"));
        Map<Purchase>("Purchase", ("Id", "id"), ("UserId", "userId"), ("ResourceId", "resourceId"),
            ("Kind", "kind"), ("AmountCents", "amountCents"), ("Status", "status"),
            ("Provider", "provider"), ("ProviderRef", "providerRef"), ("CreatedAt", "createdAt"));
        Map<ViewingProgress>("ViewingProgress", ("Id", "id"), ("UserId", "userId"),
            ("ResourceId", "resourceId"), ("PositionSeconds", "positionSeconds"),
            ("DurationSeconds", "durationSeconds"), ("UpdatedAt", "updatedAt"));
        Map<PayoutEntry>("PayoutEntry", ("Id", "id"), ("ProducerId", "producerId"),
            ("ResourceId", "resourceId"), ("PurchaseId", "purchaseId"), ("Type", "type"),
            ("AmountCents", "amountCents"), ("Status", "status"), ("CreatedAt", "createdAt"));
        Map<Notification>("Notification", ("Id", "id"), ("UserId", "userId"), ("Kind", "kind"),
            ("Title", "title"), ("Body", "body"), ("ResourceId", "resourceId"),
            ("ReadAt", "readAt"), ("CreatedAt", "createdAt"));
        Map<Setting>("Setting", ("Key", "key"), ("Value", "value"), ("UpdatedAt", "updatedAt"));
        mb.Entity<Setting>().HasKey(s => s.Key); // Prisma @id on `key` — EF can't infer a non-Id PK name
        Map<AuditLog>("AuditLog", ("Id", "id"), ("ActorId", "actorId"), ("Action", "action"),
            ("ResourceId", "resourceId"), ("Detail", "detail"), ("CreatedAt", "createdAt"));

        // Prisma FK relationships (navigations are query conveniences only —
        // the FK columns and constraints live in the Prisma schema).
        mb.Entity<Resource>().HasOne(r => r.Producer).WithMany()
            .HasForeignKey(r => r.ProducerId).IsRequired(false);
        mb.Entity<Playlist>().HasOne(p => p.Producer).WithMany()
            .HasForeignKey(p => p.ProducerId).IsRequired(false);
        mb.Entity<Playlist>().HasMany(p => p.Items).WithOne()
            .HasForeignKey(i => i.PlaylistId);
        mb.Entity<Purchase>().HasOne(p => p.Resource).WithMany()
            .HasForeignKey(p => p.ResourceId);
        mb.Entity<ViewingProgress>().HasOne(v => v.Resource).WithMany()
            .HasForeignKey(v => v.ResourceId);
        mb.Entity<PayoutEntry>().HasOne(e => e.Resource).WithMany()
            .HasForeignKey(e => e.ResourceId);
    }
}
