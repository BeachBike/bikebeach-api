import { renderButton } from './_shared/button';
import { fmtDayMonth, fmtTime } from './_shared/format';
import { escapeHtml, renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { ReservationConfirmedPayload, TemplateModule } from './types';

function body(p: ReservationConfirmedPayload, palette: Palette): string {
  const isDark = palette === DARK;
  const startsAt = new Date(p.startsAt);
  const ok = isDark ? DARK.green : LIGHT.green;
  const ticketBg = isDark ? DARK.bgSoft : LIGHT.text;
  const ticketText = isDark ? DARK.text : LIGHT.bg;
  const ticketBorder = isDark ? `border:1px solid ${DARK.border};` : '';
  const ticketAccent = DARK.sun;
  const cancelBoxBg = isDark ? DARK.bgSoft : LIGHT.bgSoft;
  const cancelBoxBorder = isDark ? `border:1px solid ${DARK.border};` : '';
  const cancelBoxText = palette.textSoft;
  const intensity = p.intensity ? ` · ${escapeHtml(p.intensity)}` : '';
  const firstName = escapeHtml(p.name.split(' ')[0].toLowerCase());
  const classKind = escapeHtml(p.classKind);
  const instructorName = escapeHtml(p.instructorName.toLowerCase());
  const bikeLabel = escapeHtml(p.bikeLabel);
  const unitName = escapeHtml(p.unitName.toLowerCase());
  const cancelHours = p.cancelDeadlineHours;
  const cancelCopy =
    cancelHours === 2
      ? `<b style="color:${palette.text}">cancelar?</b> você foi promovida da lista de espera — cancela sem custo até 2h antes.`
      : `<b style="color:${palette.text}">cancelar?</b> sem custo até 8h antes. depois disso o crédito segue consumido.`;

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="font-size:11px;font-weight:700;color:${ok};text-transform:uppercase;letter-spacing:.1em">✓ reservado</div>
      <h1 style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:38px;line-height:.95;margin:8px 0 0 0">
        ${firstName}, sua bike<br/>
        <span style="font-style:italic;font-weight:400;color:${isDark ? DARK.textMuted : LIGHT.textSoft}">está guardada.</span>
      </h1>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">a ${classKind} de ${instructorName} te espera. chegue 10 min antes, deixe o calçado na entrada e siga até a sua fileira.</p>
    </td></tr>

    <tr><td style="padding:28px 40px 0 40px">
      <div style="background:${ticketBg};color:${ticketText};${ticketBorder}border-radius:16px;padding:26px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">aula</div>
              <div class="display-tight" style="font-family:'Bricolage Grotesque',sans-serif;font-size:30px;line-height:1;margin-top:6px">${classKind}</div>
              <div style="font-size:12px;opacity:.8;margin-top:6px">com ${instructorName} · ${p.durationMinutes} min${intensity}</div>
            </td>
            <td align="right">
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">bike</div>
              <div class="display-tight mono" style="font-family:'JetBrains Mono',monospace;font-size:36px;line-height:1;margin-top:6px;color:${ticketAccent}">${bikeLabel}</div>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="position:relative;margin-top:22px;padding-top:18px;border-top:1px dashed rgba(246,239,226,.25)">
          <tr>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">data</div>
              <div style="font-size:16px;font-weight:600;margin-top:6px">${fmtDayMonth(startsAt)}</div>
            </td>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">hora</div>
              <div class="mono" style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;margin-top:6px">${fmtTime(startsAt)}</div>
            </td>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">arena</div>
              <div style="font-size:14px;font-weight:600;margin-top:6px">${unitName}</div>
            </td>
          </tr>
        </table>
      </div>
    </td></tr>

    <tr><td style="padding:26px 40px 0 40px">
      ${renderButton(palette, { href: p.reservationUrl, label: 'ver minha reserva →', variant: 'primary' })}
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <div style="background:${cancelBoxBg};${cancelBoxBorder}border-radius:12px;padding:14px 16px;font-size:13px;color:${cancelBoxText};line-height:1.5">
        ${cancelCopy}
      </div>
    </td></tr>
  `;
}

export const reservationConfirmedTemplate: TemplateModule<ReservationConfirmedPayload> = {
  subject: (p) => `reserva confirmada · ${p.classKind} ${fmtDayMonth(new Date(p.startsAt))}`,
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: `bike ${p.bikeLabel} guardada pra você na aula ${p.classKind} com ${p.instructorName}.`,
      body: body(p, LIGHT),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: `bike ${p.bikeLabel} guardada pra você na aula ${p.classKind} com ${p.instructorName}.`,
      body: body(p, DARK),
    }),
  text: (p) => {
    const startsAt = new Date(p.startsAt);
    const cancelLine =
      p.cancelDeadlineHours === 2
        ? 'promovida da lista de espera — cancele sem custo até 2h antes.'
        : 'cancele sem custo até 8h antes. depois disso o crédito segue consumido.';
    return `${p.name}, sua bike está guardada.

aula: ${p.classKind} com ${p.instructorName}
data: ${fmtDayMonth(startsAt)} · ${fmtTime(startsAt)}
bike: ${p.bikeLabel}
arena: ${p.unitName}

ver reserva: ${p.reservationUrl}

${cancelLine}

— bikebeach`;
  },
};
