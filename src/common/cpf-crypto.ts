import { createCipheriv, createDecipheriv, createHmac } from 'crypto';

/// CPF encryption at rest — LGPD-driven.
///
/// **Scheme:** AES-256-GCM with a 12-byte IV deterministically derived from
/// `HMAC-SHA256(key, plaintext).slice(0, 12)`. Same plaintext always produces
/// the same ciphertext, which is what lets the existing `@unique` constraint
/// on `User.cpf` keep working on the encrypted column without any schema
/// change. The IV is *not* the plaintext itself — it's bound to the key, so
/// an attacker without the key can't predict IVs or mount a chosen-plaintext
/// attack via IV reuse.
///
/// **Threat model covered:** DB / backup leak. An attacker with raw rows
/// sees opaque base64 blobs that need the key to decrypt.
///
/// **Threat model NOT covered:** an attacker who has *both* the DB and the
/// key. Or one with the key + ability to encrypt arbitrary CPFs (chosen-
/// plaintext via the live API) — they could compare ciphertexts. The
/// existing `@unique` on the column already leaks "two users share a CPF"
/// by design, so deterministic encryption adds no extra leak.
///
/// **Key handling:** `CPF_ENCRYPTION_KEY` env var, 32 raw bytes base64-
/// encoded. Lose this key = every stored CPF is unrecoverable. Back it up
/// offline AND in the deploy environment.

const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = process.env.CPF_ENCRYPTION_KEY;
  if (!env) {
    throw new Error(
      'CPF_ENCRYPTION_KEY env var is not set. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(env, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `CPF_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}).`,
    );
  }
  cachedKey = key;
  return key;
}

/// Reset the cached key — exposed for tests so the env can be swapped
/// between cases without restarting the process. Production code never
/// calls this.
export function resetCpfEncryptionKeyCache(): void {
  cachedKey = null;
}

/// Encrypts a plaintext CPF for storage. Output is base64 of
/// `IV(12) || authTag(16) || ciphertext`. Deterministic per plaintext.
export function encryptCpf(plaintext: string): string {
  if (!plaintext) throw new Error('encryptCpf: empty plaintext');
  const key = getKey();
  const iv = createHmac('sha256', key)
    .update(plaintext)
    .digest()
    .subarray(0, 12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/// Decrypts a stored ciphertext back to the original CPF. Throws if the
/// ciphertext is malformed or tampered (GCM auth tag mismatch).
export function decryptCpf(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < 12 + 16 + 1) {
    throw new Error('decryptCpf: ciphertext too short');
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString('utf8');
}

/// Lenient decrypt for transitional reads. Returns:
///   - `null` if `value` is null/undefined/empty
///   - the value itself when it's still raw plaintext (11 digits) — covers
///     rows that haven't been re-encrypted by the data migration yet
///   - the decrypted plaintext when the value is a valid ciphertext
///   - `null` when decryption fails (corrupted / wrong key)
/// Used in `findById` and Asaas customer sync so the app keeps working
/// across the migration window.
export function tryDecryptCpf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{11}$/.test(value)) return value;
  try {
    return decryptCpf(value);
  } catch {
    return null;
  }
}
