import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isValidCpf } from '../cpf';

/// `@IsCpfValid()` — class-validator constraint that checks the Mod-11
/// digits. Compose with `@Matches(/^\d{11}$/)` (format) or `@IsString()` —
/// this decorator only handles the semantic check, not the surface shape.
///
/// Optional fields: undefined skips by `@IsOptional()` upstream. Empty
/// string is allowed (the service layer interprets `''` as "clear field"
/// for editable CPFs); reject empty separately if you need it required.
export function IsCpfValid(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCpfValid',
      target: object.constructor,
      propertyName,
      options: { message: 'CPF inválido', ...options },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === '') return true;
          if (typeof value !== 'string') return false;
          return isValidCpf(value);
        },
      },
    });
  };
}
