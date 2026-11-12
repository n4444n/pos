// ข้อความลอย (tooltip) ตอนชี้เมาส์ — ใช้ title ของ DOM บนเว็บ (React Native ไม่มี prop นี้)
export function webTitle(el: unknown, title: string) {
  const node = el as { setAttribute?: (k: string, v: string) => void } | null;
  node?.setAttribute?.('title', title);
}
