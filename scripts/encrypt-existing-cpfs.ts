/// One-shot data migration: re-encrypt every plaintext CPF in the User
/// table. Idempotent — already-encrypted values (anything that isn't 11
/// digits) are skipped, so re-running is safe.
///
/// Usage (dev):
///   npx ts-node scripts/encrypt-existing-cpfs.ts
///
/// Usage (production, after deploying the code that does encrypt-on-write):
///   railway run npx ts-node scripts/encrypt-existing-cpfs.ts
///   (or run inside the deployed container with the same env)
///
/// Pre-requisites: `CPF_ENCRYPTION_KEY` must be set in the env this script
/// runs under. The same key must remain set on the API process afterwards
/// — otherwise no one can read the encrypted CPFs back.
import { PrismaClient } from '@prisma/client';
import { encryptCpf } from '../src/common/cpf-crypto';

async function main() {
  if (!process.env.CPF_ENCRYPTION_KEY) {
    throw new Error('CPF_ENCRYPTION_KEY is not set — refusing to run.');
  }
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.user.findMany({
      where: { cpf: { not: null } },
      select: { id: true, email: true, cpf: true },
    });
    let migrated = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.cpf) continue;
      // Plaintext CPFs are exactly 11 digits. Anything else is already a
      // ciphertext (base64) — leave it alone.
      if (!/^\d{11}$/.test(row.cpf)) {
        skipped++;
        continue;
      }
      const ciphertext = encryptCpf(row.cpf);
      await prisma.user.update({
        where: { id: row.id },
        data: { cpf: ciphertext },
      });
      migrated++;
      // eslint-disable-next-line no-console
      console.log(`encrypted CPF for ${row.email} (${row.id})`);
    }
    // eslint-disable-next-line no-console
    console.log(`\ndone: ${migrated} encrypted, ${skipped} already ciphertext.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
