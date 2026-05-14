import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcrypt';

const BCRYPT_ROUNDS = 12;
const prisma = new PrismaClient();

const DEFAULT_UNIT_SLUG = 'bc-central';
/// Pre-A2 slug. Seed migrates `bc-bombinhas` rows to the new identity in place
/// so existing dev DBs don't lose admin / packs / reservations on re-seed.
const LEGACY_UNIT_SLUG = 'bc-bombinhas';
const DEFAULT_UNIT_NAME = 'BC Central';
const DEFAULT_UNIT_ADDRESS =
  'Praia Central — Balneário Camboriú, SC (entre os postos 4 e 5)';

const DEFAULT_PACK_OFFERS = [
  // (classes, priceCents, expirationDays, displayOrder)
  { classes: 1, priceCents: 4_999, expirationDays: 30, displayOrder: 1 },
  { classes: 10, priceCents: 34_999, expirationDays: 90, displayOrder: 2 },
  { classes: 20, priceCents: 59_999, expirationDays: 120, displayOrder: 3 },
] as const;

const DEFAULT_PLAN = {
  name: 'Mensal Ilimitado',
  monthlyCredits: 999,
  priceCents: 44_999, // R$ 449,99
} as const;

const DEFAULT_CLASS_KINDS = [
  // (slug, name, defaultDurationMinutes, intensity, tone, colorToken)
  // Order is preserved by `createdAt` (ClassKind.displayOrder removed in
  // 2026-05) — keep this array in the order the admin should see them.
  { slug: 'sunrise', name: 'Sunrise', defaultDurationMinutes: 45, intensity: 3, tone: 'Despertar enérgico', colorToken: 'SUN' as const },
  { slug: 'sunset', name: 'Sunset', defaultDurationMinutes: 50, intensity: 4, tone: 'Pôr do sol intenso', colorToken: 'CLAY' as const },
  { slug: 'power', name: 'Power', defaultDurationMinutes: 50, intensity: 5, tone: 'Força e resistência', colorToken: 'CLAY' as const },
  { slug: 'beat-drill', name: 'Beat Drill', defaultDurationMinutes: 45, intensity: 4, tone: 'Coreografia rítmica', colorToken: 'SEA' as const },
  { slug: 'almoco', name: 'Almoço', defaultDurationMinutes: 30, intensity: 2, tone: 'Pausa do meio-dia', colorToken: 'SAND' as const },
  { slug: 'noturno', name: 'Noturno', defaultDurationMinutes: 50, intensity: 4, tone: 'Energia da noite', colorToken: 'INK' as const },
] as const;

async function ensureInitialAdmin() {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const name = process.env.INITIAL_ADMIN_NAME?.trim() ?? 'Admin';

  if (!email || !password) {
    console.log(
      '[seed] Skipping admin: INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must both be set.',
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === Role.ADMIN && existing.isActive) {
      console.log(`[seed] Admin already exists: ${email}`);
      return;
    }
    await prisma.user.update({
      where: { email },
      data: { role: Role.ADMIN, isActive: true },
    });
    console.log(`[seed] Promoted existing user to ADMIN: ${email}`);
    return;
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role: Role.ADMIN,
      isActive: true,
    },
  });
  console.log(`[seed] Created ADMIN: ${email}`);
}

async function ensureDefaultUnit() {
  // Already on the new slug — refresh display fields in case the seed
  // copy changed.
  const onNewSlug = await prisma.unit.findUnique({
    where: { slug: DEFAULT_UNIT_SLUG },
  });
  if (onNewSlug) {
    return prisma.unit.update({
      where: { id: onNewSlug.id },
      data: {
        name: DEFAULT_UNIT_NAME,
        address: DEFAULT_UNIT_ADDRESS,
      },
    });
  }

  // Migrate the legacy slug in place — preserves admin, bikes, packs, etc.
  const onLegacy = await prisma.unit.findUnique({
    where: { slug: LEGACY_UNIT_SLUG },
  });
  if (onLegacy) {
    const migrated = await prisma.unit.update({
      where: { id: onLegacy.id },
      data: {
        slug: DEFAULT_UNIT_SLUG,
        name: DEFAULT_UNIT_NAME,
        address: DEFAULT_UNIT_ADDRESS,
      },
    });
    console.log(
      `[seed] Migrated default unit ${LEGACY_UNIT_SLUG} → ${DEFAULT_UNIT_SLUG}`,
    );
    return migrated;
  }

  // Fresh install.
  const unit = await prisma.unit.create({
    data: {
      slug: DEFAULT_UNIT_SLUG,
      name: DEFAULT_UNIT_NAME,
      address: DEFAULT_UNIT_ADDRESS,
    },
  });
  console.log(`[seed] Created default unit: ${unit.slug}`);
  return unit;
}

/// Pack offers are global (2026-05). The `unitId` arg is kept on the
/// signature so callers don't need to refactor; it's now ignored.
async function ensureDefaultPackOffers(_unitId: string) {
  for (const offer of DEFAULT_PACK_OFFERS) {
    const { unitId: _drop, ...rest } = offer as typeof offer & {
      unitId?: string;
    };
    void _drop;
    await prisma.packOffer.upsert({
      where: { classes: rest.classes },
      create: rest,
      // Refresh seed-controlled fields so a re-run picks up canonical price /
      // expiry tweaks. Admin-controlled toggles (`isActive`, `displayOrder`)
      // are intentionally left alone.
      update: {
        priceCents: rest.priceCents,
        expirationDays: rest.expirationDays,
      },
    });
  }
  console.log(
    `[seed] Ensured ${DEFAULT_PACK_OFFERS.length} default pack offers`,
  );
}

async function ensureDefaultPlan() {
  const existing = await prisma.plan.findFirst({
    where: { name: DEFAULT_PLAN.name },
  });
  if (existing) {
    await prisma.plan.update({
      where: { id: existing.id },
      data: {
        priceCents: DEFAULT_PLAN.priceCents,
        monthlyCredits: DEFAULT_PLAN.monthlyCredits,
      },
    });
    console.log(`[seed] Refreshed default plan: ${DEFAULT_PLAN.name}`);
    return;
  }
  await prisma.plan.create({ data: DEFAULT_PLAN });
  console.log(`[seed] Created default plan: ${DEFAULT_PLAN.name}`);
}

async function ensureDefaultClassKinds() {
  for (const kind of DEFAULT_CLASS_KINDS) {
    await prisma.classKind.upsert({
      where: { slug: kind.slug },
      create: kind,
      update: {}, // don't overwrite admin tweaks
    });
  }
  console.log(`[seed] Ensured ${DEFAULT_CLASS_KINDS.length} class kinds`);
}

async function main() {
  await ensureInitialAdmin();
  const unit = await ensureDefaultUnit();
  await ensureDefaultPackOffers(unit.id);
  await ensureDefaultPlan();
  await ensureDefaultClassKinds();
  await sweepLeakedE2EClassKinds();
  await backfillInstructorArenas();
}

/// 2026-05 — backfill the new `InstructorArena` M2M from the legacy
/// `User.unitId` field for INSTRUCTOR rows. Idempotent: every row has a
/// composite primary key `(userId, unitId)` so re-runs are no-ops. The
/// legacy column stays populated so admin scoping (and any old query
/// that still relies on it) keeps working until that path is rewritten.
async function backfillInstructorArenas() {
  const instructors = await prisma.user.findMany({
    where: { role: Role.INSTRUCTOR, unitId: { not: null } },
    select: { id: true, unitId: true },
  });
  let created = 0;
  for (const inst of instructors) {
    if (!inst.unitId) continue;
    const result = await prisma.instructorArena.upsert({
      where: {
        userId_unitId: { userId: inst.id, unitId: inst.unitId },
      },
      create: { userId: inst.id, unitId: inst.unitId },
      update: {},
    });
    // `upsert` doesn't tell us "newly created vs existing" — count fresh
    // rows by comparing timestamps inside the same call would be racy.
    // Just log the total so the operator sees progress.
    void result;
    created++;
  }
  if (created > 0) {
    console.log(
      `[seed] Ensured InstructorArena rows for ${created} legacy instructor(s)`,
    );
  }
}

/// Idempotent cleanup for ClassKind rows leaked by older e2e specs whose
/// cleanup() didn't include `prisma.classKind.deleteMany`. Slugs starting
/// with `e2e-` are reserved for tests; if any survived a run, drop them
/// here so the admin's tipo-de-aula list stays clean.
async function sweepLeakedE2EClassKinds() {
  // Null any FK references first so the delete doesn't break.
  await prisma.user.updateMany({
    where: { primaryClassKind: { slug: { startsWith: 'e2e-' } } },
    data: { primaryClassKindId: null },
  });
  await prisma.classSlot.updateMany({
    where: { classKind: { slug: { startsWith: 'e2e-' } } },
    data: { classKindId: null },
  });
  await prisma.instructorSpecialty.deleteMany({
    where: { classKind: { slug: { startsWith: 'e2e-' } } },
  });
  const dropped = await prisma.classKind.deleteMany({
    where: { slug: { startsWith: 'e2e-' } },
  });
  if (dropped.count > 0) {
    console.log(`[seed] Swept ${dropped.count} leaked e2e ClassKind row(s)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[seed] Failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
