import { randomBytes } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';

/// 32-char alphabet without ambiguous glyphs (no I, O, 0, 1) so the code
/// is readable when shouted across a beach or screenshotted. Power of two
/// (32) so the modulo distributes uniformly across `randomBytes`.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_GENERATION_ATTEMPTS = 8;

/// Returns the canonical (uppercase, no separator) form of a friend code.
/// Accepts inputs with hyphens or spaces and any case, e.g. `bb7k-9xqm` →
/// `BB7K9XQM`. Validates length + alphabet; returns null on bad input.
export function normalizeCode(input: string): string | null {
  const stripped = input.replace(/[-\s]/g, '').toUpperCase();
  if (stripped.length !== CODE_LENGTH) return null;
  for (const ch of stripped) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return stripped;
}

/// Display form: `XXXX-XXXX`. Used by the API responses so the UI doesn't
/// have to remember to insert the hyphen consistently.
export function formatCode(canonical: string): string {
  return `${canonical.slice(0, 4)}-${canonical.slice(4)}`;
}

function generateRandomCode(): string {
  // 8 bytes / 8 chars — 1 byte per char, mod 32 keeps the distribution
  // uniform because 256 % 32 === 0.
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/// Generate a unique friend code, retrying on collisions. Throws if the
/// alphabet is exhausted — extremely unlikely (~1.1e12 codes) but keeps
/// the code from spinning forever in case of a Prisma misconfiguration.
export async function generateUniqueFriendCode(
  prisma: PrismaService,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateRandomCode();
    const existing = await prisma.user.findUnique({
      where: { friendCode: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error(
    `Could not generate a unique friend code after ${MAX_GENERATION_ATTEMPTS} attempts`,
  );
}
