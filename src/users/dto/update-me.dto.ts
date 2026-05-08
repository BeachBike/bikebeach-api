import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/// Self-service update for the authenticated user. Name and password are
/// intentionally NOT here — name change is a recepção-side operation
/// (matches the "fale com a recepção" flow on /perfil), password lives on
/// /auth/change-password. All fields optional so the frontend can PATCH
/// one row at a time.
export class UpdateMeDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  /// Accepts free-form numeric phone with separators, just like signup.
  /// Empty string clears the field; `undefined` leaves it unchanged.
  @IsOptional()
  @IsString()
  @Matches(/^(\+?[0-9\s\-()]{8,20})?$/, { message: 'Telefone inválido' })
  phone?: string;

  /// CPF — 11 raw digits or empty (clears). Mod-11 isn't enforced here;
  /// Asaas will reject at first purchase if it's wrong.
  @IsOptional()
  @IsString()
  @Matches(/^(\d{11})?$/, {
    message: 'CPF deve ter 11 dígitos numéricos (sem pontos/hífens)',
  })
  cpf?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;
}
