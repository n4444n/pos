// ตั้งค่า → บาร์โค้ด (ประเภท · สร้างอัตโนมัติ)
import { Pressable, Text, View } from 'react-native';
import type { AdminSettings } from '../api';
import { Icon } from '../components/Icon';
import { Barcode } from '../components/stock/Barcode';
import { colors } from '../theme';
import { Card, Field, Input, Seg, type Upd, s } from './ui';

export function BarcodeSection({ v, set, stock, goStock, goLabels }: { v: AdminSettings['barcode']; set: Upd<AdminSettings['barcode']>; stock: AdminSettings['stock']; goStock: () => void; goLabels: () => void }) {
  const sample = v.symbology === 'ean13' ? '8850001234560' : `TS-001${stock.skuSeparator}${'1'.padStart(stock.skuDigits, '0')}`;
  return (
    <>
      <Card title="ประเภทบาร์โค้ด">
        <Seg value={v.symbology} options={[['code128', 'Code 128 (ตัวเลข+ตัวอักษร)'], ['ean13', 'EAN-13 (ตัวเลข 13 หลัก)']]} onChange={(x) => set({ symbology: x as 'code128' | 'ean13' })} />
        <Text style={s.sub}>
          Code 128 ใช้ได้กับทุกรหัส · EAN-13 ใช้กับรหัสตัวเลข 13 หลักที่ถูกต้อง (ถ้ารหัสไม่ใช่ EAN-13 ระบบจะแสดงเป็น Code 128 ให้อัตโนมัติ) · เครื่องสแกนทั่วไปอ่านได้ทั้งสองแบบ
        </Text>
        <View style={s.preview}>
          <Barcode value={sample} />
        </View>
      </Card>
      <Card title="สร้างบาร์โค้ดอัตโนมัติ (สำหรับ SKU ใหม่)">
        <Seg value={v.autoAssign} options={[['none', 'ไม่สร้าง (กำหนดเอง)'], ['sku', 'ใช้รหัส SKU'], ['ean13', 'สุ่ม EAN-13']]} onChange={(x) => set({ autoAssign: x as 'none' | 'sku' | 'ean13' })} />
        {v.autoAssign === 'ean13' ? (
          <Field label="ตัวเลขนำหน้า EAN-13" hint="รหัสใช้ภายในร้านควรขึ้นต้นด้วย 2 (ไม่ชนกับบาร์โค้ดสินค้าจากโรงงาน)">
            <Input value={v.ean13Prefix} onChange={(t) => set({ ean13Prefix: t.replace(/[^0-9]/g, '') })} keyboard="number-pad" max={6} />
          </Field>
        ) : null}
        <Text style={s.sub}>
          รูปแบบรหัส SKU (ตัวคั่น/จำนวนหลัก) ตั้งได้ที่ <Text style={s.link} onPress={goStock}>สต็อก & เชื่อมสาขา</Text>
        </Text>
      </Card>
      <Pressable style={({ hovered }: { hovered?: boolean }) => [s.linkCard, hovered && { backgroundColor: '#E3EBFF' }]} onPress={goLabels} accessibilityRole="link">
        <Icon name="pricetags-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.linkTitle}>กระดาษบาร์โค้ด (ป้ายติดสินค้า)</Text>
          <Text style={s.hint}>ขนาดสติ๊กเกอร์ · ดวงต่อแถว · ขนาดบาร์โค้ด · ชื่อ/ราคา/รหัสบนป้าย · หลายโปรไฟล์</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
    </>
  );
}
