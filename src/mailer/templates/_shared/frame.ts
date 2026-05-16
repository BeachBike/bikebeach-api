import { DARK, LIGHT, type Palette } from './palette';

export interface FrameOptions {
  /// Inner HTML — table rows under the logo and above the footer.
  body: string;
  /// Pre-header line — first ~90 chars shown in Gmail/Outlook list preview.
  preheader: string;
  /// Optional override of the standard footer text. Use for legal-ish
  /// footnotes like the password-reset IP line.
  footerExtra?: string;
}

const FONTS_LINK =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap';

/// The page background the "paper" card floats on — matches the prototype's
/// `--page:#E8DDC4` (a sand tone darker than the cream card). Fixed for BOTH
/// light and dark variants: in the design gallery the dark card also sits on
/// this same sand page, which is what gives every e-mail the framed look.
const PAGE_BG = '#E8DDC4';

/// Box-shadow that lifts the card off the sand page. Email clients that
/// don't support box-shadow just ignore it (graceful) — the contrasting
/// page background alone already reads as a card.
const PAPER_SHADOW_LIGHT =
  '0 30px 60px -28px rgba(34,28,22,.35), 0 4px 12px -8px rgba(34,28,22,.18)';
const PAPER_SHADOW_DARK =
  '0 30px 60px -28px rgba(0,0,0,.7), 0 4px 12px -8px rgba(0,0,0,.45)';

/// Wraps a body of `<tr>` rows into a complete e-mail document. Mirrors the
/// "paper on sand" frame from the design prototype: a 600px rounded card
/// (cream in light, near-black in dark) centered on the fixed sand page.
/// `palette` decides the card interior; the page stays sand either way.
export function renderFrame(palette: Palette, options: FrameOptions): string {
  const isDark = palette === DARK;
  const shadow = isDark ? PAPER_SHADOW_DARK : PAPER_SHADOW_LIGHT;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="${isDark ? 'dark' : 'light'}" />
<meta name="supported-color-schemes" content="light dark" />
<title>bikebeach</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${FONTS_LINK}" rel="stylesheet" />
<style>
  body{margin:0;padding:0;background:${PAGE_BG};-webkit-font-smoothing:antialiased}
  table{border-collapse:collapse}
  a{color:inherit}
  .display-tight{font-family:'Bricolage Grotesque','Manrope',Helvetica,Arial,sans-serif;font-weight:600;letter-spacing:-.04em}
  .mono{font-family:'JetBrains Mono','Courier New',monospace;font-variant-numeric:tabular-nums}
  .preheader{display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all}
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:'Manrope',Helvetica,Arial,sans-serif">
  <div class="preheader">${escapeHtml(options.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};margin:0;padding:0">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${palette.bg};color:${palette.text};border-radius:14px;overflow:hidden;box-shadow:${shadow};font-family:'Manrope',Helvetica,Arial,sans-serif">
        ${logoRow(palette)}
        ${options.body}
        ${footerRow(palette, options.footerExtra)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function logoRow(palette: Palette): string {
  const muted = palette === DARK ? DARK.textMuted : LIGHT.textMuted;
  return `<tr><td style="padding:32px 40px 0 40px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="vertical-align:middle">
          <span style="display:inline-flex;align-items:center;gap:9px">
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="15" fill="${LIGHT.clay}"/>
              <path d="M5 22 Q11 17 16 22 T27 22" stroke="${LIGHT.bg}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
              <circle cx="16" cy="13" r="2.4" fill="${LIGHT.bg}"/>
            </svg>
            <span class="display-tight" style="font-size:19px;line-height:1;color:${palette.text}">bikebeach</span>
          </span>
        </td>
        <td align="right" style="font-size:11px;color:${muted};font-weight:600;text-transform:uppercase;letter-spacing:.08em">balneário camboriú · sc</td>
      </tr>
    </table>
  </td></tr>`;
}

function footerRow(palette: Palette, extra?: string): string {
  return `<tr><td style="padding:30px 40px 32px 40px">
    <div style="border-top:1px solid ${palette.border};padding-top:18px;font-size:11px;color:${palette.textMuted};line-height:1.6">
      ${extra ? `${extra}<br/>` : ''}
      bikebeach · av. atlântica, 4280 · balneário camboriú · sc<br/>
      <a href="#" style="color:${palette.clayDark};font-weight:600;text-decoration:none">preferências</a>
    </div>
  </td></tr>`;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
