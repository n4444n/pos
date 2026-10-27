// ตั้งค่า → ข้อมูลร้าน
import { Text } from 'react-native';
import type { AdminSettings } from '../api';
import { Card, Field, Grid, Input, type Upd, s } from './ui';

export function ShopSection({ v, set, goBranches }: { v: AdminSettings['shop']; set: Upd<AdminSettings['shop']>; goBranches: () => void }) {
  return (
    <Card>
      <Grid>
        <Field label="ชื่อร้าน *" hint="แสดงบนหัวใบเสร็จทุกสาขา"><Input value={v.name} onChange={(t) => set({ name: t })} placeholder="เช่น ร้านเสื้อผ้า ABC" max={80} /></Field>
        <Field label="เลขประจำตัวผู้เสียภาษี" hint="พิมพ์บนใบเสร็จ/ใบกำกับภาษีอย่างย่อ"><Input value={v.taxId} onChange={(t) => set({ taxId: t.replace(/[^0-9]/g, '') })} placeholder="13 หลัก" max={13} /></Field>
        <Field label="เบอร์โทร (ค่าเริ่มต้น)" hint="ใช้เมื่อสาขาไม่ได้ใส่เบอร์ของตัวเอง"><Input value={v.phone} onChange={(t) => set({ phone: t })} placeholder="02-xxx-xxxx" max={40} /></Field>
      </Grid>
      <Field label="ที่อยู่ (ค่าเริ่มต้น)" hint="ใช้เมื่อสาขาไม่ได้ใส่ที่อยู่ของตัวเอง"><Input value={v.address} onChange={(t) => set({ address: t })} placeholder="ที่อยู่ร้าน" max={300} multiline /></Field>
      <Text style={s.sub}>
        ชื่อสาขา รหัสสาขา ที่อยู่ เบอร์โทร รูป และ VAT ของแต่ละสาขา ตั้งที่เมนู <Text style={s.link} onPress={goBranches}>สาขา</Text>
      </Text>
    </Card>
  );
}
