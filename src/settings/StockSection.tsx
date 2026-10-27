// ตั้งค่า → สต็อก (แจ้งเตือนสินค้าเหลือน้อย · รูปแบบรหัส SKU)
import { Text, View } from 'react-native';
import type { AdminSettings } from '../api';
import { Card, Field, Grid, Input, Seg, Toggle, type Upd, s } from './ui';

export function StockSection({ v, set, openBranches }: { v: AdminSettings['stock']; set: Upd<AdminSettings['stock']>; openBranches: () => void }) {
  const example = `TS-001${v.skuSeparator}${'1'.padStart(v.skuDigits, '0')}`;
  return (
    <>
      <Card title="สต็อก">
        <Grid>
          <Field label="จุดแจ้งเตือนเหลือน้อย (ค่าเริ่มต้นของสินค้าใหม่)" hint="ชิ้นต่อ SKU · ปรับรายสินค้าได้ในหน้าแก้ไขสินค้า">
            <Input value={String(v.lowStockDefault)} onChange={(t) => set({ lowStockDefault: Number(t.replace(/[^0-9]/g, '') || 0) })} keyboard="number-pad" max={4} />
          </Field>
          <Field label="รูปแบบรหัส SKU อัตโนมัติ" hint={`ตัวอย่าง: ${example}`}>
            <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
              <Seg value={v.skuSeparator} options={[['-', 'ขีด -'], ['', 'ไม่มี'], ['.', 'จุด .'], ['_', '_']]} onChange={(x) => set({ skuSeparator: x as AdminSettings['stock']['skuSeparator'] })} />
              <Seg value={v.skuDigits} options={[[3, '3 หลัก'], [4, '4 หลัก'], [5, '5 หลัก'], [6, '6 หลัก']]} onChange={(x) => set({ skuDigits: Number(x) })} />
            </View>
          </Field>
        </Grid>
        <Toggle
          label="ขายได้แม้สต็อกหมด (สต็อกติดลบได้)"
          hint={v.allowNegative
            ? 'เปิดอยู่: ขายสินค้าที่สต็อกเป็น 0 ได้ ยอดจะติดลบไปเรื่อย ๆ · เมื่อเพิ่มสต็อกด้วยคำสั่งพิเศษ ระบบหักกับยอดติดลบให้ เช่น เหลือ −8 เพิ่ม 10 → เหลือ 2'
            : 'ปิดอยู่: ขายได้ไม่เกินจำนวนในสต็อก (สินค้าที่เหลือ 0 จะขายไม่ได้)'}
          value={v.allowNegative}
          onChange={(x) => set({ allowNegative: x })}
        />
      </Card>
      <Text style={s.sub}>
        การเพิ่มสาขาและเชื่อมข้อมูลสินค้าหลายร้าน อยู่ที่เมนู <Text style={s.link} onPress={openBranches}>สาขา</Text>
      </Text>
    </>
  );
}
