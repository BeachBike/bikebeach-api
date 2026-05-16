/// Date / currency / duration formatters used inside templates. Single
/// source of truth so we never accidentally render "16/05/2026" in one
/// template and "16 mai" in another.
///
/// **Timezone**: every date-to-text helper anchors to **America/Sao_Paulo**
/// explicitly via `Intl.DateTimeFormat`, NOT the host's local TZ. The mailer
/// runs server-side; on Railway the Node process is UTC, so a naive
/// `date.getHours()` here would print times 3h ahead of Brazil. Anchoring
/// to São Paulo keeps the e-mail "06:00 quinta · 16 mai" no matter where
/// the API container runs.

const TZ = 'America/Sao_Paulo';

const WEEKDAYS = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const;
const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

interface SpParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=sunday … 6=saturday
}

/// Extract the São Paulo wall-clock for an absolute instant via Intl.
/// `formatToParts` is the only stable way to get individual fields under a
/// non-host timezone. Weekday is derived from the calendar date so it
/// doesn't depend on how `Intl` names the day in any locale.
function spParts(date: Date): SpParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  const year = Number(out.year);
  const month = Number(out.month);
  const day = Number(out.day);
  // `hour: '2-digit'` with `hour12: false` returns "24" at midnight in some
  // ICU builds — normalize to 0.
  const hourRaw = Number(out.hour);
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = Number(out.minute);
  // Weekday of a calendar date doesn't depend on TZ — build a UTC anchor.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday };
}

/// "quinta · 16 mai" in São Paulo time.
export function fmtDayMonth(date: Date): string {
  const p = spParts(date);
  return `${WEEKDAYS[p.weekday]} · ${p.day} ${MONTHS[p.month - 1]}`;
}

/// "17:30" in São Paulo time.
export function fmtTime(date: Date): string {
  const p = spParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/// "16 mai" — short date used inside small chips.
export function fmtShortDate(date: Date): string {
  const p = spParts(date);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/// "16 mai 2026" — with year.
export function fmtFullDate(date: Date): string {
  const p = spParts(date);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/// "R$ 540,00" — Brazilian Real from integer cents.
export function fmtBRL(cents: number): string {
  const reais = (cents / 100).toFixed(2).replace('.', ',');
  return `R$ ${reais}`;
}

/// "5 dias", "1 hora", "30 minutos" — humanized leftover. Always positive.
export function fmtRemaining(ms: number): string {
  const abs = Math.max(0, ms);
  const days = Math.floor(abs / 86_400_000);
  if (days >= 2) return `${days} dias`;
  const hours = Math.floor(abs / 3_600_000);
  if (hours >= 2) return `${hours} horas`;
  if (hours === 1) return '1 hora';
  const mins = Math.max(1, Math.floor(abs / 60_000));
  return `${mins} minutos`;
}
