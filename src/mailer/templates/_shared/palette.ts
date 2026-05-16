/// Colors used across e-mail templates. Mirrors the bikebeach token palette
/// (see /design/prototypes/README.md) plus the dark counterparts we use in
/// the email gallery. Inline hex everywhere — e-mail clients don't grok CSS
/// variables.

export interface Palette {
  bg: string;
  bgSoft: string;
  border: string;
  borderSoft: string;
  text: string;
  textSoft: string;
  textMuted: string;
  clay: string;
  clayDark: string;
  sun: string;
  sea: string;
  seaDark: string;
  green: string;
  amber: string;
  amberBg: string;
  amberText: string;
}

export const LIGHT: Palette = {
  bg: '#F6EFE2', // cream
  bgSoft: '#ECE2CD', // cream-2
  border: '#DCC9A1', // sand
  borderSoft: '#CDB888',
  text: '#221C16', // ink
  textSoft: '#4A3F35', // ink-2
  textMuted: '#6E614F', // ink-3
  clay: '#D85D34',
  clayDark: '#B5431F',
  sun: '#F2A65A',
  sea: '#2D6A6A',
  seaDark: '#1F4D4D',
  green: '#3F7A4F',
  amber: '#C58B2F',
  amberBg: '#F4E8C9',
  amberText: '#735517',
};

export const DARK: Palette = {
  bg: '#1A1410',
  bgSoft: '#0F0B08',
  border: '#3a322a',
  borderSoft: '#3a322a',
  text: '#F6EFE2',
  textSoft: '#D6CCB8',
  textMuted: '#9C8E78',
  clay: '#D85D34',
  clayDark: '#F2A65A', // links in dark mode go to sun (warm yellow) instead of clay-dark
  sun: '#F2A65A',
  sea: '#7BCAC4',
  seaDark: '#7BCAC4',
  green: '#7DBC8A',
  amber: '#F2A65A',
  amberBg: '#0F0B08',
  amberText: '#9C8E78',
};
