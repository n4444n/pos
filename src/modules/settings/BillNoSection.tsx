// ตั้งค่า → เลขที่บิล: รูปแบบเลขที่บิลของ "สาขาที่กำลังใช้งาน" เท่านั้น (แต่ละสาขาตั้งแยกกัน)
// บันทึกด้วยปุ่มของหน้านี้เอง (ไม่ใช้ปุ่มบันทึกรวมของหน้าตั้งค่า)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type BillFormat, type BillNoAdmin } from '../../shared/api';
import { Icon } from '../../shared/ui/Icon';
import { colors, font, radius } from '../../shared/lib/theme';
import { Card, Field, Input, Seg, Toggle, s, type Notify } from './ui';

const DATE_OPT: [BillFormat['date'], string][] = [['ymd', 'รายวัน'], ['ym', 'รายเดือน'], ['y', 'รายปี'], ['none', 'ไม่ใส่วันที่']];

/** ตัวอย่างเลขบิล (คำนวณแบบเดียวกับเซิร์ฟเวอร์ — billNo.ts) */
function sample(f: BillFormat, branchCode: string, terminal: string | null, n = 1) {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const date = f.date === 'ymd' ? `${yy}${p(d.getMonth() + 1)}${p(d.getDate())}` : f.date === 'ym' ? `${yy}${p(d.getMonth() + 1)}` : f.date === 'y' ? yy : '';
  const parts = [f.prefix, f.branchCode ? branchCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '', f.terminalCode && terminal ? terminal : '', date].filter(Boolean);
  return (parts.length ? parts.join(f.sep) + f.sep : '') + String(n).padStart(f.digits, '0');
}

const capHint = (d: BillFormat['date'], n: string) =>
  d === 'ymd' ? `ออกได้วันละ ${n} บิล · เกินแล้วเลขยาวขึ้นเอง ไม่ซ้ำ`
    : d === 'ym' ? `ออกได้เดือนละ ${n} บิล · เกินแล้วเลขยาวขึ้นเอง ไม่ซ้ำ`
      : d === 'y' ? `ออกได้ปีละ ${n} บิล · เกินแล้วเลขยาวขึ้นเอง ไม่ซ้ำ`
        : `ออกได้ ${n} บิล · เกินแล้วเลขยาวขึ้นเอง ไม่ซ้ำ`;

const RESTART: Record<BillFormat['date'], string> = {
  ymd: 'ปีเดือนวัน (ค.ศ. 2 หลัก) · เลขรันเริ่ม 1 ใหม่ทุกวัน',
  ym: 'ปีเดือน · เลขรันเริ่ม 1 ใหม่ทุกเดือน',
  y: 'ปี · เลขรันเริ่ม 1 ใหม่ทุกปี',
  none: 'เลขรันต่อเนื่องไม่เริ่มใหม่',
};

export function BillNoSection({ notify, onChanged, goTax }: { notify: Notify; onChanged: () => void; goTax: () => void }) {
  const [data, setData] = useState<BillNoAdmin | null>(null);
  const [f, setF] = useState<BillFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.billNo();
      setData(d);
      setF(d.format);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => !!data && !!f && JSON.stringify(f) !== JSON.stringify(data.format), [data, f]);

  if (error) return <Text style={[s.sub, { color: colors.danger }]}>{error}</Text>;
  if (!data || !f) return <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />;

  const b = data.branch;
  const term = data.terminals[0] ?? null;
  const set = (x: Partial<BillFormat>) => setF({ ...f, ...x });
  const preview = sample(f, b.code, null);
  const previewTerm = term ? sample(f, b.code, term) : null;
  const oldNo = sample(data.defaults, b.code, null);
  const empty = !f.prefix && !f.branchCode && f.date === 'none';

  const presets: { label: string; f: BillFormat }[] = [
    { label: 'แบบเดิม', f: data.defaults },
    { label: 'สั้น', f: { ...data.defaults, prefix: '', date: 'ym' } },
    { label: 'สั้นมาก', f: { ...data.defaults, prefix: '', date: 'ym', sep: '' } },
  ];

  const save = async (body: BillFormat | { reset: true }, ok: string) => {
    setBusy(true);
    try {
      const d = await api.saveBillNo(body);
      setData(d);
      setF(d.format);
      onChanged(); // หน้าขายแสดงเลขบิลถัดไปตามรูปแบบใหม่
      notify('success', ok);
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {/* ใช้กับสาขาไหน */}
      <View style={st.branchBar}>
        <Icon name="storefront-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.branchTitle}>{`ตั้งค่าของ ${b.name} (${b.code}) เท่านั้น`}</Text>
          <Text style={s.sub}>สาขาอื่นไม่เปลี่ยนตาม — ต้องการตั้งของสาขาอื่น ให้เปลี่ยนสาขาที่มุมซ้ายบนก่อน แล้วกลับมาที่หน้านี้</Text>
        </View>
        <View style={[st.badge, data.custom ? { backgroundColor: colors.primarySoft } : { backgroundColor: colors.surface }]}>
          <Text style={[st.badgeText, { color: data.custom ? colors.primary : colors.sub }]}>{data.custom ? 'ตั้งเองแล้ว' : 'ใช้รูปแบบเดิม'}</Text>
        </View>
      </View>

      <Card title="ตัวอย่างเลขที่บิล">
        <View style={st.previewBox}>
          <Text style={st.preview} selectable>{preview}</Text>
          <Text style={s.sub}>{preview !== oldNo ? `${preview.length} ตัวอักษร · แบบเดิม ${oldNo} (${oldNo.length} ตัวอักษร)` : `${preview.length} ตัวอักษร`}</Text>
          {previewTerm ? <Text style={s.sub}>{`เครื่อง POS ${term}: ${previewTerm}`}</Text> : null}
        </View>
        <Text style={s.sub}>
          {data.nextTerminal ? `เลขบิลถัดไปของสาขานี้ (ตามที่บันทึกไว้): ${data.next} · เครื่อง POS ${data.nextTerminal}` : `เลขบิลถัดไปของสาขานี้ (ตามที่บันทึกไว้): ${data.next}`}
        </Text>
        <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
          <Text style={[s.sub, { fontWeight: '600' }]}>แบบสำเร็จรูป:</Text>
          {presets.map((p) => {
            const on = JSON.stringify(p.f) === JSON.stringify(f);
            return (
              <Pressable key={p.label} onPress={() => setF(p.f)} style={[st.chip, on && st.chipOn]}>
                <Text style={[st.chipText, on && { color: '#fff' }]}>{p.label} · {sample(p.f, b.code, null)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card title="รูปแบบเลขที่บิล">
        <Field label="ตัวอักษรนำหน้า" hint="A–Z และ 0–9 ไม่เกิน 8 ตัว · เว้นว่างได้ เพื่อให้เลขสั้นลง">
          <Input value={f.prefix} onChange={(t) => set({ prefix: t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} max={8} placeholder="เช่น INV" />
        </Field>
        <Toggle
          label={`ใส่รหัสสาขา (${b.code})`}
          hint={f.branchCode ? 'บอกได้ทันทีว่าเป็นบิลของสาขาไหน' : 'ไม่ใส่ — ถ้าสาขาอื่นใช้รูปแบบเดียวกัน เลขจะรันต่อกัน (ไม่ซ้ำกัน แต่เลขข้ามไป)'}
          value={f.branchCode}
          onChange={(x) => set({ branchCode: x })}
        />
        <Toggle
          label="ใส่รหัสเครื่อง POS"
          hint={
            data.terminals.length
              ? `สาขานี้มีเครื่อง POS ${data.terminals.join(', ')} · ถ้าจด VAT กรมสรรพากรให้เลขบิลรันแยกต่อเครื่อง — แนะนำให้เปิดไว้`
              : 'ใช้เมื่อสาขานี้ตั้งเครื่อง POS ไว้ (ตั้งค่า → ภาษี) · ตอนนี้ยังไม่มีเครื่อง จึงไม่มีผล'
          }
          value={f.terminalCode}
          onChange={(x) => set({ terminalCode: x })}
        />
        {!data.terminals.length ? (
          <Text style={[s.hint, { marginTop: -4 }]}>
            ตั้งเครื่อง POS ได้ที่ <Text style={s.link} onPress={goTax}>ภาษี (VAT)</Text>
          </Text>
        ) : null}
        <Field label="วันที่ในเลขบิล" hint={RESTART[f.date]}>
          <Seg value={f.date} options={DATE_OPT} onChange={(x) => set({ date: x as BillFormat['date'] })} />
        </Field>
        <Field label="จำนวนหลักของเลขรัน" hint={capHint(f.date, '9'.repeat(f.digits))}>
          <Seg value={f.digits} options={[[3, '3 หลัก'], [4, '4 หลัก'], [5, '5 หลัก'], [6, '6 หลัก']]} onChange={(x) => set({ digits: Number(x) })} />
        </Field>
        <Field label="ตัวคั่น">
          <Seg value={f.sep} options={[['-', 'มีขีด ( - )'], ['', 'ไม่มีตัวคั่น']]} onChange={(x) => set({ sep: x as BillFormat['sep'] })} />
        </Field>
        {empty ? (
          <Text style={[s.sub, { color: colors.danger }]}>ต้องมีตัวอักษรนำหน้า รหัสสาขา หรือวันที่ อย่างน้อย 1 อย่าง</Text>
        ) : null}
        <Text style={s.hint}>มีผลกับบิลใหม่ตั้งแต่บันทึก · บิลที่ออกไปแล้วยังใช้เลขเดิม · เลขบิลไม่ซ้ำกันทั้งร้านเสมอ</Text>
      </Card>

      <View style={[s.saveBar, { position: 'relative', paddingBottom: 4 }]}>
        <Pressable style={[s.ghostBtn, (!data.custom || busy) && { opacity: 0.4 }]} disabled={!data.custom || busy} onPress={() => save({ reset: true }, `${b.name}: กลับไปใช้เลขบิลแบบเดิมแล้ว`)}>
          <Text style={s.ghostText}>คืนค่าแบบเดิม</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={[s.ghostBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty || busy} onPress={() => setF(data.format)}>
          <Text style={s.ghostText}>ยกเลิก</Text>
        </Pressable>
        <Pressable style={[s.primaryBtn, (!dirty || busy || empty) && { opacity: 0.45 }]} disabled={!dirty || busy || empty} onPress={() => save(f, `บันทึกเลขที่บิลของ ${b.name} แล้ว`)}>
          {busy ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="save-outline" size={16} color="#fff" />
              <Text style={s.primaryText}>บันทึก</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  branchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.primary },
  branchTitle: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontFamily: font, fontSize: 12, fontWeight: '600' },
  previewBox: { alignItems: 'center', gap: 4, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  preview: { fontFamily: font, fontSize: 26, fontWeight: '700', color: colors.primary, letterSpacing: 1 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: font, fontSize: 12, color: colors.text },
});
