// รูปย่อสำหรับหน้าขาย: ย่อในเบราว์เซอร์ (ไม่ต้องติดตั้งโปรแกรมย่อรูปที่เซิร์ฟเวอร์)
// high = รูปหลัก (ด้านยาว 900px) · medium = 480px · low = 240px

export const VARIANT_SIZES = { m: { max: 480, quality: 0.8 }, s: { max: 240, quality: 0.72 } } as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('เปิดรูปไม่ได้'));
    img.src = src;
  });
}

function draw(img: HTMLImageElement, max: number, quality: number) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/** รูปหลัก (สำหรับอัปโหลด) จาก dataURL/URL */
/** รูปย่อขนาดกลาง + เล็ก จาก dataURL/URL */
export async function makeVariants(src: string): Promise<{ m: string; s: string }> {
  const img = await loadImage(src);
  return {
    m: draw(img, VARIANT_SIZES.m.max, VARIANT_SIZES.m.quality),
    s: draw(img, VARIANT_SIZES.s.max, VARIANT_SIZES.s.quality),
  };
}
