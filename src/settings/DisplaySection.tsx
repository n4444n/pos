// ตั้งค่า → การแสดงผลหน้าขาย (มุมมองสินค้า · รูปทรง/คุณภาพรูป · ตัวอักษร · สต็อก) + ตัวอย่างการ์ดสินค้า
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, imageSrc, type AdminSettings } from '../api';
import { SHAPE_RATIO, type ImageShape } from '../appSettings';
import { ProductCard } from '../components/ProductCard';
import { makeVariants } from '../imageVariants';
import type { Product, Variant } from '../types';
import { colors } from '../theme';
import { Card, Field, Grid, Seg, SmallBtn, Toggle, type Upd, s } from './ui';

/** สินค้าตัวอย่างสำหรับพรีวิวการ์ด (ไม่ได้มาจากฐานข้อมูล) */
const PREVIEW_PRODUCT: Product = { id: -1, sku: 'TS-001', name: 'เสื้อยืดคอกลม Cotton 100%', categoryId: 'tops', price: 290, art: 'tshirt', tint: '#9CC3E6', imageUrl: null };

const PREVIEW_VARIANTS: Variant[] = ['S', 'M', 'L'].flatMap((size, i) => [
  { id: -10 - i, productId: -1, sku: `TS-001-${size}-W`, size, color: 'ขาว', colorHex: '#F4F4F2', extra: '', stock: 8 - i, price: 290 },
  { id: -20 - i, productId: -1, sku: `TS-001-${size}-N`, size, color: 'กรม', colorHex: '#24345C', extra: '', stock: 5 + i, price: 290 },
]);

function ShapeIcon({ shape, on }: { shape: ImageShape; on: boolean }) {
  const r = SHAPE_RATIO[shape];
  const h = 22;
  return <View style={{ width: Math.round(h * r), height: h, borderRadius: 3, borderWidth: 2, borderColor: on ? '#fff' : colors.sub }} />;
}

export function DisplaySection({ v, set }: { v: AdminSettings['display']; set: Upd<AdminSettings['display']> }) {
  const [thumbs, setThumbs] = useState<{ busy: boolean; done: number; total: number; msg: string }>({ busy: false, done: 0, total: 0, msg: '' });

  // รูปเดิมที่อัปโหลดก่อนมีระบบรูปย่อ → ย่อในเบราว์เซอร์นี้แล้วส่งกลับไปเก็บ
  const makeThumbs = async () => {
    setThumbs({ busy: true, done: 0, total: 0, msg: 'กำลังตรวจรูปสินค้า…' });
    try {
      const { urls } = await api.uploadsMissingVariants();
      if (!urls.length) return setThumbs({ busy: false, done: 0, total: 0, msg: 'รูปสินค้าทุกรูปมีรูปย่อครบแล้ว' });
      let ok = 0;
      for (const [i, url] of urls.entries()) {
        setThumbs({ busy: true, done: i, total: urls.length, msg: '' });
        try {
          await api.saveUploadVariants(url, await makeVariants(imageSrc(url)));
          ok++;
        } catch {
          /* ข้ามรูปที่เสีย */
        }
      }
      setThumbs({ busy: false, done: ok, total: urls.length, msg: `สร้างรูปย่อแล้ว ${ok} จาก ${urls.length} รูป` });
    } catch (e) {
      setThumbs({ busy: false, done: 0, total: 0, msg: (e as Error).message });
    }
  };

  const qualityHint = {
    high: 'คมชัดที่สุด (รูปเต็ม ~900px) — เหมาะกับเน็ตเร็ว/จอใหญ่',
    medium: 'สมดุล (~480px) — ชัดพอสำหรับการ์ดสินค้า โหลดเร็วกว่าเกือบ 3 เท่า',
    low: 'เร็วที่สุด (~240px) — เหมาะกับเน็ตมือถือ/เครื่องรุ่นเก่า รูปอาจไม่คมบนจอใหญ่',
  }[v.imageQuality];

  return (
    <>
      <Card title="มุมมองหน้าขาย">
        <Grid max={3}>
        <Field label="มุมมองสินค้าเริ่มต้น" hint="ทุกเครื่องจะเปลี่ยนตามเมื่อบันทึก (พนักงานยังสลับเองได้ที่หน้าขาย)">
          <Seg value={v.defaultView} options={[[5, '5×5'], [4, '4×4'], [3, '3×3']]} onChange={(x) => set({ defaultView: x as 3 | 4 | 5 })} />
        </Field>
        <Field label="ประเภทการขายเริ่มต้น">
          <Seg value={v.defaultOrderType} options={[['หน้าร้าน', 'หน้าร้าน'], ['ออนไลน์ (รับที่ร้าน)', 'ออนไลน์ (รับที่ร้าน)'], ['จัดส่ง', 'จัดส่ง']]} onChange={(x) => set({ defaultOrderType: String(x) })} />
        </Field>
        </Grid>
      </Card>

      <Card title="รูปสินค้าและการ์ดสินค้า">
        <View style={[s.row, { gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }]}>
          <View style={{ flex: 1, minWidth: 260, gap: 12 }}>
            <Grid max={3}>
            <Field label="รูปทรงกรอบรูป">
              <View style={s.seg}>
                {([['square', 'จัตุรัส 1:1'], ['portrait', 'แนวตั้ง 3:4'], ['landscape', 'แนวนอน 4:3']] as [ImageShape, string][]).map(([k, l]) => {
                  const on = v.imageShape === k;
                  return (
                    <Pressable key={k} onPress={() => set({ imageShape: k })} style={[s.segItem, on && s.segOn, { flexDirection: 'row', gap: 6, alignItems: 'center' }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                      <ShapeIcon shape={k} on={on} />
                      <Text style={[s.segText, on && { color: '#fff', fontWeight: '600' }]}>{l}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>
            <Field label="การจัดรูปในกรอบ" hint={v.imageFit === 'cover' ? 'เต็มกรอบ: รูปเต็มพื้นที่ ขอบรูปบางส่วนอาจถูกตัด' : 'พอดีกรอบ: เห็นรูปครบทั้งภาพ คงสัดส่วนเดิม อาจมีขอบว่าง'}>
              <Seg value={v.imageFit} options={[['cover', 'เต็มกรอบ'], ['contain', 'พอดีกรอบ (เห็นทั้งรูป)']]} onChange={(x) => set({ imageFit: x as 'cover' | 'contain' })} />
            </Field>
            <Field label="คุณภาพรูป" hint={qualityHint}>
              <Seg value={v.imageQuality} options={[['high', 'ชัด'], ['medium', 'ปานกลาง'], ['low', 'ต่ำ (เร็ว)']]} onChange={(x) => set({ imageQuality: x as AdminSettings['display']['imageQuality'] })} />
            </Field>
            <Field label="ขนาดตัวอักษรบนการ์ด">
              <Seg value={v.fontSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ fontSize: x as AdminSettings['display']['fontSize'] })} />
            </Field>
            <Field label="ขนาดวงกลมสี" hint="ใหญ่ขึ้น = กดง่ายบนแท็บเล็ต/มือถือ">
              <Seg value={v.swatchSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ swatchSize: x as AdminSettings['display']['swatchSize'] })} />
            </Field>
            <Field label="ขนาดปุ่มไซซ์ / ตัวเลือก" hint="ปุ่มใหญ่อาจขึ้นบรรทัดใหม่เมื่อการ์ดแคบ (เช่นมุมมอง 5×5)">
              <Seg value={v.optionSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ optionSize: x as AdminSettings['display']['optionSize'] })} />
            </Field>
            </Grid>
            <Grid max={3}>
            <Toggle label="แสดงรูปสินค้า" hint="ปิด = ใช้ไอคอนเสื้อผ้าแทน (โหลดเร็วที่สุด)" value={v.showImages} onChange={(x) => set({ showImages: x })} />
            <Toggle label="แสดงรหัสสินค้า (SKU)" hint="ใต้ชื่อสินค้า — เปลี่ยนตามสี/ไซซ์ที่เลือก" value={v.showSku} onChange={(x) => set({ showSku: x })} />
            <Toggle label="แสดงป้ายหมวดหมู่บนรูป" value={v.showCategoryTag} onChange={(x) => set({ showCategoryTag: x })} />
            <Toggle label="แสดงจำนวนคงเหลือบนการ์ดสินค้า" hint="ปิด = แสดงแค่ “พร้อมขาย” (ไม่ให้ลูกค้าเห็นจำนวน)" value={v.showStock} onChange={(x) => set({ showStock: x })} />
            <Toggle label="ซ่อนสินค้าที่หมดทุกตัวเลือก" hint="สินค้าที่สต็อกรวมเป็น 0 จะไม่แสดงในหน้าขาย" value={v.hideOutOfStock} onChange={(x) => set({ hideOutOfStock: x })} />
            </Grid>
          </View>
          <View style={{ width: 210, gap: 6 }}>
            <Text style={s.label}>ตัวอย่างการ์ด</Text>
            <ProductCard
              product={PREVIEW_PRODUCT} categoryName="เสื้อยืด & โปโล" variants={PREVIEW_VARIANTS} cartQty={new Map()}
              width={210} onAdd={() => undefined} onOpen={() => undefined} display={v}
            />
            <Text style={s.hint}>ตัวอย่างใช้ไอคอนแทนรูปจริง — รูปทรงกรอบ ตัวอักษร และข้อมูลที่แสดงตรงกับหน้าขาย</Text>
          </View>
        </View>
        <View style={[s.row, { gap: 10, flexWrap: 'wrap', marginTop: 6 }]}>
          <SmallBtn label="สร้างรูปย่อให้รูปเดิม" icon="images-outline" onPress={makeThumbs} busy={thumbs.busy} />
          <Text style={[s.hint, { flex: 1, minWidth: 200 }]}>
            {thumbs.busy && thumbs.total ? `กำลังย่อรูป ${thumbs.done + 1} / ${thumbs.total}…` : thumbs.msg || 'รูปที่อัปโหลดก่อนหน้านี้ยังไม่มีรูปขนาดกลาง/เล็ก กดครั้งเดียวเพื่อให้ตั้งค่าคุณภาพรูปมีผลกับทุกรูป (รูปใหม่สร้างให้อัตโนมัติ)'}
          </Text>
        </View>
      </Card>

      <Card title="ตะกร้าและการสแกน">
        <Grid max={3}>
        <Toggle label="แสดงรูปสินค้าในตะกร้า" hint="ใช้รูปขนาดเล็กเสมอ ไม่กระทบความเร็ว" value={v.cartImages} onChange={(x) => set({ cartImages: x })} />
        <Toggle label="เสียงบี๊บเมื่อสแกนบาร์โค้ด" hint="เสียงสูง = เจอสินค้า · เสียงต่ำ = ไม่พบรหัส" value={v.scanBeep} onChange={(x) => set({ scanBeep: x })} />
        </Grid>
      </Card>
    </>
  );
}
