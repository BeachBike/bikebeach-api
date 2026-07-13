/// Password strength policy — "Forte equilibrada" (chosen 2026-07-13).
///
/// Rationale: passwords are stored with bcrypt cost 12, so a DB leak does not
/// expose plaintext — the real risk is an attacker *guessing* a weak password
/// against the leaked hash. The two defenses that matter most are (1) refusing
/// common / guessable passwords and (2) length. Composition (mixing character
/// classes) adds some entropy on top. This module is the single source of
/// truth; the frontend mirrors it (web `password-strength.tsx`) for live UX,
/// but the API is authoritative.
///
/// The rule:
///   - 10–72 characters (72 = bcrypt's byte ceiling)
///   - at least 3 of the 4 classes: lowercase, uppercase, digit, symbol
///   - not a well-known common password
///   - not (trivially) the user's own e-mail or name

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_MIN_CLASSES = 3;

/// Most-abused passwords + obvious local ones, stored lowercased. Kept small
/// and focused on values that would otherwise *pass* the composition check
/// (e.g. "Password1!", "Senha@123") — the short/simple ones are already
/// rejected by length or the class rule. The check lowercases the candidate,
/// so only lowercase forms need to live here.
const COMMON_PASSWORDS = new Set<string>([
  'password',
  'password1',
  'password12',
  'password123',
  'password1!',
  'password@123',
  'passw0rd',
  'passw0rd!',
  'passw0rd123',
  'p@ssw0rd',
  'p@ssword1',
  'qwertyuiop',
  'qwerty123',
  'qwerty123!',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'zaq12wsx',
  '1234567890',
  '12345678910',
  'senha12345',
  'senha123456',
  'senha@123',
  'senha1234',
  'mudar123456',
  'mudar@123',
  'trocar123',
  'bemvindo123',
  'bemvindo@123',
  'brasil123',
  'brasil@123',
  'admin12345',
  'admin@123',
  'administrador',
  'changeme123',
  'welcome123',
  'welcome1!',
  'iloveyou123',
  'abcd123456',
  'abc123456',
  'letmein123',
  'sunshine1',
  'football1',
  'baseball1',
  'superman1',
  'batman123',
  'monkey123',
  'dragon123',
  'master123',
  'princess1',
  'michael123',
  'jordan123',
  'bikebeach',
  'bikebeach1',
  'bikebeach12',
  'bikebeach123',
  'bikebeach@123',
]);

export interface PasswordContext {
  /// The signing-up user's e-mail, if available on the DTO. Used to reject a
  /// password that's just the e-mail (or its local part).
  email?: string;
  /// The user's name, if available on the DTO.
  name?: string;
}

function countCharClasses(pwd: string): number {
  let n = 0;
  if (/[a-z]/.test(pwd)) n++;
  if (/[A-Z]/.test(pwd)) n++;
  if (/[0-9]/.test(pwd)) n++;
  if (/[^A-Za-z0-9]/.test(pwd)) n++;
  return n;
}

function looksLikeIdentity(pwd: string, ctx: PasswordContext): boolean {
  const lower = pwd.trim().toLowerCase();
  if (!lower) return false;
  const candidates: string[] = [];
  if (ctx.email) {
    const email = ctx.email.trim().toLowerCase();
    candidates.push(email);
    const local = email.split('@')[0];
    if (local) candidates.push(local);
  }
  if (ctx.name) {
    const name = ctx.name.trim().toLowerCase();
    candidates.push(name);
    candidates.push(name.replace(/\s+/g, ''));
  }
  return candidates.some((c) => c.length >= 3 && c === lower);
}

/// Returns every reason the password fails the policy (empty array = OK).
/// Human-readable pt-BR strings so they can be surfaced verbatim to the user.
export function passwordPolicyIssues(
  pwd: string,
  ctx: PasswordContext = {},
): string[] {
  const issues: string[] = [];

  if (pwd.length < PASSWORD_MIN_LENGTH) {
    issues.push(`use no mínimo ${PASSWORD_MIN_LENGTH} caracteres`);
  } else if (pwd.length > PASSWORD_MAX_LENGTH) {
    issues.push(`use no máximo ${PASSWORD_MAX_LENGTH} caracteres`);
  }

  if (countCharClasses(pwd) < PASSWORD_MIN_CLASSES) {
    issues.push(
      `misture pelo menos ${PASSWORD_MIN_CLASSES} tipos entre minúscula, maiúscula, número e símbolo`,
    );
  }

  if (COMMON_PASSWORDS.has(pwd.trim().toLowerCase())) {
    issues.push('essa senha é muito comum — escolha algo mais difícil de adivinhar');
  }

  if (looksLikeIdentity(pwd, ctx)) {
    issues.push('a senha não pode ser o seu e-mail ou nome');
  }

  return issues;
}

/// True when the password satisfies the full policy for the given context.
export function isStrongPassword(
  pwd: string,
  ctx: PasswordContext = {},
): boolean {
  return passwordPolicyIssues(pwd, ctx).length === 0;
}
