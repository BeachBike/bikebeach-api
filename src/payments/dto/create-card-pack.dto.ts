import { Type } from 'class-transformer';
import {
  IsCreditCard,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export type CardBillingType = 'CREDIT_CARD' | 'DEBIT_CARD';

/// Raw card data. Exists only in transit — the controller hands it straight
/// to Asaas and it is never persisted nor logged (the Asaas client redacts
/// it). Validation here is the first gate: a malformed number never leaves
/// our process.
export class CreditCardDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  holderName!: string;

  /// Luhn-checked card number, digits only (the FE strips spaces).
  @IsCreditCard()
  number!: string;

  /// `MM` — 01..12.
  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'expiryMonth must be MM (01-12)' })
  expiryMonth!: string;

  /// `YYYY` — 4-digit year.
  @Matches(/^\d{4}$/, { message: 'expiryYear must be YYYY' })
  expiryYear!: string;

  /// 3 or 4 digit CVV. Never stored, never logged, never returned.
  @Matches(/^\d{3,4}$/, { message: 'ccv must be 3 or 4 digits' })
  ccv!: string;
}

/// Cardholder identification — required by Asaas anti-fraud on every
/// transparent card charge.
export class CreditCardHolderInfoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  /// CPF — 11 digits, no punctuation (FE strips it).
  @Matches(/^\d{11}$/, { message: 'cpfCnpj must be 11 digits (CPF)' })
  cpfCnpj!: string;

  /// CEP — 8 digits, no punctuation.
  @Matches(/^\d{8}$/, { message: 'postalCode must be 8 digits (CEP)' })
  postalCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  addressNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressComplement?: string;

  /// Phone — 10 or 11 digits (DDD + number), no punctuation.
  @Matches(/^\d{10,11}$/, { message: 'phone must be 10 or 11 digits' })
  phone!: string;
}

export class CreateCardPackDto {
  /// References a PackOffer row — supplies pack size, base price (cash
  /// price; the service computes the financed total locally when
  /// parcelado), expiration days.
  @IsString()
  packOfferId!: string;

  /// Defaults to CREDIT_CARD when omitted (back-compat with the original
  /// release). DEBIT_CARD forces 1x à vista — debit doesn't support
  /// parcelas regardless of what the client sends.
  @IsOptional()
  @IsIn(['CREDIT_CARD', 'DEBIT_CARD'])
  billingType?: CardBillingType;

  /// Parcelas — 1 (à vista) to 6. Enforced server-side, not just in the UI.
  /// Sem juros até `CARD_INSTALLMENT_FREE_LIMIT` (3); acima disso o cliente
  /// paga `CARD_MONTHLY_INTEREST` (2,99% a.m. composto) sobre o preço
  /// à vista. Ignorado quando `billingType = DEBIT_CARD` (sempre 1x).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  installmentCount?: number;

  @ValidateNested()
  @Type(() => CreditCardDto)
  creditCard!: CreditCardDto;

  @ValidateNested()
  @Type(() => CreditCardHolderInfoDto)
  creditCardHolderInfo!: CreditCardHolderInfoDto;
}
