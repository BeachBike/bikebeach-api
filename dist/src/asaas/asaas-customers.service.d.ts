import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasClientService } from './asaas-client.service';
export declare class AsaasCustomersService {
    private readonly prisma;
    private readonly asaas;
    constructor(prisma: PrismaService, asaas: AsaasClientService);
    ensureCustomer(user: User): Promise<string>;
}
