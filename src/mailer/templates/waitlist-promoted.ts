import { renderButton } from './_shared/button';
import { fmtDayMonth, fmtTime } from './_shared/format';
import { escapeHtml, renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { TemplateModule, WaitlistPromotedPayload } from './types';

/// Adapted from the design prototype: in our system the waitlist *auto-
/// promotes* — there is no "confirm in 1h or we move on" window. The user
/// is already reserved when this e-mail goes out. The CTA is informational
/// ("ver minha bike") and the secondary message is the protected 2h cancel
/// window that promoted reservations get.
function body(p: WaitlistPromotedPayload, palette: Palette): string {
  const isDark = palette === DARK;
  const tag = isDark ? DARK.sun : LIGHT.clay;
  const heroAccent = isDark ? DARK.sun : LIGHT.clay;
  const startsAt = new Date(p.startsAt);
  const cancelDeadline = new Date(p.cancelDeadlineAt);
  const cardBg = isDark ? LIGHT.clay : LIGHT.clay; // sempre clay no card promocional
  const cardText = LIGHT.bg;
  const classKind = escapeHtml(p.classKind);
  const instructorName = escapeHtml(p.instructorName.toLowerCase());
  const bikeLabel = escapeHtml(p.bikeLabel);

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="font-size:11px;font-weight:700;color:${tag};text-transform:uppercase;letter-spacing:.1em">● vaga aberta</div>
      <h1 style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:42px;line-height:.95;margin:10px 0 0 0;color:${heroAccent}">
        você está<br/>
        <span style="color:${palette.text}">dentro.</span>
      </h1>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">
        abriu uma vaga em <b style="color:${palette.text}">${classKind} com ${instructorName}</b> e a gente já te colocou na cadeira — sua bike é a <b class="mono" style="font-family:'JetBrains Mono',monospace">${bikeLabel}</b>. nada pra confirmar, é só aparecer.
      </p>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <div style="background:${cardBg};color:${cardText};border-radius:14px;padding:22px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.08em">aula</div>
              <div class="display-tight" style="font-family:'Bricolage Grotesque',sans-serif;font-size:28px;line-height:1;margin-top:6px">${classKind}</div>
              <div style="font-size:13px;opacity:.9;margin-top:4px">${fmtDayMonth(startsAt)} · ${fmtTime(startsAt)} · com ${instructorName}</div>
            </td>
            <td align="right">
              <div style="font-size:11px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.08em">bike</div>
              <div class="display-tight mono" style="font-family:'JetBrains Mono',monospace;font-size:34px;line-height:1;margin-top:6px">${bikeLabel}</div>
            </td>
          </tr>
        </table>
      </div>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      ${renderButton(palette, { href: p.reservationUrl, label: 'ver minha reserva →', variant: isDark ? 'ghost' : 'dark' })}
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <p style="font-size:13px;color:${palette.textMuted};line-height:1.55">
        promovida da lista de espera você ganha cancelamento sem custo até <b style="color:${palette.text}">${fmtTime(cancelDeadline)} de ${fmtDayMonth(cancelDeadline)}</b> — 2h antes da aula. se não der, é só cancelar antes desse horário que o crédito volta pra carteira.
      </p>
    </td></tr>
  `;
}

export const waitlistPromotedTemplate: TemplateModule<WaitlistPromotedPayload> = {
  subject: (p) => `vaga aberta · você está dentro da ${p.classKind}`,
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: `bike ${p.bikeLabel} reservada automaticamente na ${p.classKind} com ${p.instructorName}.`,
      body: body(p, LIGHT),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: `bike ${p.bikeLabel} reservada automaticamente na ${p.classKind} com ${p.instructorName}.`,
      body: body(p, DARK),
    }),
  text: (p) => {
    const startsAt = new Date(p.startsAt);
    const cancelDeadline = new Date(p.cancelDeadlineAt);
    return `${p.name}, você está dentro.

abriu uma vaga em ${p.classKind} com ${p.instructorName} e a gente já te colocou na cadeira automaticamente — bike ${p.bikeLabel}, ${fmtDayMonth(startsAt)} ${fmtTime(startsAt)}.

ver reserva: ${p.reservationUrl}

cancelamento sem custo até ${fmtTime(cancelDeadline)} de ${fmtDayMonth(cancelDeadline)} (2h antes da aula).

— bikebeach`;
  },
};
