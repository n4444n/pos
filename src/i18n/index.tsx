// ระบบสองภาษา ไทย / English
//
// วิธีใช้ในหน้าจอ:
//     const { t } = useT();
//     <Text>{t('common.save')}</Text>
//     <Text>{t('ship.sent', { n: 5 })}</Text>     // แทรกตัวเลข/ข้อความ
//
// กติกา
// - คำแปลอยู่ใน src/i18n/th.ts และ en.ts · โครงสร้างเดียวกัน คีย์เดียวกัน
// - คีย์ไหนยังไม่มีคำแปลอังกฤษ จะถอยไปใช้ภาษาไทยให้เอง (ไม่ขึ้นค่าว่างหรือรหัสดิบ)
//   → เพิ่มข้อความใหม่แล้วลืมแปลอังกฤษ โปรแกรมไม่พัง แค่ตรงนั้นเป็นไทยชั่วคราว
// - ตรวจคีย์ที่ยังไม่ได้แปลด้วย  node scripts/i18n-check.mjs
// - ข้อความไทยที่ยังเขียนตรง ๆ ในหน้าจอ (ไม่ผ่าน t()) แปลอัตโนมัติบนหน้าจอโดย ./dom.ts + พจนานุกรม ./phrases.ts
//   หาข้อความไทยใหม่ที่ยังไม่มีคำแปล:  node scripts/i18n-extract.cjs
//
// ภาษาที่ใช้ = ที่เครื่องนี้เลือกไว้ (จำใน localStorage) · ไม่ได้เลือก = ตามค่าเริ่มต้นของร้าน/สาขา
// พนักงานต่างชาติกดสลับเองได้ตลอด โดยไม่กระทบเครื่องอื่นหรือสาขาอื่น
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUiLang } from './current';
import { setDomLanguage } from './dom';
import { en } from './en';
import { th } from './th';

export type Lang = 'th' | 'en';
export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'th', label: 'ไทย', short: 'TH' },
  { id: 'en', label: 'English', short: 'EN' },
];

const KEY = 'pos.lang';
const RES: Record<Lang, unknown> = { th, en };

const isLang = (v: unknown): v is Lang => v === 'th' || v === 'en';


/** ภาษาที่เครื่องนี้เลือกไว้เอง (null = ยังไม่เลือก → ใช้ค่าเริ่มต้นของร้าน) */
export function deviceLang(): Lang | null {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}
function saveDeviceLang(v: Lang | null) {
  try {
    if (v) globalThis.localStorage?.setItem(KEY, v);
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* โหมดส่วนตัว — ไม่จำก็ยังใช้งานได้ */
  }
}

/** หาข้อความจากคีย์แบบจุด เช่น 'sales.checkout' */
function lookup(res: unknown, key: string): string | undefined {
  let cur: unknown = res;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** แทนค่าตัวแปรในข้อความ: 'ส่งแล้ว {{n}} ชิ้น' + { n: 5 } */
function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** แปลข้อความโดยไม่ต้องอยู่ใน component (เช่นในไฟล์พิมพ์ใบเสร็จ) */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>) {
  const hit = lookup(RES[lang], key) ?? (lang === 'th' ? undefined : lookup(RES.th, key));
  return fill(hit ?? key, vars);
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

interface Ctx {
  lang: Lang;
  /** ภาษาที่เครื่องนี้เลือกเอง (null = ตามค่าเริ่มต้นของร้าน) */
  picked: Lang | null;
  setLang: (v: Lang | null) => void;
  t: TFunc;
}
const LangCtx = createContext<Ctx | null>(null);

/** ครอบทั้งแอป — defaultLang = ค่าเริ่มต้นของร้าน/สาขา (มาจากตั้งค่า) */
export function I18nProvider({ children, defaultLang = 'th' }: { children: ReactNode; defaultLang?: Lang }) {
  const [picked, setPicked] = useState<Lang | null>(() => deviceLang());
  const lang: Lang = picked ?? defaultLang;
  setUiLang(lang);

  useEffect(() => {
    // ให้ตัวอ่านหน้าจอและเบราว์เซอร์รู้ภาษาปัจจุบัน (ช่วยเรื่องการตัดคำ/เข้าถึง)
    try {
      if (typeof document !== 'undefined') document.documentElement.lang = lang;
    } catch {
      /* ไม่ใช่เว็บ */
    }
    // ข้อความไทยที่เขียนตรง ๆ ในหน้าจอ (ยังไม่ได้ใช้ t()) → แปลบนหน้าจอด้วยพจนานุกรม phrases.ts
    setDomLanguage(lang);
  }, [lang]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      picked,
      setLang: (v) => {
        saveDeviceLang(v);
        setPicked(v);
      },
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, picked],
  );
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

/** ใช้ในหน้าจอ: const { t, lang, setLang } = useT(); */
export function useT(): Ctx {
  const c = useContext(LangCtx);
  // ยังไม่ได้ครอบ Provider (เช่นหน้าทดสอบ) → ใช้ไทยไปก่อน ไม่ให้แอปล้ม
  return (
    c ?? {
      lang: 'th',
      picked: null,
      setLang: () => {},
      t: (key, vars) => translate('th', key, vars),
    }
  );
}
