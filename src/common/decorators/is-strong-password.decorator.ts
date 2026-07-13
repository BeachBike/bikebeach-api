import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { passwordPolicyIssues } from '../password-policy';

/// `@IsStrongPassword()` — enforces the shared password policy (see
/// `common/password-policy.ts`): length, character-class variety, no common
/// passwords, and not the user's own e-mail/name.
///
/// The identity check reads `email` / `name` off the SAME DTO when present
/// (via `args.object`), so it works on signup + staff creation and simply
/// no-ops on reset/change where those fields don't exist. The failure
/// message lists every reason so the client can show exactly what to fix.
export function IsStrongPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const obj = args.object as { email?: string; name?: string };
          return (
            passwordPolicyIssues(value, {
              email: obj.email,
              name: obj.name,
            }).length === 0
          );
        },
        defaultMessage(args: ValidationArguments) {
          const value = args.value;
          if (typeof value !== 'string') return 'Senha inválida';
          const obj = args.object as { email?: string; name?: string };
          const issues = passwordPolicyIssues(value, {
            email: obj.email,
            name: obj.name,
          });
          return `Senha fraca: ${issues.join('; ')}`;
        },
      },
    });
  };
}
