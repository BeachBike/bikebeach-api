import { renderButton } from './_shared/button';
import { fmtDayMonth, fmtTime } from './_shared/format';
import { escapeHtml, renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { ClassCancelledPayload, TemplateModule } from './types';

function body(p: ClassCancelledPayload, palette: Palette): string {
  const isDark = palette === DARK;
  const accent = isDark ? DARK.sea : LIGHT.sea;
  const startsAt = new Date(p.startsAt);
  const cardBg = isDark ? DARK.bgSoft : LIGHT.bgSoft;
  const cardBorder = isDark ? `border:1px solid ${DARK.border};` : '';
  const sideAccent = isDark ? DARK.sea : LIGHT.sea;
  const classKind = escapeHtml(p.classKind);
  const instructorName = escapeHtml(p.instructorName.toLowerCase());
  const bikeLabel = escapeHtml(p.bikeLabel);
  const reasonLabel = escapeHtml(p.reasonLabel);
  const description = p.description ? escapeHtml(p.description) : null;

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.1em">aula cancelada</div>
      <h1 style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:42px;line-height:.95;margin:10px 0 0 0;color:${palette.text}">
        o céu fechou,<br/>
        <span style="font-style:italic;font-weight:400;color:${accent}">a gente parou.</span>
      </h1>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">
        ${reasonLabel} — não dá pra pedalar com segurança. cancelamos a aula de agora há pouco.${description ? ` <span style="color:${palette.text}">${description}</span>.` : ''}
      </p>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">
        seu crédito já voltou pra carteira: <b style="color:${palette.text}">+${p.refundedCredits} ${p.refundedCredits === 1 ? 'aula' : 'aulas'}</b>. usa quando quiser, dentro da validade do seu pacote.
      </p>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <div style="background:${cardBg};${cardBorder}border-radius:14px;padding:18px 20px;border-left:3px solid ${sideAccent}">
        <div style="font-size:10px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.08em">aula cancelada</div>
        <div style="font-size:14px;font-weight:600;margin-top:6px;color:${palette.text}">${classKind} · ${instructorName} · ${fmtDayMonth(startsAt)} ${fmtTime(startsAt)}</div>
        <div style="font-size:12px;color:${palette.textMuted};margin-top:4px">bike ${bikeLabel} · liberada</div>
      </div>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      ${renderButton(palette, { href: p.rebookUrl, label: 'reagendar aula →', variant: 'primary' })}
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <p style="font-size:13px;color:${palette.textMuted};line-height:1.55">
        cancelamentos por clima ou problema operacional são automáticos. seu crédito nunca queima nesses casos.
      </p>
    </td></tr>
  `;
}

export const classCancelledTemplate: TemplateModule<ClassCancelledPayload> = {
  subject: (p) => `aula cancelada · ${p.classKind} ${fmtDayMonth(new Date(p.startsAt))}`,
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: `${p.reasonLabel}. seu crédito voltou pra carteira: +${p.refundedCredits}.`,
      body: body(p, LIGHT),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: `${p.reasonLabel}. seu crédito voltou pra carteira: +${p.refundedCredits}.`,
      body: body(p, DARK),
    }),
  text: (p) => {
    const startsAt = new Date(p.startsAt);
    return `aula cancelada · ${p.classKind}

${p.reasonLabel}. ${p.description ?? ''}

aula: ${p.classKind} com ${p.instructorName} · ${fmtDayMonth(startsAt)} ${fmtTime(startsAt)}
bike: ${p.bikeLabel} · liberada

crédito devolvido: +${p.refundedCredits}.

reagendar: ${p.rebookUrl}

— bikebeach`;
  },
};
