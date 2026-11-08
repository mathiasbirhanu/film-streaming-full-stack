// ── scrypt (RFC 7914) — byte-compatible with Node's crypto.scryptSync ──
// The TS side stores `salt:hash` where salt is 16 random bytes as hex and
// the scrypt salt input is the UTF-8 bytes of that hex STRING (Node
// converts string salts with utf8 — NOT hex-decoded). Parameters are
// Node's defaults: N=16384, r=8, p=1, keyLen=64. Every parameter is fixed
// here so hashes produced by either side verify on both sides forever.
using System.Security.Cryptography;
using System.Text;

namespace StreamRoots.Api.Security;

public static class ScryptHasher
{
    private const int N = 16384, R = 8, P = 1, KeyLen = 64;

    public static string Hash(string password)
    {
        var saltBytes = RandomNumberGenerator.GetBytes(16);
        var saltHex = Convert.ToHexString(saltBytes).ToLowerInvariant();
        // Node treats a string salt as its UTF-8 bytes — so the scrypt salt
        // is the hex TEXT, never the decoded bytes.
        var dk = Derive(password, Encoding.UTF8.GetBytes(saltHex), N, R, P, KeyLen);
        return $"{saltHex}:{Convert.ToHexString(dk).ToLowerInvariant()}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split(':', 2);
        if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0) return false;
        var expected = HexToBytes(parts[1]);
        var candidate = Derive(password, Encoding.UTF8.GetBytes(parts[0]), N, R, P, expected.Length);
        return CryptographicOperations.FixedTimeEquals(candidate, expected);
    }

    public static byte[] Derive(string password, byte[] salt, int n, int r, int p, int dkLen)
    {
        var blockCount = 128 * r;
        var b = Pbkdf2Sha256(password, salt, 1, p * blockCount);

        for (var i = 0; i < p; i++)
        {
            var span = b.AsSpan(i * blockCount, blockCount);
            Romix(r, span, n);
        }
        return Pbkdf2Sha256(password, b, 1, dkLen);
    }

    // B_i ← pbkdf2 output block i, ROMixed in place
    private static void Romix(int r, Span<byte> block, int n)
    {
        var len = 128 * r;
        var v = new byte[n * len];
        var x = new byte[len];
        block.CopyTo(x);

        for (var i = 0; i < n; i++)
        {
            x.CopyTo(v.AsSpan(i * len, len));
            BlockMix(r, x);
        }
        for (var i = 0; i < n; i++)
        {
            // Integerify: little-endian u64 of the first 8 bytes of the last
            // 64-byte word of X (RFC 7914 §2.2 step 5)
            var j = (int)(BitConverter.ToUInt64(x.AsSpan(len - 64, 8)) & (ulong)(n - 1));
            XorInto(x, v.AsSpan(j * len, len));
            BlockMix(r, x);
        }
        x.CopyTo(block);
    }

    private static void XorInto(Span<byte> target, ReadOnlySpan<byte> other)
    {
        for (var i = 0; i < target.Length; i++) target[i] ^= other[i];
    }

    // BlockMix: B = (B_0..B_{2r-1}), X = B_{2r-1}; Y_i = Salsa20/8(X ⊕ B_i)
    // output interleaved evens-then-odds (RFC 7914 §2.2)
    private static void BlockMix(int r, Span<byte> b)
    {
        var len = 128 * r;
        Span<byte> y = stackalloc byte[len]; // r=8 → 1024 bytes, fine on stack
        Span<byte> x = stackalloc byte[64];
        b.Slice(len - 64, 64).CopyTo(x);

        for (var i = 0; i < 2 * r; i++)
        {
            for (var k = 0; k < 64; k++) x[k] ^= b[i * 64 + k];
            Salsa208(x);
            x.CopyTo(y.Slice(i * 64, 64));
        }
        for (var i = 0; i < r; i++)
        {
            y.Slice(i * 128, 64).CopyTo(b.Slice(i * 64, 64));          // evens
            y.Slice(i * 128 + 64, 64).CopyTo(b.Slice((r + i) * 64, 64)); // odds
        }
    }

    // Salsa20/8 core: 8 rounds (4 column + 4 row) + input addition
    private static void Salsa208(Span<byte> block)
    {
        Span<uint> x = stackalloc uint[16];
        var input = new uint[16];
        for (var i = 0; i < 16; i++)
        {
            x[i] = input[i] = BitConverter.ToUInt32(block.Slice(i * 4, 4));
        }
        for (var round = 0; round < 8; round += 2)
        {
            // column round
            x[4] ^= BitRot(x[0] + x[12], 7);  x[8] ^= BitRot(x[4] + x[0], 9);
            x[12] ^= BitRot(x[8] + x[4], 13); x[0] ^= BitRot(x[12] + x[8], 18);
            x[9] ^= BitRot(x[5] + x[1], 7);   x[13] ^= BitRot(x[9] + x[5], 9);
            x[1] ^= BitRot(x[13] + x[9], 13); x[5] ^= BitRot(x[1] + x[13], 18);
            x[14] ^= BitRot(x[10] + x[6], 7); x[2] ^= BitRot(x[14] + x[10], 9);
            x[6] ^= BitRot(x[2] + x[14], 13); x[10] ^= BitRot(x[6] + x[2], 18);
            x[3] ^= BitRot(x[15] + x[11], 7); x[7] ^= BitRot(x[3] + x[15], 9);
            x[11] ^= BitRot(x[7] + x[3], 13); x[15] ^= BitRot(x[11] + x[7], 18);
            // row round
            x[1] ^= BitRot(x[0] + x[3], 7);   x[2] ^= BitRot(x[1] + x[0], 9);
            x[3] ^= BitRot(x[2] + x[1], 13);  x[0] ^= BitRot(x[3] + x[2], 18);
            x[6] ^= BitRot(x[5] + x[4], 7);   x[7] ^= BitRot(x[6] + x[5], 9);
            x[4] ^= BitRot(x[7] + x[6], 13);  x[5] ^= BitRot(x[4] + x[7], 18);
            x[11] ^= BitRot(x[10] + x[9], 7); x[8] ^= BitRot(x[11] + x[10], 9);
            x[9] ^= BitRot(x[8] + x[11], 13); x[10] ^= BitRot(x[9] + x[8], 18);
            x[12] ^= BitRot(x[15] + x[14], 7); x[13] ^= BitRot(x[12] + x[15], 9);
            x[14] ^= BitRot(x[13] + x[12], 13); x[15] ^= BitRot(x[14] + x[13], 18);
        }
        for (var i = 0; i < 16; i++)
        {
            var sum = input[i] + x[i];
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(block.Slice(i * 4, 4), sum);
        }
    }

    private static uint BitRot(uint v, int rot) => (v << rot) | (v >> (32 - rot));

    public static byte[] Pbkdf2Sha256(string password, byte[] salt, int iterations, int length)
        => Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, length);

    public static byte[] HexToBytes(string hex)
    {
        var b = new byte[hex.Length / 2];
        for (var i = 0; i < b.Length; i++)
            b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
        return b;
    }
}
