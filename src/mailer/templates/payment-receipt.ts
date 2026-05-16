import { renderButton } from './_shared/button';
import { fmtBRL, fmtFullDate } from './_shared/format';
import { escapeHtml, renderFrame } from './_shared/frame';
import { DARK, LIGHT, type Palette } from './_shared/palette';
import type { PaymentReceiptPayload, TemplateModule } from './types';

const METHOD_LABEL: Record<string, string> = {
  PIX: 'pix',
  CREDIT_CARD: 'cartão de crédito',
  DEBIT_CARD: 'cartão de débito',
};

function body(p: PaymentReceiptPayload, palette: Palette): string {
  const isDark = palette === DARK;
  const ok = isDark ? DARK.green : LIGHT.green;
  const ticketBg = isDark ? DARK.bgSoft : LIGHT.text;
  const ticketText = isDark ? DARK.text : LIGHT.bg;
  const ticketBorder = isDark ? `border:1px solid ${DARK.border};` : '';
  const accent = DARK.sun;
  const method = escapeHtml(METHOD_LABEL[p.method] ?? p.method.toLowerCase());
  const packLabel = escapeHtml(p.packLabel.toLowerCase());
  const paidAt = new Date(p.paidAt);
  const expiresAt = new Date(p.expiresAt);
  const installments = p.installments && p.installments > 1 ? ` · ${p.installments}x` : '';
  const dashedBorder = 'rgba(246,239,226,.25)';

  return `
    <tr><td style="padding:28px 40px 0 40px">
      <div style="font-size:11px;font-weight:700;color:${ok};text-transform:uppercase;letter-spacing:.1em">✓ pagamento confirmado</div>
      <h1 style="font-family:'Bricolage Grotesque',sans-serif;font-weight:600;letter-spacing:-.04em;font-size:38px;line-height:.95;margin:8px 0 0 0;color:${palette.text}">
        crédito na sua<br/>
        <span style="font-style:italic;font-weight:400;color:${isDark ? DARK.textMuted : LIGHT.textSoft}">carteira.</span>
      </h1>
      <p style="font-size:15px;color:${palette.textSoft};margin:14px 0 0 0;line-height:1.55">
        ${p.credits === 1 ? '1 crédito' : `${p.credits} créditos`} adicionados ao seu pacote, válidos até <b style="color:${palette.text}">${fmtFullDate(expiresAt)}</b>. já pode reservar.
      </p>
    </td></tr>

    <tr><td style="padding:28px 40px 0 40px">
      <div style="background:${ticketBg};color:${ticketText};${ticketBorder}border-radius:16px;padding:26px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">pacote</div>
              <div class="display-tight" style="font-family:'Bricolage Grotesque',sans-serif;font-size:26px;line-height:1.1;margin-top:6px">${packLabel}</div>
              <div style="font-size:12px;opacity:.8;margin-top:6px">${method}${installments}</div>
            </td>
            <td align="right">
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">total</div>
              <div class="display-tight mono" style="font-family:'JetBrains Mono',monospace;font-size:32px;line-height:1;margin-top:6px;color:${accent}">${fmtBRL(p.amountCents)}</div>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="position:relative;margin-top:22px;padding-top:18px;border-top:1px dashed ${dashedBorder}">
          <tr>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">pago em</div>
              <div style="font-size:14px;font-weight:600;margin-top:6px">${fmtFullDate(paidAt)}</div>
            </td>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">créditos</div>
              <div class="mono" style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;margin-top:6px">${p.credits}</div>
            </td>
            <td>
              <div style="font-size:11px;font-weight:700;opacity:.7;text-transform:uppercase;letter-spacing:.08em">expira</div>
              <div style="font-size:14px;font-weight:600;margin-top:6px">${fmtFullDate(expiresAt)}</div>
            </td>
          </tr>
        </table>
      </div>
    </td></tr>

    <tr><td style="padding:26px 40px 0 40px">
      ${renderButton(palette, { href: p.dashboardUrl, label: 'reservar minha aula →', variant: 'primary' })}
    </td></tr>

    <tr><td style="padding:24px 40px 0 40px">
      <p style="font-size:13px;color:${palette.textMuted};line-height:1.55">
        este é seu recibo. dúvida sobre cobrança? <a href="#" style="color:${palette.clayDark};font-weight:600;text-decoration:none">fala com a gente</a>.
      </p>
    </td></tr>
  `;
}

export const paymentReceiptTemplate: TemplateModule<PaymentReceiptPayload> = {
  subject: (p) => `recibo · ${p.packLabel} · ${fmtBRL(p.amountCents)}`,
  light: (p) =>
    renderFrame(LIGHT, {
      preheader: `${p.credits} créditos adicionados ao seu pacote. válidos até ${fmtFullDate(new Date(p.expiresAt))}.`,
      body: body(p, LIGHT),
    }),
  dark: (p) =>
    renderFrame(DARK, {
      preheader: `${p.credits} créditos adicionados ao seu pacote. válidos até ${fmtFullDate(new Date(p.expiresAt))}.`,
      body: body(p, DARK),
    }),
  text: (p) =>
    `pagamento confirmado · ${p.packLabel}

valor: ${fmtBRL(p.amountCents)} (${METHOD_LABEL[p.method] ?? p.method}${p.installments && p.installments > 1 ? ` em ${p.installments}x` : ''})
pago em: ${fmtFullDate(new Date(p.paidAt))}
créditos: ${p.credits} (válidos até ${fmtFullDate(new Date(p.expiresAt))})

reservar: ${p.dashboardUrl}

— bikebeach`,
};
