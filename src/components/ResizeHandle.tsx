// ที่จับขอบซ้ายของตะกร้า — กดเมาส์ค้างแล้วลากไปทางซ้ายเพื่อขยายตะกร้า / ลากขวาเพื่อหด
// ดับเบิลคลิก = กลับเป็นความกว้างเริ่มต้น · ใช้ได้เฉพาะบนเว็บ/แอปเดสก์ท็อป (เมาส์หรือปากกา)
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors } from '../theme';

interface Props {
  width: number;
  onResize: (w: number) => void;
  onReset: () => void;
}

export function ResizeHandle({ width, onResize, onReset }: Props) {
  const ref = useRef<View>(null);
  const [hot, setHot] = useState(false);
  const [dragging, setDragging] = useState(false);
  const live = useRef({ width, onResize, onReset });
  live.current = { width, onResize, onReset };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;

    let startX = 0;
    let startW = 0;
    let pid = -1;
    let frame = 0;
    let next = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX = e.clientX;
      startW = live.current.width;
      pid = e.pointerId;
      el.setPointerCapture?.(pid);
      setDragging(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      // ตะกร้าอยู่ขวา: ลากซ้าย (clientX ลดลง) = กว้างขึ้น
      next = startW + (startX - e.clientX);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          live.current.onResize(next);
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = -1;
      el.releasePointerCapture?.(e.pointerId);
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const onDbl = () => live.current.onReset();
    const onEnter = () => setHot(true);
    const onLeave = () => setHot(false);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  if (Platform.OS !== 'web') return null;
  const on = hot || dragging;
  return (
    <View
      ref={ref}
      style={hit}
      accessibilityLabel="ลากเพื่อปรับความกว้างตะกร้า (ดับเบิลคลิกเพื่อคืนค่าเริ่มต้น)"
    >
      <View style={[s.line, on && s.lineOn]} />
      <View style={[s.grip, on && s.gripOn]} />
    </View>
  );
}

// อยู่ในช่องว่างระหว่างกริดสินค้ากับตะกร้า (gap 14px) · cursor/touchAction เป็นสไตล์เฉพาะเว็บ
const hit = {
  position: 'absolute', left: -14, top: 0, bottom: 0, width: 14, zIndex: 5,
  alignItems: 'center', justifyContent: 'center', cursor: 'col-resize', touchAction: 'none',
} as unknown as ViewStyle;

const s = StyleSheet.create({
  line: { position: 'absolute', top: 8, bottom: 8, width: 2, borderRadius: 1, backgroundColor: 'transparent' },
  lineOn: { backgroundColor: colors.primary, opacity: 0.55 },
  grip: { width: 4, height: 36, borderRadius: 2, backgroundColor: colors.line },
  gripOn: { backgroundColor: colors.primary },
});
