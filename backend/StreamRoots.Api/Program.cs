// ── StreamRoots.Api — the .NET 9 backend ─────────────────────────────
// Replaces the Next.js server-action backend 1:1 against the SAME
// Prisma-owned PostgreSQL schema. The frontend never changes: it proxies
// to this API (Bearer session token) or, in single-process sandbox
// previews, keeps its direct path. Session cookies minted by either
// implementation validate on both (same HMAC format, same scrypt hashes).
using Microsoft.EntityFrameworkCore;
using StreamRoots.Api.Data;
using StreamRoots.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

// PostgreSQL connection — the same database Prisma migrates.
var conn = Environment.GetEnvironmentVariable("STREAMROOTS_PG")
    ?? "Host=127.0.0.1;Port=5433;Database=streamroots;Username=streamroots";
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(conn));

// Dev CORS: the Next.js dev server calls this API server-to-server (no
// CORS needed), but direct browser testing uses the cookie — allow it.
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:3000", "http://127.0.0.1:3000")
    .AllowCredentials().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();

app.MapGet("/health", () => Results.Json(new
{
    ok = true,
    service = "StreamRoots.Api",
    version = "1.0.0",
    runtime = Environment.Version.ToString(),
}));

AuthEndpoints.Map(app);
CatalogEndpoints.Map(app);
PlaybackEndpoints.Map(app);
CheckoutEndpoints.Map(app);
AdminEndpoints.Map(app);
ProducerEndpoints.Map(app);
EngageEndpoints.Map(app);

app.Run();

public partial class Program; // exposes Program for WebApplicationFactory tests
