import { renderButton } from './_shared/button';
import { escapeHtml, renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { TemplateModule, WelcomePayload } from './types';

function body(p: WelcomePayload, palette: Palette): string {
  const isDark = palette === DARK;
  const titleAccent = isDark ? DARK.textMuted : LIGHT.textSoft;
  const stepNumber = isDark ? DARK.sun : LIGHT.clay;
  const stepLabel = isDark ? DARK.text : LIGHT.text;
  const stepMuted = palette.textMuted;
  const borderTop = palette.border;
  const heroSub = isDark ? '#F6EFE2' : '#F6EFE2';

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="background:${LIGHT.clay};color:${heroSub};border-radius:16px;padding:36px 30px">
        <div>
          <div style="font-size:11px;font-weight:700;opacity:.85;text-transform:uppercase;letter-spacing:.1em">capítulo 01</div>
          <h1 class="display-tight" style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:42px;line-height:.95;margin:14px 0 0 0">
            bem-vinda,<br/>
            <span style="font-style:italic;font-weight:400">${escapeHtml(p.name.toLowerCase())}.</span>
          </h1>
        </div>
      </div>
    </td></tr>

    <tr><td style="padding:30px 40px 0 40px">
      <p style="font-size:16px;line-height:1.55;color:${palette.textSoft};margin:0">
        sua conta foi criada. agora <b style="color:${palette.text}">${escapeHtml(p.email)}</b> abre o painel, reserva bike e acompanha seu pacote.
      </p>
      <p style="font-size:16px;line-height:1.55;color:${palette.textSoft};margin:16px 0 0 0">
        antes da primeira pedalada, peço só duas coisinhas: aceitar o termo de responsabilidade (3 segundos) e responder o par-q de saúde (30 segundos). a gente bloqueia a reserva sem isso — é o jeito de fazer aula com segurança.
      </p>

      <div style="margin-top:26px">
        ${renderButton(palette, { href: `${p.appUrl}/dashboard`, label: 'abrir meu painel →', variant: isDark ? 'ghost' : 'dark' })}
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px;border-top:1px solid ${borderTop}">
        <tr>
          <td style="padding:20px 0 0 0;font-size:11px;font-weight:700;color:${stepMuted};text-transform:uppercase;letter-spacing:.08em">o próximo trecho</td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">
        <tr>
          <td width="33%" style="padding:14px 14px 14px 0;vertical-align:top">
            <div class="display-tight mono" style="font-family:'JetBrains Mono',monospace;font-size:24px;color:${stepNumber};line-height:1">01</div>
            <div style="font-size:14px;font-weight:600;margin-top:8px;color:${stepLabel}">aceitar o termo</div>
            <div style="font-size:12px;color:${stepMuted};margin-top:2px">leva 3 segundos</div>
          </td>
          <td width="34%" style="padding:14px;vertical-align:top">
            <div class="display-tight mono" style="font-family:'JetBrains Mono',monospace;font-size:24px;color:${stepNumber};line-height:1">02</div>
            <div style="font-size:14px;font-weight:600;margin-top:8px;color:${stepLabel}">responder par-q</div>
            <div style="font-size:12px;color:${stepMuted};margin-top:2px">7 perguntas, 30 seg</div>
          </td>
          <td width="33%" style="padding:14px 0 14px 14px;vertical-align:top">
            <div class="display-tight mono" style="font-family:'JetBrains Mono',monospace;font-size:24px;color:${stepNumber};line-height:1">03</div>
            <div style="font-size:14px;font-weight:600;margin-top:8px;color:${stepLabel}">reservar bike</div>
            <div style="font-size:12px;color:${stepMuted};margin-top:2px">sua primeira aula</div>
          </td>
        </tr>
      </table>
    </td></tr>
  `;
}

export const welcomeTemplate: TemplateModule<WelcomePayload> = {
  subject: (p) => `bem-vinda à bikebeach, ${p.name.split(' ')[0].toLowerCase()}`,
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: 'sua conta foi criada — aceite o termo e responda o par-q pra reservar a primeira aula.',
      body: body(p, LIGHT),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: 'sua conta foi criada — aceite o termo e responda o par-q pra reservar a primeira aula.',
      body: body(p, DARK),
    }),
  text: (p) =>
    `oi ${p.name}, bem-vinda à bikebeach!

sua conta foi criada com o e-mail ${p.email}. antes da primeira aula, complete o termo de responsabilidade e o par-q de saúde.

abrir meu painel: ${p.appUrl}/dashboard

— bikebeach · balneário camboriú`,
};
