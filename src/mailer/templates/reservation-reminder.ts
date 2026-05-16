import { renderButton } from './_shared/button';
import { fmtTime } from './_shared/format';
import { escapeHtml, renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { ReservationReminderPayload, TemplateModule } from './types';

function body(p: ReservationReminderPayload, palette: Palette): string {
  const isDark = palette === DARK;
  const tag = isDark ? DARK.sun : LIGHT.clay;
  const startsAt = new Date(p.startsAt);
  const boxBg = isDark ? DARK.bgSoft : LIGHT.bgSoft;
  const boxBorder = isDark ? `border:1px solid ${DARK.border};` : '';
  const dashedBorder = isDark ? DARK.border : LIGHT.border;
  const classKind = escapeHtml(p.classKind);
  const instructorName = escapeHtml(p.instructorName.toLowerCase());
  const bikeLabel = escapeHtml(p.bikeLabel);

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="font-size:11px;font-weight:700;color:${tag};text-transform:uppercase;letter-spacing:.1em">em 2h · ${fmtTime(startsAt)}</div>
      <h1 style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:42px;line-height:.95;margin:10px 0 0 0">
        sua aula é<br/>
        <span style="font-style:italic;font-weight:400;color:${isDark ? DARK.textMuted : LIGHT.text}">em 2 horas.</span>
      </h1>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">
        ${classKind} com ${instructorName}, bike <b class="mono" style="font-family:'JetBrains Mono',monospace">${bikeLabel}</b>. respira, hidrata, vai.
      </p>
    </td></tr>

    <tr><td style="padding:26px 40px 0 40px">
      <div style="background:${boxBg};${boxBorder}border-radius:14px;padding:20px 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-size:10px;font-weight:700;color:${palette.textMuted};text-transform:uppercase;letter-spacing:.08em">para levar</div>
              <div style="font-size:14px;font-weight:600;margin-top:4px;color:${palette.text}">squeeze · toalha · roupa leve · chapéu</div>
            </td>
          </tr>
          <tr><td style="padding-top:14px;border-top:1px dashed ${dashedBorder}"></td></tr>
          <tr>
            <td style="padding-top:14px">
              <div style="font-size:10px;font-weight:700;color:${palette.textMuted};text-transform:uppercase;letter-spacing:.08em">chegada</div>
              <div style="font-size:14px;font-weight:600;margin-top:4px;color:${palette.text}">10 min antes — deixe o calçado na entrada e siga até a sua bike</div>
            </td>
          </tr>
        </table>
      </div>
    </td></tr>

    <tr><td style="padding:26px 40px 0 40px">
      ${renderButton(palette, { href: p.reservationUrl, label: 'ver detalhes →', variant: 'primary' })}
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <p style="font-size:13px;color:${palette.textMuted};line-height:1.55">
        cancelar agora já não devolve crédito (estamos dentro de 8h). se não for, avise pra liberar a vaga pra lista de espera.
      </p>
    </td></tr>
  `;
}

export const reservationReminderTemplate: TemplateModule<ReservationReminderPayload> = {
  subject: (p) => `sua aula começa em 2h · ${p.classKind} ${fmtTime(new Date(p.startsAt))}`,
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: `${p.classKind} com ${p.instructorName} às ${fmtTime(new Date(p.startsAt))} — bike ${p.bikeLabel}.`,
      body: body(p, LIGHT),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: `${p.classKind} com ${p.instructorName} às ${fmtTime(new Date(p.startsAt))} — bike ${p.bikeLabel}.`,
      body: body(p, DARK),
    }),
  text: (p) =>
    `sua aula começa em 2h.

${p.classKind} com ${p.instructorName}, bike ${p.bikeLabel}, às ${fmtTime(new Date(p.startsAt))}.

leva: squeeze, toalha, roupa leve, chapéu.

ver reserva: ${p.reservationUrl}

— bikebeach`,
};
