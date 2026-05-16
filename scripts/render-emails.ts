/// Dev-only: render every template (light + dark) to design/email-render/
/// so we can eyeball fidelity against the prototype without sending mail.
/// Run: npx ts-node scripts/render-emails.ts
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TEMPLATES } from '../src/mailer/templates';
import { DARK, LIGHT } from '../src/mailer/templates/_shared/palette';
import type { TemplatePayloadMap } from '../src/mailer/templates/types';

const samples: TemplatePayloadMap = {
  WELCOME: { name: 'Helena Brandão', email: 'helena.brandao@email.com', appUrl: 'http://localhost:5173' },
  RESERVATION_CONFIRMED: {
    name: 'Helena Brandão', classKind: 'sunset', instructorName: 'Marina',
    durationMinutes: 45, intensity: 'forte',
    startsAt: '2026-05-16T17:30:00-03:00', bikeLabel: 'B-04', unitName: 'Praia Central',
    reservationUrl: 'http://localhost:5173/dashboard',
    cancelDeadlineAt: '2026-05-16T09:30:00-03:00', cancelDeadlineHours: 8,
  },
  RESERVATION_REMINDER: {
    name: 'Helena', classKind: 'sunset', instructorName: 'Marina',
    startsAt: '2026-05-16T17:30:00-03:00', bikeLabel: 'B-04',
    reservationUrl: 'http://localhost:5173/dashboard', reservationId: 'r1',
  },
  WAITLIST_PROMOTED: {
    name: 'Helena', classKind: 'sunrise', instructorName: 'Marina',
    startsAt: '2026-05-16T06:00:00-03:00', bikeLabel: 'B-04',
    reservationUrl: 'http://localhost:5173/dashboard',
    cancelDeadlineAt: '2026-05-16T04:00:00-03:00',
  },
  CLASS_CANCELLED: {
    name: 'Helena', classKind: 'sunset', instructorName: 'Marina',
    startsAt: '2026-05-16T17:30:00-03:00', bikeLabel: 'B-04',
    reason: 'CHUVA', reasonLabel: 'chuva forte na beira-mar de balneário, raios na linha',
    description: null, refundedCredits: 1, rebookUrl: 'http://localhost:5173/reservar',
  },
  PASSWORD_RESET: {
    name: 'Helena', resetUrl: 'https://bikebeach.com.br/conta?reset=8f3e91a7c2d4b6e8f0a1c2d4e6f8a9b0',
    expiresInMinutes: 60, requestedFromIp: '187.34.211.04', userAgent: 'safari · macos',
  },
  HEALTH_GATE_EXPIRING: {
    name: 'Helena', kind: 'LIABILITY', expiresAt: '2026-05-22T00:00:00-03:00',
    renewUrl: 'http://localhost:5173/saude', lastAcceptedAt: '2026-04-12T00:00:00-03:00',
    dedupKey: 'LIABILITY:x',
  },
  PAYMENT_RECEIPT: {
    name: 'Helena', packLabel: 'Pacote 10 aulas', amountCents: 54000, method: 'PIX',
    installments: null, paidAt: '2026-05-15T12:00:00-03:00', credits: 10,
    expiresAt: '2026-08-13T12:00:00-03:00', dashboardUrl: 'http://localhost:5173/dashboard',
  },
};

const outDir = join(__dirname, '..', '..', 'design', 'email-render');
mkdirSync(outDir, { recursive: true });

for (const key of Object.keys(samples) as (keyof TemplatePayloadMap)[]) {
  const tpl = TEMPLATES[key];
  const payload = samples[key] as never;
  writeFileSync(join(outDir, `${key}.light.html`), tpl.light(payload, LIGHT));
  writeFileSync(join(outDir, `${key}.dark.html`), tpl.dark(payload, DARK));
}
// eslint-disable-next-line no-console
console.log(`rendered ${Object.keys(samples).length * 2} files to ${outDir}`);
