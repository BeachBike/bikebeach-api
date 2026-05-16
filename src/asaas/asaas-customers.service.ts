import { BadRequestException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { tryDecryptCpf } from '../common/cpf-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClientService } from './asaas-client.service';

/// Sync layer between local `User` and Asaas Customer. Both Payments and
/// Subscriptions need to know "what's this user's Asaas customer id" before
/// they can create anything in Asaas — keep that logic here so it's not
/// duplicated.
@Injectable()
export class AsaasCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasClientService,
  ) {}

  /// Returns the user's `asaasCustomerId`. If absent, creates the customer in
  /// Asaas + persists the id back on the User row.
  /// Throws 400 `CPF_REQUIRED` if the user hasn't provided their CPF yet.
  async ensureCustomer(user: User): Promise<string> {
    if (user.asaasCustomerId) return user.asaasCustomerId;

    // CPF is encrypted at rest (AES-GCM, deterministic). Decrypt before
    // calling Asaas — they need the raw 11-digit value. `tryDecryptCpf`
    // also passes pre-migration plaintext rows through unchanged so the
    // app keeps working across the transition.
    const plaintextCpf = tryDecryptCpf(user.cpf);
    if (!plaintextCpf) {
      throw new BadRequestException({
        code: 'CPF_REQUIRED',
        message: 'Informe seu CPF antes de comprar',
      });
    }

    const customer = await this.asaas.createCustomer({
      name: user.name,
      email: user.email,
      cpfCnpj: plaintextCpf,
      mobilePhone: user.phone ?? undefined,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { asaasCustomerId: customer.id },
    });

    return customer.id;
  }
}
