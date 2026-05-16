import type { Palette } from './palette';

export interface ButtonOptions {
  href: string;
  label: string;
  /// `primary` = filled clay. `dark` = filled ink/cream. `ghost` = bordered.
  variant?: 'primary' | 'dark' | 'ghost';
}

export function renderButton(palette: Palette, opts: ButtonOptions): string {
  const v = opts.variant ?? 'primary';
  let bg = '#D85D34'; // clay
  let color = '#F6EFE2';
  let border = '0';
  if (v === 'dark') {
    bg = palette.text;
    color = palette.bg;
  } else if (v === 'ghost') {
    bg = 'transparent';
    color = palette.text;
    border = `1.5px solid ${palette.border}`;
  }
  return `<a href="${opts.href}" style="display:inline-block;padding:14px 22px;border-radius:999px;font-weight:600;font-size:14px;text-align:center;background:${bg};color:${color};border:${border};text-decoration:none;font-family:'Manrope',system-ui,sans-serif">${opts.label}</a>`;
}
