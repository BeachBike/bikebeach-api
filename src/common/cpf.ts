/// CPF helpers — normalization + Mod-11 check.
///
/// The Brazilian CPF is 11 digits: 9 base digits + 2 check digits computed
/// via Mod-11. A CPF with all-same digits ("11111111111" etc.) passes the
/// Mod-11 math by coincidence — those are rejected explicitly so they
/// don't sneak past the validator.

export function normalizeCpf(input: string): string {
  return input.replace(/\D/g, '');
}

export function isValidCpf(input: string | null | undefined): boolean {
  if (!input) return false;
  const cpf = normalizeCpf(input);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  // First check digit.
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]!, 10) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  if (rem !== parseInt(cpf[9]!, 10)) return false;

  // Second check digit — uses all 10 prior digits.
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]!, 10) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10) rem = 0;
  return rem === parseInt(cpf[10]!, 10);
}
