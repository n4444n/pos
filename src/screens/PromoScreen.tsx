// หน้า โปรโมชั่น — ส่วนลดและของแถม
//   ส่วนลด   ลด % หรือลดเป็นบาท เมื่อยอดถึงขั้นต่ำ
//   ของแถม   ซื้อครบตามยอด แถมสินค้าฟรี (เข้าบิลเป็นรายการราคา 0 และตัดสต็อกจริง)
// ใช้อัตโนมัติ = ระบบใส่ให้เองเมื่อยอดถึงเงื่อนไข · ไม่อัตโนมัติ = พนักงานกรอกรหัสที่หน้าขาย
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api, type PromoRule } from '../api';
import type { SkuProduct } from '../types';
import { Chips, FieldLabel } from '../components/history/Chips';
import { Icon } from '../components/Icon';
import { NavDrawer, Sidebar, type Route } from '../components/NavMenu';
import { Sheet } from '../components/Sheet';
import { ToastView } from '../components/ToastView';
import { baht } from '../format';
import { can, useSession } from '../session';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';

const dash = (v: string | null) => v || '—';
const period = (p: PromoRule) => (!p.startsAt && !p.endsAt ? 'ไม่จำกัดช่วงเวลา' : `${dash(p.startsAt)} ถึง ${dash(p.endsAt)}`);
/** สรุปเงื่อนไขเป็นประโยคเดียว */
const summary = (p: PromoRule) =>
  p.kind === 'freebie'
    ? `ซื้อครบ ${baht(p.minTotal)} แถม ${p.giftName ?? 'สินค้า'}${p.giftQty > 1 ? ` ${p.giftQty} ชิ้น` : ' 1 ชิ้น'}`
    : `${p.minTotal > 0 ? `ซื้อครบ ${baht(p.minTotal)} ` : ''}ลด ${p.type === 'percent' ? `${p.value}%` : baht(p.value)}`;

export function PromoScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { me } = useSession();
  const editable = can(me, 'promos', 'edit');
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [rows, setRows] = useState<PromoRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromoRule | 'new' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = (kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text });

  const load = useCallback(() => {
    api.promos().then((r) => setRows(r)).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      active: list.filter((p) => p.active).length,
      auto: list.filter((p) => p.active && p.auto).length,
      gift: list.filter((p) => p.active && p.kind === 'freebie').length,
    };
  }, [rows]);

  const toggle = async (p: PromoRule) => {
    try {
      await api.updatePromo(p.code, { active: !p.active });
      notify('success', `${!p.active ? 'เปิด' : 'ปิด'}ใช้งาน ${p.label} แล้ว`);
      load();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="promos" onNavigate={onNavigate} /> : null}
      <View style={[s.main, mobile && { padding: 10 }]}>
        <View style={s.header}>
          <View style={[s.row, { flexShrink: 1 }]}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? setSidebarOpen((o) => !o) : setDrawer(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <View style={{ flexShrink: 1 }}>
              <Text style={s.title}>โปรโมชั่น</Text>
              <Text style={s.sub} numberOfLines={1}>ส่วนลดและของแถม — ใช้อัตโนมัติเมื่อยอดถึงเงื่อนไข หรือให้พนักงานกรอกรหัสที่หน้าขาย</Text>
            </View>
          </View>
          {editable ? (
            <Pressable style={s.addBtn} onPress={() => setEditing('new')} accessibilityLabel="เพิ่มโปรโมชั่น">
              <Icon name="add" size={18} color="#fff" />
              <Text style={s.addText}>เพิ่มโปรโมชั่น</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={s.stats}>
          <Stat label="ทั้งหมด" value={stats.total} />
          <Stat label="เปิดใช้งาน" value={stats.active} tone={colors.success} />
          <Stat label="ใช้อัตโนมัติ" value={stats.auto} tone={colors.primary} />
          <Stat label="ของแถม" value={stats.gift} tone="#B26A00" />
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
          {!rows ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : rows.length === 0 ? (
            <View style={s.empty}>
              <Icon name="gift-outline" size={34} color={colors.faint} />
              <Text style={s.emptyTitle}>ยังไม่มีโปรโมชั่น</Text>
              <Text style={s.sub}>เช่น "ซื้อครบ 2,000 แถมกระเป๋า 1 ใบ" — กดปุ่มเพิ่มโปรโมชั่นด้านบน</Text>
            </View>
          ) : (
            rows.map((p) => (
              <Pressable
                key={p.code}
                style={[s.card, !p.active && { opacity: 0.6 }]}
                onPress={() => editable && setEditing(p)}
                disabled={!editable}
                accessibilityLabel={`แก้ไข ${p.label}`}
              >
                <View style={[s.kindIcon, { backgroundColor: p.kind === 'freebie' ? '#FFF4E0' : colors.primarySoft }]}>
                  <Icon name={p.kind === 'freebie' ? 'gift-outline' : 'pricetag-outline'} size={20} color={p.kind === 'freebie' ? '#B26A00' : colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <View style={[s.row, { flexWrap: 'wrap' }]}>
                    <Text style={s.cardTitle} numberOfLines={1}>{p.label}</Text>
                    <Tag text={p.auto ? 'อัตโนมัติ' : `รหัส ${p.code}`} tone={p.auto ? colors.success : colors.sub} />
                    {!p.active ? <Tag text="ปิดอยู่" tone={colors.danger} /> : null}
                  </View>
                  <Text style={s.cardLine}>{summary(p)}</Text>
                  <Text style={s.sub}>{period(p)}{p.note ? ` · ${p.note}` : ''}</Text>
                </View>
                {editable ? (
                  <Pressable style={s.toggle} onPress={() => toggle(p)} accessibilityLabel={p.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}>
                    <Icon name={p.active ? 'pause-outline' : 'play-outline'} size={16} color={colors.text} />
                    <Text style={s.toggleText}>{p.active ? 'ปิด' : 'เปิด'}</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
      <PromoEditor target={editing} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); notify('success', msg); load(); }} />
      <NavDrawer visible={drawer} onClose={() => setDrawer(false)} route="promos" onNavigate={onNavigate} />
      <ToastView toast={toast} onDone={() => setToast(null)} />
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={s.sub}>{label}</Text>
    </View>
  );
}
function Tag({ text, tone }: { text: string; tone: string }) {
  return (
    <View style={[s.tag, { borderColor: tone }]}>
      <Text style={[s.tagText, { color: tone }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- เพิ่ม / แก้ไข
function PromoEditor({ target, onClose, onSaved }: { target: PromoRule | 'new' | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const isNew = target === 'new';
  const cur = target && target !== 'new' ? target : null;

  const [kind, setKind] = useState<'discount' | 'freebie'>('freebie');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [minTotal, setMinTotal] = useState('2000');
  const [type, setType] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('10');
  const [giftVariantId, setGiftVariantId] = useState<number | null>(null);
  const [giftQty, setGiftQty] = useState('1');
  const [auto, setAuto] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [giftName, setGiftName] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setError(null);
    setKind(cur?.kind ?? 'freebie');
    setCode(cur?.code ?? '');
    setLabel(cur?.label ?? '');
    setMinTotal(String(cur?.minTotal ?? 2000));
    setType(cur?.type ?? 'percent');
    setValue(String(cur?.value ?? 10));
    setGiftVariantId(cur?.giftVariantId ?? null);
    setGiftName(cur?.giftName ?? null);
    setGiftQty(String(cur?.giftQty ?? 1));
    setAuto(cur ? cur.auto : true);
    setStartsAt(cur?.startsAt ?? '');
    setEndsAt(cur?.endsAt ?? '');
    setNote(cur?.note ?? '');
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeOk = !isNew || /^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code.toUpperCase());
  const ready =
    label.trim().length > 0 && codeOk &&
    (kind === 'freebie' ? !!giftVariantId && Number(minTotal) > 0 : Number(value) > 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      label: label.trim(), kind, type, value: Number(value) || 0, minTotal: Number(minTotal) || 0,
      giftVariantId, giftQty: Number(giftQty) || 1, auto, startsAt: startsAt || null, endsAt: endsAt || null, note: note.trim(),
    };
    try {
      if (isNew) await api.createPromo({ ...body, code: code.toUpperCase(), active: true } as never);
      else await api.updatePromo(cur!.code, body as never);
      onSaved(isNew ? 'เพิ่มโปรโมชั่นแล้ว' : 'บันทึกแล้ว');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!cur) return;
    setBusy(true);
    try {
      await api.deletePromo(cur.code);
      onSaved('ลบโปรโมชั่นแล้ว');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        visible={!!target}
        onClose={onClose}
        title={isNew ? 'เพิ่มโปรโมชั่น' : `แก้ไข ${cur?.label ?? ''}`}
        width={520}
        footer={
          <View style={[s.row, { gap: 8 }]}>
            {cur ? (
              <Pressable style={s.delBtn} disabled={busy} onPress={remove} accessibilityLabel="ลบโปรโมชั่น">
                <Icon name="trash-outline" size={16} color={colors.danger} />
              </Pressable>
            ) : null}
            <Pressable style={[s.saveBtn, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={save}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>{isNew ? 'เพิ่มโปรโมชั่น' : 'บันทึก'}</Text>}
            </Pressable>
          </View>
        }
      >
        <FieldLabel>รูปแบบ</FieldLabel>
        <Chips
          options={[{ value: 'freebie', label: 'ของแถม' }, { value: 'discount', label: 'ส่วนลด' }]}
          value={kind}
          onChange={(v) => setKind(v as 'discount' | 'freebie')}
        />

        <FieldLabel required>ชื่อโปรโมชั่น (แสดงให้พนักงานเห็น)</FieldLabel>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder={kind === 'freebie' ? 'เช่น ซื้อครบ 2,000 แถมกระเป๋า 1 ใบ' : 'เช่น ลด 10% ทั้งร้าน'}
          placeholderTextColor={colors.faint}
          style={s.input}
          maxLength={80}
        />

        {isNew ? (
          <>
            <FieldLabel required>รหัสโปรโมชั่น</FieldLabel>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20))}
              placeholder="เช่น BAG2000"
              placeholderTextColor={colors.faint}
              style={[s.input, { letterSpacing: 1 }]}
            />
            <Text style={s.hint}>ใช้อ้างอิงในบิล · ถ้าไม่ใช้อัตโนมัติ พนักงานจะกรอกรหัสนี้ที่หน้าขาย</Text>
          </>
        ) : null}

        <FieldLabel required={kind === 'freebie'}>ยอดซื้อขั้นต่ำ (บาท)</FieldLabel>
        <TextInput value={minTotal} onChangeText={(t) => setMinTotal(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={s.input} maxLength={9} />

        {kind === 'freebie' ? (
          <>
            <FieldLabel required>สินค้าที่แถม</FieldLabel>
            <Pressable style={s.pick} onPress={() => setPicking(true)} accessibilityLabel="เลือกสินค้าที่แถม">
              <Icon name="gift-outline" size={18} color={colors.primary} />
              <Text style={[s.pickText, !giftVariantId && { color: colors.faint }]} numberOfLines={1}>
                {giftName ?? (giftVariantId ? `สินค้า #${giftVariantId}` : 'เลือกสินค้า…')}
              </Text>
              <Icon name="chevron-forward" size={16} color={colors.sub} />
            </Pressable>
            <FieldLabel>จำนวนที่แถม</FieldLabel>
            <TextInput value={giftQty} onChangeText={(t) => setGiftQty(t.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" style={[s.input, { width: 100 }]} />
            <Text style={s.hint}>ของแถมเข้าบิลเป็นรายการราคา 0 บาท และตัดสต็อกจริง · ถ้าของแถมหมด ระบบจะข้ามให้ ขายต่อได้ตามปกติ</Text>
          </>
        ) : (
          <>
            <FieldLabel>ลดแบบไหน</FieldLabel>
            <Chips
              options={[{ value: 'percent', label: 'ลดเป็น %' }, { value: 'amount', label: 'ลดเป็นบาท' }]}
              value={type}
              onChange={(v) => setType(v as 'percent' | 'amount')}
            />
            <FieldLabel required>{type === 'percent' ? 'ลดกี่เปอร์เซ็นต์' : 'ลดกี่บาท'}</FieldLabel>
            <TextInput value={value} onChangeText={(t) => setValue(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={[s.input, { width: 140 }]} />
          </>
        )}

        <Pressable style={s.toggleRow} onPress={() => setAuto((a) => !a)} accessibilityRole="switch" accessibilityState={{ checked: auto }}>
          <View style={[s.check, auto && s.checkOn]}>{auto ? <Icon name="checkmark" size={14} color="#fff" /> : null}</View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>ใช้อัตโนมัติเมื่อยอดถึงเงื่อนไข</Text>
            <Text style={s.hint}>ไม่ต้องกรอกรหัสที่หน้าขาย — ระบบใส่ให้เองตอนบันทึกบิล</Text>
          </View>
        </Pressable>

        <FieldLabel>ช่วงเวลา (เว้นว่าง = ไม่จำกัด)</FieldLabel>
        <View style={[s.row, { gap: 8 }]}>
          <TextInput value={startsAt} onChangeText={setStartsAt} placeholder="เริ่ม 2026-11-01" placeholderTextColor={colors.faint} style={[s.input, { flex: 1 }]} maxLength={10} />
          <TextInput value={endsAt} onChangeText={setEndsAt} placeholder="ถึง 2026-12-31" placeholderTextColor={colors.faint} style={[s.input, { flex: 1 }]} maxLength={10} />
        </View>

        <FieldLabel>หมายเหตุ</FieldLabel>
        <TextInput value={note} onChangeText={setNote} placeholder="บันทึกไว้ดูเอง" placeholderTextColor={colors.faint} style={s.input} maxLength={200} />

        {error ? <Text style={s.error}>{error}</Text> : null}
      </Sheet>

      <GiftPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(id, name) => {
          setGiftVariantId(id);
          setGiftName(name);
          setPicking(false);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------- เลือกสินค้าที่จะแถม
function GiftPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (id: number, name: string) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SkuProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    api.skus({ q, limit: 30, page: 1 })
      .then((r) => setRows(r.products))
      .catch((e: Error) => setError(e.message));
  }, [visible, q]);

  return (
    <Sheet visible={visible} onClose={onClose} title="เลือกสินค้าที่จะแถม" width={520}>
      <TextInput value={q} onChangeText={setQ} placeholder="ค้นหาชื่อสินค้า / SKU" placeholderTextColor={colors.faint} style={s.input} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!rows ? (
        <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
      ) : (
        rows.map((p) => (
          <View key={p.id} style={{ gap: 4 }}>
            <Text style={s.group}>{p.name}</Text>
            {p.variants.map((v) => (
              <Pressable
                key={v.id}
                style={s.giftRow}
                onPress={() => onPick(v.id, `${p.name} (${[v.color, v.size].filter(Boolean).join(' / ')})`)}
                accessibilityLabel={`แถม ${p.name} ${v.color} ${v.size}`}
              >
                <Text style={s.giftText} numberOfLines={1}>{[v.color, v.size, v.extra].filter(Boolean).join(' / ') || v.sku}</Text>
                <Text style={s.sub}>คงเหลือ {v.stock}</Text>
                <Icon name="chevron-forward" size={16} color={colors.sub} />
              </Pressable>
            ))}
          </View>
        ))
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub, lineHeight: 18 },
  hint: { fontFamily: font, fontSize: 11.5, color: colors.sub, lineHeight: 17 },
  label: { fontFamily: font, fontSize: 14, color: colors.text, fontWeight: '600' },
  error: { fontFamily: font, fontSize: 13, color: colors.danger },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.primary },
  addText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  stat: { flexGrow: 1, flexBasis: 120, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12 },
  statValue: { fontFamily: font, fontSize: 22, fontWeight: '700', color: colors.text },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  kindIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  cardLine: { fontFamily: font, fontSize: 13, color: colors.text },
  tag: { paddingHorizontal: 8, height: 22, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  tagText: { fontFamily: font, fontSize: 11, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  toggleText: { fontFamily: font, fontSize: 12, color: colors.text },
  empty: { alignItems: 'center', gap: 6, padding: 40 },
  emptyTitle: { fontFamily: font, fontSize: 16, fontWeight: '600', color: colors.text },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  pickText: { fontFamily: font, fontSize: 14, color: colors.text, flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F2F4F7', marginTop: 4 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  group: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.faint, marginTop: 8 },
  giftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.surface },
  giftText: { fontFamily: font, fontSize: 13.5, color: colors.text, flex: 1 },
  saveBtn: { flex: 1, height: 50, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
  delBtn: { width: 50, height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: '#F3C4C6', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft },
});
