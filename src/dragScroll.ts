// ลากเลื่อนแนวนอนด้วยเมาส์ (กดซ้ายค้างแล้วลากซ้าย-ขวา) สำหรับ ScrollView horizontal บนเว็บ
// - ลากเกิน 5px ถือเป็นการเลื่อน → ไม่นับเป็นการคลิกปุ่มที่อยู่ใต้เมาส์ (ดู wasDragged)
// - ล้อเมาส์ขึ้น/ลงเลื่อนซ้าย/ขวาได้ด้วย เมื่อแถบยาวเกินจอ
// - จอสัมผัส/ทัชแพดใช้การเลื่อนปกติของเบราว์เซอร์อยู่แล้ว
import { useEffect, useRef } from 'react';
import { Platform, type ScrollView } from 'react-native';

const THRESHOLD = 5;

export function useDragScroll() {
  const ref = useRef<ScrollView>(null);
  const dragged = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sv = ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null;
    const el = sv?.getScrollableNode?.() ?? (sv as unknown as HTMLElement | null);
    if (!el || typeof el.addEventListener !== 'function') return;

    let down = false;
    let moving = false;
    let startX = 0;
    let startLeft = 0;
    let pid = -1;
    const prevCursor = el.style.cursor;
    el.style.cursor = 'grab';

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      down = true;
      moving = false;
      dragged.current = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      pid = e.pointerId;
    };
    const onMove = (e: PointerEvent) => {
      if (!down || e.pointerId !== pid) return;
      const dx = e.clientX - startX;
      if (!moving) {
        if (Math.abs(dx) < THRESHOLD) return;
        moving = true;
        dragged.current = true;
        el.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }
      el.scrollLeft = startLeft - dx;
      e.preventDefault();
    };
    const end = () => {
      if (!down) return;
      down = false;
      if (moving) {
        el.style.cursor = 'grab';
        document.body.style.userSelect = '';
        // ล้างสถานะหลังเหตุการณ์ click ของการปล่อยเมาส์ครั้งนี้ผ่านไปแล้ว
        setTimeout(() => (dragged.current = false), 0);
      }
      moving = false;
    };
    // กันคลิกที่เกิดตอนปล่อยเมาส์หลังลาก ไม่ให้ไปเลือกหมวดหมู่
    const onClick = (e: MouseEvent) => {
      if (dragged.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.shiftKey) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    const onDragStart = (e: DragEvent) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    el.addEventListener('click', onClick, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dragstart', onDragStart);
    return () => {
      el.style.cursor = prevCursor;
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dragstart', onDragStart);
    };
  }, []);

  /** true ระหว่าง/ทันทีหลังการลาก — ใช้กันไม่ให้นับเป็นการกดปุ่ม */
  const wasDragged = () => dragged.current;
  return { ref, wasDragged };
}
