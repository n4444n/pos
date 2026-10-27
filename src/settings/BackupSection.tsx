// ตั้งค่า → สำรอง & กู้คืนข้อมูล (ผู้จัดการ)
// - สำรอง: ดาวน์โหลดไฟล์ .db ทั้งร้าน หรือเฉพาะสาขา
// - กู้คืน: ลากไฟล์ .db มาวาง → ระบบตรวจไฟล์ + แสดงสาขาในไฟล์ → เลือกสาขาที่จะกู้ → ยืนยันด้วย PIN ผู้จัดการ
//   กู้เฉพาะข้อมูลของสาขาที่เลือก (บิล กะ เงิน สต็อก ค่าใช้จ่าย เอกสารภาษี) · ก่อนกู้ระบบสำรองข้อมูลปัจจุบันไว้ให้เสมอ
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type BackupPreview, type Branch, type RestoreResult } from '../api';
import { Icon } from '../components/Icon';
import { thaiDateTime } from '../format';
import { colors, font, radius } from '../theme';
import { Card, s, type Notify } from './ui';

const n = (x: number) => x.toLocaleString('th-TH');
const when = (at: string | null) => (at ? thaiDateTime(at) : '—');
/** ISO (เวลาที่สร้างไฟล์) → เวลาไทยของเครื่องนี้ */
const isoLocal = (iso: string | null) => {
  if (!iso) return 'ไม่ทราบ';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return thaiDateTime(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
};

export function BackupSection({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  return (
    <>
      <BackupCard />
      <RestoreCard notify={notify} onChanged={onChanged} />
    </>
  );
}

// ---------------------------------------------------------------- สำรอง (ดาวน์โหลด)
function BackupCard() {
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    api.branches().then((r) => setBranches(r.list)).catch(() => setBranches([]));
  }, []);
  const download = (branch?: number) => {
    if (Platform.OS === 'web') window.open(api.backupUrl(branch), '_blank');
  };
  const row = (title: string, sub: string, branch?: number) => (
    <View key={branch ?? 'all'} style={st.dlRow}>
      <View style={st.dlIcon}><Icon name={branch ? 'storefront-outline' : 'business-outline'} size={18} color={colors.primary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.optTitle} numberOfLines={1}>{title}</Text>
        <Text style={s.hint}>{sub}</Text>
      </View>
      <Pressable style={s.smallBtn} onPress={() => download(branch)} accessibilityLabel={`ดาวน์โหลดไฟล์สำรอง ${title}`}>
        <Icon name="download-outline" size={15} color={colors.primary} />
        <Text style={s.smallBtnText}>ดาวน์โหลด</Text>
      </Pressable>
    </View>
  );
  return (
    <Card title="สำรองข้อมูล">
      <Text style={s.sub}>ดาวน์โหลดไฟล์ .db เก็บไว้ (เช่น แฟลชไดรฟ์ / Google Drive) — ใช้กู้คืนได้ในหน้านี้</Text>
      {row('ทั้งร้าน (ทุกสาขา)', 'สินค้า · พนักงาน · ตั้งค่า + ข้อมูลของทุกสาขา')}
      {branches.map((b) => row(b.name, `${b.code ? `${b.code} · ` : ''}บิล กะ สต็อก ค่าใช้จ่าย เอกสารภาษี ของสาขานี้ + รายการสินค้า`, b.id))}
    </Card>
  );
}

// ---------------------------------------------------------------- กู้คืน
type Phase = { k: 'idle' } | { k: 'uploading'; name: string } | { k: 'ready'; p: BackupPreview; name: string } | { k: 'done'; r: RestoreResult };

function RestoreCard({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [pick, setPick] = useState<number[]>([]);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropRef = useRef<unknown>(null);

  const take = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.(db|sqlite3?)$/i.test(file.name)) return setError('เลือกไฟล์สำรองนามสกุล .db');
    setPhase({ k: 'uploading', name: file.name });
    try {
      const p = await api.uploadBackup(file);
      setPick(p.branches.filter((b) => b.hasData && b.current).length === 1 ? p.branches.filter((b) => b.hasData && b.current).map((b) => b.id) : []);
      setPin('');
      setConfirm(false);
      setPhase({ k: 'ready', p, name: file.name });
    } catch (e) {
      setError((e as Error).message);
      setPhase({ k: 'idle' });
    }
  }, []);

  // ลากไฟล์มาวาง (เว็บ / แอป .exe)
  useEffect(() => {
    const el = dropRef.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el?.addEventListener) return;
    const stop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const enter = (e: DragEvent) => { stop(e); setOver(true); };
    const leave = (e: DragEvent) => { stop(e); setOver(false); };
    const drop = (e: DragEvent) => { stop(e); setOver(false); take(e.dataTransfer?.files?.[0]); };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragover', enter);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragover', enter);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  }, [take, phase.k]);

  const browse = () => {
    if (Platform.OS !== 'web') return;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.db,.sqlite,.sqlite3';
    inp.onchange = () => take(inp.files?.[0]);
    inp.click();
  };
  const reset = () => {
    if (phase.k === 'ready') api.discardBackup(phase.p.id).catch(() => {});
    setPhase({ k: 'idle' });
    setError(null);
    setPin('');
    setConfirm(false);
  };
  const restore = async () => {
    if (phase.k !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.restoreBackup(phase.p.id, pick, pin);
      setPhase({ k: 'done', r });
      notify('success', `กู้คืนข้อมูล ${r.branches.map((b) => b.name).join(', ')} แล้ว`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
      setPin('');
    }
  };

  // ---- เสร็จแล้ว
  if (phase.k === 'done') {
    return (
      <Card title="กู้คืนข้อมูล">
        <View style={[st.box, st.ok]}>
          <Icon name="checkmark-circle" size={22} color={colors.success} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[s.optTitle, { color: colors.success }]}>กู้คืนเรียบร้อย</Text>
            {phase.r.branches.map((b) => <Text key={b.id} style={s.p}>• {b.name} — {n(b.rows)} รายการ</Text>)}
            <Text style={s.hint}>ข้อมูลก่อนกู้คืนถูกเก็บไว้ที่ {phase.r.safetyBackup} (ย้อนกลับได้โดยกู้คืนจากไฟล์นี้)</Text>
            <Text style={s.hint}>เครื่องอื่นที่เปิดหน้าขายอยู่ ให้รีเฟรชหน้าจอหนึ่งครั้ง</Text>
          </View>
        </View>
        <Pressable style={[s.smallBtn, { alignSelf: 'flex-start' }]} onPress={reset}>
          <Text style={s.smallBtnText}>เสร็จสิ้น</Text>
        </Pressable>
      </Card>
    );
  }

  // ---- เลือกไฟล์
  if (phase.k !== 'ready') {
    return (
      <Card title="กู้คืนข้อมูล">
        <Pressable ref={dropRef as never} onPress={browse} disabled={phase.k === 'uploading'} style={[st.drop, over && st.dropOver]} accessibilityLabel="เลือกไฟล์สำรอง">
          {phase.k === 'uploading' ? (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text style={st.dropTitle}>กำลังตรวจไฟล์ {phase.name}…</Text>
            </>
          ) : (
            <>
              <View style={st.dropIcon}><Icon name="cloud-upload-outline" size={28} color={colors.primary} /></View>
              <Text style={st.dropTitle}>ลากไฟล์สำรอง (.db) มาวางที่นี่</Text>
              <Text style={s.sub}>หรือ <Text style={s.link}>คลิกเพื่อเลือกไฟล์</Text> · ระบบจะแสดงสาขาในไฟล์ให้เลือกก่อนกู้คืน</Text>
            </>
          )}
        </Pressable>
        {error ? <Text style={st.err}>{error}</Text> : null}
        <View style={s.infoBox}>
          <Text style={s.hint}>• กู้คืนแทนที่ข้อมูลของสาขาที่เลือก: บิลขาย การชำระเงิน กะ/เงินสด สต็อกและราคาสาขา ค่าใช้จ่าย บิลที่พักไว้ ใบกำกับภาษีเต็มรูป ใบลดหนี้</Text>
          <Text style={s.hint}>• ไม่แตะ: สาขาอื่น · รายการสินค้า/หมวดหมู่ · พนักงาน · ตั้งค่า · ใบโอนสินค้าระหว่างสาขา</Text>
          <Text style={s.hint}>• ก่อนกู้คืน ระบบสำรองข้อมูลปัจจุบันทั้งร้านไว้ให้อัตโนมัติ · เลขที่บิล/เอกสารรันต่อจากเลขที่เคยออกแล้ว (ไม่ซ้ำ)</Text>
        </View>
      </Card>
    );
  }

  // ---- ไฟล์พร้อม: เลือกสาขา
  const p = phase.p;
  const chosen = p.branches.filter((b) => pick.includes(b.id));
  const lost = chosen.reduce((a, b) => a + b.lostBills, 0);
  const ready = p.sameShop && chosen.length > 0 && /^\d{6}$/.test(pin);
  const toggle = (id: number) => { setConfirm(false); setPick((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])); };

  return (
    <Card title="กู้คืนข้อมูล">
      <View style={st.fileHead}>
        <Icon name="document-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.optTitle} numberOfLines={1}>{phase.name}</Text>
          <Text style={s.hint}>
            {p.shop ? `${p.shop} · ` : ''}สำรองเมื่อ {isoLocal(p.createdAt)} · {p.scope === 'all' ? 'ไฟล์ทั้งร้าน' : `ไฟล์เฉพาะสาขา ${p.branches.find((b) => b.id === p.scope)?.name ?? ''}`}
          </Text>
        </View>
        <Pressable style={s.smallBtn} onPress={reset}><Text style={s.smallBtnText}>เลือกไฟล์อื่น</Text></Pressable>
      </View>

      {!p.sameShop ? (
        <View style={[st.box, st.bad]}>
          <Icon name="alert-circle" size={20} color={colors.danger} />
          <Text style={[s.p, { flex: 1, color: colors.danger }]}>ไฟล์นี้เป็นข้อมูลของร้านอื่น — กู้คืนได้เฉพาะไฟล์สำรองของร้านนี้</Text>
        </View>
      ) : null}

      <Text style={s.label}>เลือกสาขาที่จะกู้คืน</Text>
      {p.branches.map((b) => {
        const can = p.sameShop && b.hasData && !!b.current;
        const on = pick.includes(b.id);
        return (
          <Pressable key={b.id} disabled={!can} onPress={() => toggle(b.id)} style={[st.br, on && st.brOn, !can && { opacity: 0.5 }]} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !can }}>
            <View style={[st.check, on && st.checkOn]}>{on ? <Icon name="checkmark" size={14} color="#fff" /> : null}</View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={s.optTitle}>{b.name}{b.isMain ? '  (สาขาหลัก)' : ''}</Text>
              {!b.hasData ? (
                <Text style={s.hint}>ไม่มีข้อมูลสาขานี้ในไฟล์</Text>
              ) : !b.current ? (
                <Text style={s.hint}>ไม่มีสาขานี้ในระบบตอนนี้ — สร้างสาขาก่อน</Text>
              ) : (
                <>
                  <View style={st.cmp}>
                    <Text style={st.cmpText}><Text style={st.cmpK}>ในไฟล์ </Text>{n(b.bills)} บิล · ล่าสุด {when(b.lastBillAt)}</Text>
                    <Text style={st.cmpText}><Text style={st.cmpK}>ตอนนี้ </Text>{n(b.current.bills)} บิล · ล่าสุด {when(b.current.lastBillAt)}</Text>
                  </View>
                  {b.lostBills > 0 ? <Warn text={`บิล ${n(b.lostBills)} บิลที่ขายหลังวันที่สำรองจะหายไป`} /> : null}
                  {b.shipmentsAfter > 0 ? <Warn text={`มีใบโอนสินค้า ${n(b.shipmentsAfter)} ใบหลังวันที่สำรอง — ตรวจสต็อกหลังกู้คืน`} /> : null}
                  {b.current.openShift ? <Warn text="สาขานี้มีกะเปิดอยู่ — กะจะกลับเป็นสถานะในไฟล์" /> : null}
                </>
              )}
            </View>
          </Pressable>
        );
      })}

      {p.sameShop ? (
        <View style={st.foot}>
          <View style={{ gap: 6 }}>
            <Text style={s.label}>PIN ผู้จัดการ</Text>
            <TextInput
              value={pin}
              onChangeText={(t: string) => { setPin(t.replace(/\D/g, '').slice(0, 6)); setConfirm(false); }}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              placeholder="••••••"
              placeholderTextColor={colors.faint}
              style={st.pin}
              accessibilityLabel="PIN ผู้จัดการยืนยันการกู้คืน"
            />
          </View>
          <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
            {confirm ? (
              <Text style={[s.p, { color: colors.danger }]}>
                ข้อมูลปัจจุบันของ {chosen.map((b) => b.name).join(', ')} จะถูกแทนที่ด้วยข้อมูลในไฟล์{lost ? ` (บิล ${n(lost)} บิลจะหายไป)` : ''} — ยืนยัน?
              </Text>
            ) : null}
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {confirm ? (
                <Pressable style={st.ghost} onPress={() => setConfirm(false)} disabled={busy}><Text style={s.smallBtnText}>ยกเลิก</Text></Pressable>
              ) : null}
              <Pressable
                style={[st.danger, (!ready || busy) && { opacity: 0.45 }]}
                disabled={!ready || busy}
                onPress={() => (confirm ? restore() : setConfirm(true))}
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Icon name="refresh-outline" size={16} color="#fff" />
                    <Text style={st.dangerText}>{confirm ? 'ยืนยันกู้คืน' : `กู้คืน ${chosen.length || ''} สาขา`}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {error ? <Text style={st.err}>{error}</Text> : null}
    </Card>
  );
}

function Warn({ text }: { text: string }) {
  return (
    <View style={[s.row, { gap: 6, alignItems: 'flex-start' }]}>
      <Icon name="warning-outline" size={14} color="#B26A00" />
      <Text style={st.warn}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  dlRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  dlIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#C9D6F5', borderRadius: radius.lg, paddingVertical: 28, paddingHorizontal: 16, alignItems: 'center', gap: 8, backgroundColor: '#F8FAFF' },
  dropOver: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dropIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  dropTitle: { fontFamily: font, fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
  err: { fontFamily: font, fontSize: 13, color: colors.danger },
  fileHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface },
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: radius.md },
  ok: { backgroundColor: colors.successSoft },
  bad: { backgroundColor: colors.dangerSoft },
  br: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  brOn: { borderColor: colors.primary, backgroundColor: '#F8FAFF' },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  cmp: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 2 },
  cmpText: { fontFamily: font, fontSize: 12.5, color: colors.text },
  cmpK: { color: colors.sub },
  warn: { fontFamily: font, fontSize: 12, color: '#B26A00', flex: 1 },
  foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  pin: { fontFamily: font, fontSize: 20, letterSpacing: 8, textAlign: 'center', width: 170, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.text, backgroundColor: '#fff' },
  ghost: { height: 42, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  danger: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.danger },
  dangerText: { fontFamily: font, fontSize: 14, fontWeight: '600', color: '#fff' },
});
