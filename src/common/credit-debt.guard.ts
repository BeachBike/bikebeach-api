import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/// Throws a structured 403 if the user has an open `CreditDebt`. Called by
/// flows that consume credits (reserve, join waitlist) — the user has to
/// settle the debt (by buying another pack) before they can use credits
/// again. Mirrors the `HEALTH_GATE_BLOCK` shape so the FE can render a
/// dedicated modal/toast for it.
export async function assertNoOpenCreditDebt(
  prisma: PrismaService,
  userId: string,
): Promise<void> {
  const debt = await prisma.creditDebt.findFirst({
    where: { userId, remainingCredits: { gt: 0 } },
    select: { id: true, amountCredits: true, remainingCredits: true },
  });
  if (debt) {
    throw new ForbiddenException({
      message:
        'Você tem um crédito a regularizar antes de fazer nova reserva. Compre um pacote pra acertar e voltar a treinar.',
      code: 'CREDIT_DEBT_BLOCK',
      details: {
        amountCredits: debt.amountCredits,
        remainingCredits: debt.remainingCredits,
      },
    });
  }
}
