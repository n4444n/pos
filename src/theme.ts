import { Platform } from 'react-native';

export const colors = {
  bg: '#EEF1F6',
  panel: '#FFFFFF',
  surface: '#F6F7F9',
  line: '#E8EBF0',
  text: '#1B1F27',
  sub: '#6B7280',
  faint: '#A0A6B1',
  primary: '#2F6BFF',
  primarySoft: '#EAF0FF',
  danger: '#E5484D',
  dangerSoft: '#FDECEC',
  success: '#1F9D63',
  successSoft: '#E6F6EE',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

export const font = Platform.select({
  web: "'IBM Plex Sans Thai', 'Noto Sans Thai', system-ui, sans-serif",
  default: undefined,
});

/** โทนสีของป้ายหมวดหมู่ (เหมือน chip สีอ่อนในแบบ) */
export const categoryChip: Record<string, { bg: string; fg: string }> = {
  tshirt: { bg: '#EAF0FF', fg: '#2F6BFF' },
  shirt: { bg: '#E7F7F1', fg: '#16946A' },
  pants: { bg: '#FFF2E3', fg: '#D9780F' },
  dress: { bg: '#FDEBF3', fg: '#D23B7E' },
  outer: { bg: '#F1ECFE', fg: '#7A4FE0' },
  acc: { bg: '#EFF3F6', fg: '#4B6273' },
};

export const shadow = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' } as object,
  default: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
});
