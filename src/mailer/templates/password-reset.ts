import { renderButton } from './_shared/button';
import { fmtRemaining } from './_shared/format';
import { escapeHtml, renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { PasswordResetPayload, TemplateModule } from './types';

function body(p: PasswordResetPayload, palette: Palette): string {
  const isDark = palette === DARK;
  const boxBg = isDark ? DARK.bgSoft : LIGHT.bgSoft;
  const boxBorder = isDark ? `border:1px solid ${DARK.border};` : '';
  const expires = fmtRemaining(p.expiresInMinutes * 60_000);

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="font-size:11px;font-weight:700;color:${palette.textMuted};text-transform:uppercase;letter-spacing:.1em">solicitação de senha</div>
      <h1 style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:38px;line-height:.95;margin:10px 0 0 0;color:${palette.text}">
        você pediu pra<br/>
        <span style="font-style:italic;font-weight:400;color:${isDark ? DARK.textMuted : LIGHT.textSoft}">trocar a senha.</span>
      </h1>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">
        clique no botão abaixo e crie uma nova. o link vale por <b style="color:${palette.text}">${expires}</b> e funciona uma vez só.
      </p>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      ${renderButton(palette, { href: p.resetUrl, label: 'criar nova senha →', variant: 'primary' })}
    </td></tr>

    <tr><td style="padding:30px 40px 0 40px">
      <div style="background:${boxBg};${boxBorder}border-radius:12px;padding:18px 20px">
        <div style="font-size:11px;font-weight:700;color:${palette.textMuted};text-transform:uppercase;letter-spacing:.08em">se o botão não funcionar</div>
        <div class="mono" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${palette.text};margin-top:8px;word-break:break-all;line-height:1.5">
          ${escapeHtml(p.resetUrl)}
        </div>
      </div>
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <p style="font-size:13px;color:${palette.textMuted};line-height:1.55">
        <b style="color:${palette.text}">não foi você?</b> ignore esse e-mail. sua senha continua a mesma e a gente bloqueou o pedido. se vier outro, <a href="#" style="color:${palette.clayDark};font-weight:600;text-decoration:none">fala com a gente</a>.
      </p>
    </td></tr>
  `;
}

export const passwordResetTemplate: TemplateModule<PasswordResetPayload> = {
  subject: () => 'recuperação de senha · bikebeach',
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: `link pra trocar sua senha — vale por ${fmtRemaining(p.expiresInMinutes * 60_000)}.`,
      body: body(p, LIGHT),
      footerExtra: footerOrigin(p),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: `link pra trocar sua senha — vale por ${fmtRemaining(p.expiresInMinutes * 60_000)}.`,
      body: body(p, DARK),
      footerExtra: footerOrigin(p),
    }),
  text: (p) =>
    `você pediu pra trocar a senha.

abra: ${p.resetUrl}

o link vale por ${fmtRemaining(p.expiresInMinutes * 60_000)} e funciona uma vez.

se não foi você, ignore esse e-mail — sua senha continua a mesma.

— bikebeach`,
};

function footerOrigin(p: PasswordResetPayload): string | undefined {
  const parts: string[] = [];
  if (p.requestedFromIp) parts.push(`<b class="mono" style="font-family:'JetBrains Mono',monospace">${escapeHtml(p.requestedFromIp)}</b>`);
  if (p.userAgent) parts.push(escapeHtml(p.userAgent));
  if (!parts.length) return undefined;
  return `pedido feito de ${parts.join(' · ')} · agora há pouco`;
}
