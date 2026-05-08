import { BadRequestException } from '@nestjs/common';

/// Shared validation for the C3 discount campaign fields. Either all 3 must
/// be present (defining a window) or all 3 must be null/undefined (clearing
/// the campaign). Throws BadRequestException on partial sets.
///
/// Returns the normalized {percent, startsAt, endsAt} tuple ready to slot
/// into Prisma `data: {...}`. When the input clears the campaign, returns
/// nulls for use with PATCH (Prisma accepts `null` to wipe nullable cols).
export function validateDiscountWindow(input: {
  discountPercent?: number | null;
  discountStartsAt?: string | null;
  discountEndsAt?: string | null;
}): {
  discountPercent: number | null;
  discountStartsAt: Date | null;
  discountEndsAt: Date | null;
} | undefined {
  const touched =
    input.discountPercent !== undefined ||
    input.discountStartsAt !== undefined ||
    input.discountEndsAt !== undefined;
  if (!touched) return undefined;

  const allNull =
    (input.discountPercent === null || input.discountPercent === undefined) &&
    (input.discountStartsAt === null ||
      input.discountStartsAt === undefined) &&
    (input.discountEndsAt === null || input.discountEndsAt === undefined);
  if (allNull) {
    return {
      discountPercent: null,
      discountStartsAt: null,
      discountEndsAt: null,
    };
  }

  const percent =
    input.discountPercent === null || input.discountPercent === undefined
      ? null
      : input.discountPercent;
  const start =
    input.discountStartsAt === null || input.discountStartsAt === undefined
      ? null
      : new Date(input.discountStartsAt);
  const end =
    input.discountEndsAt === null || input.discountEndsAt === undefined
      ? null
      : new Date(input.discountEndsAt);

  if (percent === null || start === null || end === null) {
    throw new BadRequestException(
      'Desconto exige porcentagem + data de início + data de fim juntos',
    );
  }
  if (percent < 1 || percent > 100) {
    throw new BadRequestException(
      'Porcentagem de desconto precisa estar entre 1 e 100',
    );
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException('Datas de desconto inválidas');
  }
  if (start.getTime() >= end.getTime()) {
    throw new BadRequestException('Data de início precisa vir antes do fim');
  }

  return {
    discountPercent: percent,
    discountStartsAt: start,
    discountEndsAt: end,
  };
}

/// Resolve the active campaign discount for a row at `now`. Returns the
/// discount in cents (0 when no active campaign). Used by checkout to
/// stack the campaign discount with the PIX 5% off (item-14, 2026-05).
export function computeCampaignDiscountCents(
  row: {
    priceCents: number;
    discountPercent: number | null;
    discountStartsAt: Date | null;
    discountEndsAt: Date | null;
  },
  now: Date = new Date(),
): number {
  const { priceCents, discountPercent, discountStartsAt, discountEndsAt } =
    row;
  if (
    discountPercent == null ||
    discountStartsAt == null ||
    discountEndsAt == null
  ) {
    return 0;
  }
  if (now < discountStartsAt || now >= discountEndsAt) return 0;
  return Math.round((priceCents * discountPercent) / 100);
}
