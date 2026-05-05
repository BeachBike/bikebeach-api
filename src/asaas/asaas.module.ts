import { Module } from '@nestjs/common';
import { AsaasClientService } from './asaas-client.service';
import { AsaasCustomersService } from './asaas-customers.service';

@Module({
  providers: [AsaasClientService, AsaasCustomersService],
  exports: [AsaasClientService, AsaasCustomersService],
})
export class AsaasModule {}
