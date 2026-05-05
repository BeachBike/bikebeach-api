import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcrypt';

const BCRYPT_ROUNDS = 12;
const prisma = new PrismaClient();

const DEFAULT_UNIT_SLUG = 'bc-bombinhas';

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
  // (slug, name, defaultDurationMinutes, intensity, tone, displayOrder)
  { slug: 'sunrise', name: 'Sunrise', defaultDurationMinutes: 45, intensity: 3, tone: 'Despertar enérgico', displayOrder: 1 },
  { slug: 'sunset', name: 'Sunset', defaultDurationMinutes: 50, intensity: 4, tone: 'Pôr do sol intenso', displayOrder: 2 },
  { slug: 'power', name: 'Power', defaultDurationMinutes: 50, intensity: 5, tone: 'Força e resistência', displayOrder: 3 },
  { slug: 'beat-drill', name: 'Beat Drill', defaultDurationMinutes: 45, intensity: 4, tone: 'Coreografia rítmica', displayOrder: 4 },
  { slug: 'almoco', name: 'Almoço', defaultDurationMinutes: 30, intensity: 2, tone: 'Pausa do meio-dia', displayOrder: 5 },
  { slug: 'noturno', name: 'Noturno', defaultDurationMinutes: 50, intensity: 4, tone: 'Energia da noite', displayOrder: 6 },
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
  const existing = await prisma.unit.findUnique({
    where: { slug: DEFAULT_UNIT_SLUG },
  });
  if (existing) {
    console.log(`[seed] Default unit already exists: ${DEFAULT_UNIT_SLUG}`);
    return existing;
  }
  const unit = await prisma.unit.create({
    data: {
      slug: DEFAULT_UNIT_SLUG,
      name: 'BC Bombinhas',
      address: 'Faixa de areia — Balneário Camboriú / Bombinhas, SC',
    },
  });
  console.log(`[seed] Created default unit: ${unit.slug}`);
  return unit;
}

async function ensureDefaultPackOffers(unitId: string) {
  for (const offer of DEFAULT_PACK_OFFERS) {
    await prisma.packOffer.upsert({
      where: { unitId_classes: { unitId, classes: offer.classes } },
      create: { ...offer, unitId },
      // Refresh seed-controlled fields so a re-run picks up canonical price /
      // expiry tweaks. Admin-controlled toggles (`isActive`, `displayOrder`)
      // are intentionally left alone.
      update: {
        priceCents: offer.priceCents,
        expirationDays: offer.expirationDays,
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
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[seed] Failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
