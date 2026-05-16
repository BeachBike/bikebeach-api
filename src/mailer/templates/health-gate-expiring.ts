import { renderButton } from './_shared/button';
import { fmtFullDate, fmtRemaining, fmtShortDate } from './_shared/format';
import { renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { HealthGateExpiringPayload, TemplateModule } from './types';

const KIND_COPY = {
  LIABILITY: {
    tag: 'termo · expirando',
    title: 'pro seu termo<br/>vencer.',
    blurb:
      'todo mês a gente pede pra reaceitar o termo de responsabilidade — é o nosso de-acordo de continuar pedalando na areia. leva 3 segundos.',
    cadence: 'o termo renova a cada mês. avisamos com antecedência.',
    title2: 'termo atual',
  },
  PARQ: {
    tag: 'par-q · expirando',
    title: 'pro seu par-q<br/>vencer.',
    blurb:
      'a cada 3 meses a gente revisa o par-q de saúde — suas respostas anteriores vêm pré-preenchidas, você só edita o que mudou. leva 30 segundos.',
    cadence: 'o par-q renova a cada 3 meses. avisamos com antecedência.',
    title2: 'par-q atual',
  },
} as const;

function body(p: HealthGateExpiringPayload, palette: Palette): string {
  const isDark = palette === DARK;
  const accent = isDark ? DARK.amber : LIGHT.amber;
  const accentBg = isDark ? DARK.bgSoft : LIGHT.amberBg;
  const accentText = isDark ? DARK.textMuted : LIGHT.amberText;
  const boxBorder = isDark ? `border:1px solid ${DARK.border};` : '';
  const copy = KIND_COPY[p.kind];
  const expiresAt = new Date(p.expiresAt);
  const lastAccepted = p.lastAcceptedAt ? new Date(p.lastAcceptedAt) : null;
  const remaining = fmtRemaining(expiresAt.getTime() - Date.now());

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:.1em">+ ${copy.tag}</div>
      <h1 style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:38px;line-height:.95;margin:10px 0 0 0;color:${palette.text}">
        faltam <span class="mono" style="font-family:'JetBrains Mono',monospace">${remaining}</span><br/>
        <span style="font-style:italic;font-weight:400;color:${isDark ? DARK.textMuted : LIGHT.textSoft}">${copy.title}</span>
      </h1>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">${copy.blurb}</p>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <div style="background:${accentBg};${boxBorder}border-radius:14px;padding:18px 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-size:10px;font-weight:700;color:${accentText};text-transform:uppercase;letter-spacing:.08em">${copy.title2}</div>
              <div style="font-size:14px;font-weight:600;margin-top:6px;color:${palette.text}">${lastAccepted ? `aceito em ${fmtFullDate(lastAccepted)}` : 'sem registro anterior'}</div>
            </td>
            <td align="right">
              <div style="font-size:10px;font-weight:700;color:${accentText};text-transform:uppercase;letter-spacing:.08em">expira</div>
              <div class="display-tight mono" style="font-family:'JetBrains Mono',monospace;font-size:22px;line-height:1;margin-top:6px;color:${accent}">${fmtShortDate(expiresAt)}</div>
            </td>
          </tr>
        </table>
      </div>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      ${renderButton(palette, { href: p.renewUrl, label: 'renovar agora →', variant: 'primary' })}
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <p style="font-size:13px;color:${palette.textMuted};line-height:1.55">
        se você não renovar até <b style="color:${palette.text}">${fmtShortDate(expiresAt)}</b>, sua próxima reserva fica bloqueada até o aceite. sem drama — você renova em segundos no painel.
      </p>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <p style="font-size:12px;color:${palette.textMuted};line-height:1.6">
        ${copy.cadence}
      </p>
    </td></tr>
  `;
}

export const healthGateExpiringTemplate: TemplateModule<HealthGateExpiringPayload> = {
  subject: (p) =>
    p.kind === 'LIABILITY'
      ? 'seu termo de responsabilidade está expirando'
      : 'seu par-q de saúde está expirando',
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: `renove em segundos no painel para não bloquear a próxima reserva.`,
      body: body(p, LIGHT),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: `renove em segundos no painel para não bloquear a próxima reserva.`,
      body: body(p, DARK),
    }),
  text: (p) =>
    `${p.kind === 'LIABILITY' ? 'termo de responsabilidade' : 'par-q de saúde'} expirando em ${fmtShortDate(new Date(p.expiresAt))}.

renovar: ${p.renewUrl}

sem renovar, sua próxima reserva fica bloqueada.

— bikebeach`,
};
