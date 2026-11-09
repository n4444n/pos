// ตั้งค่า → สำรอง & กู้คืนข้อมูล → "สำรองอัตโนมัติลงเครื่องนี้" (แอปเดสก์ท็อป .exe เท่านั้น — ไฟล์อยู่ในคอมของร้าน)
//   ตั้งค่าแยกแต่ละเครื่อง: เปิด/ปิด · ทุกกี่นาที · ทั้งร้านหรือแยกไฟล์รายสาขา · โฟลเดอร์ในเครื่องนี้ · ตอนปิดกะ/ปิดโปรแกรม
//   เปิดครั้งแรก → ขอกุญแจของเครื่องจากเซิร์ฟเวอร์ (แอปใช้สำรองได้แม้ยังไม่มีใครเข้าสู่ระบบ) · ยกเลิกสิทธิ์ได้ในรายการเครื่อง
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type BackupDevice, type Branch } from '../api';
import { desktop, type AutoBackupConfig, type AutoBackupState, type BackupFileInfo } from '../desktop';
import { Icon } from '../components/Icon';
import { thaiDateTime } from '../format';
import { colors, font, radius } from '../theme';
import { Card, Field, NumStep, Seg, SmallBtn, Toggle, s, type Notify } from './ui';

const p2 = (n: number) => String(n).padStart(2, '0');
/** ms / ISO → '11/10/2569 · 14:05' */
const at = (v: number | string | null | undefined) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return thaiDateTime(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`);
};
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const REASON: Record<string, string> = { schedule: 'ตามรอบเวลา', manual: 'สำรองเอง', shift: 'ปิดกะ', close: 'ปิดโปรแกรม' };

export function AutoBackupCard({ notify, onRestoreFile }: { notify: Notify; onRestoreFile: (f: File) => void }) {
  const bridge = useMemo(() => desktop()?.backup, []);
  const inApp = useMemo(() => !!desktop(), []);
  const [st8, setSt8] = useState<AutoBackupState | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [devices, setDevices] = useState<BackupDevice[]>([]);
  const [files, setFiles] = useState<BackupFileInfo[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const loadFiles = useCallback(() => {
    bridge?.files().then(setFiles).catch(() => setFiles([]));
  }, [bridge]);
  const loadDevices = useCallback(() => {
    api.backupDevices().then(setDevices).catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    api.branches().then((r) => setBranches(r.list)).catch(() => setBranches([]));
    loadDevices();
    if (!bridge) return;
    bridge.get().then(setSt8).catch(() => {});
    loadFiles();
    return bridge.onStatus((x) => {
      setSt8(x);
      if (!x.running) loadFiles();
    });
  }, [bridge, loadFiles, loadDevices]);

  // ---- ไม่ได้เปิดในโปรแกรม / โปรแกรมรุ่นเก่า
  if (!bridge) {
    return (
      <Card title="สำรองอัตโนมัติลงคอมของร้าน">
        <View style={s.infoBox}>
          <Text style={s.p}>
            {inApp
              ? 'โปรแกรมเครื่องนี้ยังเป็นรุ่นเก่า — กดปุ่ม "อัปเดต" ที่หน้าขาย (หรือเมนู ตรวจสอบอัปเดต) แล้วเปิดหน้านี้ใหม่'
              : 'ใช้ได้ในโปรแกรม Clothing POS (.exe) เท่านั้น — ไฟล์สำรองถูกบันทึกลงคอมเครื่องที่ตั้งค่า'}
          </Text>
          <Text style={s.hint}>เปิดหน้านี้จากโปรแกรมบนคอมที่ต้องการเก็บไฟล์ แล้วเปิด "สำรองอัตโนมัติ" · ตั้งค่าแยกได้ทีละเครื่อง</Text>
        </View>
        <DeviceList devices={devices} thisId={0} onChanged={loadDevices} notify={notify} />
      </Card>
    );
  }
  if (!st8) return <Card title="สำรองอัตโนมัติลงเครื่องนี้"><ActivityIndicator color={colors.primary} /></Card>;

  const c = st8.config;
  const save = async (v: Partial<AutoBackupConfig>) => {
    setErr('');
    try {
      const r = await bridge.save(v);
      if (r) setSt8(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  /** เปิดสำรองอัตโนมัติ: ยังไม่มีกุญแจ (หรือกุญแจเป็นของร้านอื่น) → ขอจากเซิร์ฟเวอร์ก่อน */
  const turnOn = async (on: boolean) => {
    if (!on) return save({ enabled: false });
    setBusy('on');
    setErr('');
    try {
      if (!st8.hasKey || st8.keyForOtherShop) {
        const dev = await api.createBackupDevice(st8.machineName || 'คอมพิวเตอร์');
        if (!(await bridge.setKey(dev))) throw new Error('บันทึกสิทธิ์ลงเครื่องนี้ไม่สำเร็จ');
        loadDevices();
      }
      await save({ enabled: true, folder: c.folder || st8.defaultFolder });
      notify('success', 'เปิดสำรองอัตโนมัติแล้ว — กำลังสำรองครั้งแรก');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      const r = await bridge.runNow();
      if (r.ok) notify('success', r.files.length ? `สำรองแล้ว ${r.files.length} ไฟล์` : 'ข้อมูลไม่เปลี่ยน — ไม่ต้องสำรองซ้ำ');
      else notify('error', r.error);
      loadFiles();
    } finally {
      setBusy('');
    }
  };
  const chooseFolder = async () => {
    const r = await bridge.chooseFolder();
    if (!r) return;
    if (!r.ok) return setErr(r.error || 'ใช้โฟลเดอร์นี้ไม่ได้');
    await save({ folder: r.folder });
    loadFiles();
  };
  const openFolder = async () => {
    const r = await bridge.openFolder();
    if (!r.ok) setErr(r.error || 'เปิดโฟลเดอร์ไม่ได้');
  };
  const restoreFrom = async (f: BackupFileInfo) => {
    setBusy(`r:${f.name}`);
    try {
      const bytes = await bridge.read(f.name);
      if (!bytes) throw new Error('อ่านไฟล์ไม่ได้');
      onRestoreFile(new File([bytes as unknown as BlobPart], f.name, { type: 'application/octet-stream' }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const toggleBranch = (id: number) => save({ branchIds: c.branchIds.includes(id) ? c.branchIds.filter((x) => x !== id) : [...c.branchIds, id] });

  const last = st8.last;
  const on = c.enabled;
  return (
    <>
      <Card title="สำรองอัตโนมัติลงเครื่องนี้">
        <Toggle
          label="สำรองอัตโนมัติ"
          hint={`เครื่องนี้: ${st8.machineName || '—'} · ตั้งค่านี้ใช้เฉพาะเครื่องนี้ (เครื่องอื่นตั้งแยกได้)`}
          value={on}
          onChange={(v) => { if (!busy) turnOn(v); }}
        />
        {busy === 'on' ? <ActivityIndicator color={colors.primary} /> : null}
        {st8.keyForOtherShop ? <Text style={st.warn}>สิทธิ์สำรองเดิมเป็นของร้านอื่น (เปลี่ยน license) — ปิดแล้วเปิดสวิตช์ใหม่</Text> : null}

        <TwoCol
          left={
            <>
              {/* สถานะ */}
              <View style={[st.status, last.ok === false ? st.bad : last.ok ? st.ok : null]}>
                <Icon
                  name={st8.running ? 'sync-outline' : last.ok === false ? 'alert-circle' : last.ok ? 'checkmark-circle' : 'time-outline'}
                  size={20}
                  color={last.ok === false ? colors.danger : last.ok ? colors.success : colors.sub}
                />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={s.optTitle}>
                      {st8.running ? 'กำลังสำรอง…' : last.at ? `สำรองล่าสุด ${at(last.at)}${last.reason ? ` · ${REASON[last.reason] ?? last.reason}` : ''}` : 'ยังไม่เคยสำรอง'}
                    </Text>
                    {last.ok === false ? <Text style={[s.hint, { color: colors.danger }]}>{last.error}</Text> : null}
                    {last.ok && last.skipped ? <Text style={s.hint}>ข้อมูลไม่เปลี่ยนจากรอบก่อน — ไม่สร้างไฟล์ซ้ำ</Text> : null}
                    {last.ok && last.files.length ? <Text style={s.hint} numberOfLines={2}>{last.files.map((f) => `${f.name} (${size(f.size)})`).join(' · ')}</Text> : null}
                    {on && st8.nextAt ? <Text style={s.hint}>รอบถัดไป {at(st8.nextAt)}</Text> : null}
                  </View>
                </View>
                <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
                  <SmallBtn label="สำรองตอนนี้" icon="save-outline" busy={busy === 'run' || st8.running} disabled={!st8.hasKey || st8.keyForOtherShop} onPress={runNow} />
                  <SmallBtn label="เปิดโฟลเดอร์" icon="folder-open-outline" onPress={openFolder} />
                </View>
                {err ? <Text style={st.err}>{err}</Text> : null}

                <Field label="สำรองทุก" hint="ระหว่างเปิดโปรแกรมอยู่ (5–1,440 นาที)">
                  <View style={[s.row, { flexWrap: 'wrap', gap: 10 }]}>
                    <Seg value={c.intervalMin} options={[[15, '15 นาที'], [30, '30 นาที'], [60, '1 ชม.'], [120, '2 ชม.'], [240, '4 ชม.']]} onChange={(v) => save({ intervalMin: Number(v) })} />
                    <NumStep value={c.intervalMin} min={5} max={1440} step={5} onChange={(v) => save({ intervalMin: v })} />
                    <Text style={s.hint}>นาที</Text>
                  </View>
                </Field>

                <Field label="สำรองอะไร" hint="ไฟล์ .db แต่ละไฟล์มีสินค้า พนักงาน ตั้งค่า + ข้อมูลของสาขานั้น — กู้คืนได้ในหน้านี้">
                  <Seg value={c.scope} options={[['all', 'ทั้งร้าน (ไฟล์เดียว)'], ['branches', 'แยกไฟล์รายสาขา']]} onChange={(v) => save({ scope: v as 'all' | 'branches' })} />
                  {c.scope === 'branches' ? (
                    <View style={{ gap: 6, marginTop: 8 }}>
                      {branches.map((b) => {
                        const sel = c.branchIds.includes(b.id);
                        return (
                          <Pressable key={b.id} onPress={() => toggleBranch(b.id)} style={[st.br, sel && st.brOn]} accessibilityRole="checkbox" accessibilityState={{ checked: sel }}>
                            <View style={[st.check, sel && st.checkOn]}>{sel ? <Icon name="checkmark" size={14} color="#fff" /> : null}</View>
                            <Text style={s.optTitle}>{b.code ? `${b.code} · ` : ''}{b.name}{b.isMain ? '  (สาขาหลัก)' : ''}</Text>
                          </Pressable>
                        );
                      })}
                      {!c.branchIds.length ? <Text style={st.warn}>ยังไม่ได้เลือกสาขา — เลือกอย่างน้อย 1 สาขา</Text> : null}
                    </View>
                  ) : null}
                </Field>

                <Field label="เก็บไฟล์ที่" hint="ต้องเป็นโฟลเดอร์ในคอมเครื่องนี้ เช่น D:\สำรองร้าน หรือแฟลชไดรฟ์ (ไม่รับโฟลเดอร์ในเครือข่าย)">
                  <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
                    <Text style={st.path} numberOfLines={2}>{st8.folder}</Text>
                    <SmallBtn label="เลือกโฟลเดอร์" icon="folder-outline" onPress={chooseFolder} />
                  </View>
                </Field>
            </>
          }
          right={
            <>
                <Toggle label="สำรองเมื่อปิดกะ" hint="ปิดกะในเครื่องนี้แล้วสำรองทันที" value={c.onShiftClose} onChange={(v) => save({ onShiftClose: v })} />
                <Toggle label="สำรองเมื่อปิดโปรแกรม" hint="สำรองก่อนปิด (รอไม่เกิน 30 วินาที)" value={c.onAppClose} onChange={(v) => save({ onAppClose: v })} />
                <Toggle label="ข้ามรอบที่ข้อมูลไม่เปลี่ยน" hint="ไม่สร้างไฟล์ซ้ำถ้าไม่มีการขาย/แก้ไขตั้งแต่รอบก่อน (กด สำรองตอนนี้ สร้างไฟล์เสมอ)" value={c.skipUnchanged} onChange={(v) => save({ skipUnchanged: v })} />
                <Field label="ลบไฟล์เก่า" hint="ลบเฉพาะไฟล์ที่ระบบนี้สร้าง ไม่แตะไฟล์อื่นในโฟลเดอร์">
                  <Seg value={c.keepDays} options={[[0, 'เก็บทั้งหมด'], [30, 'เก็บ 30 วัน'], [90, 'เก็บ 90 วัน'], [365, 'เก็บ 1 ปี']]} onChange={(v) => save({ keepDays: Number(v) })} />
                </Field>

                <Text style={s.label}>ไฟล์ในโฟลเดอร์ {files.length ? `(${files.length})` : ''}</Text>
                {files.length ? (
                  files.slice(0, 12).map((f) => (
                    <View key={f.name} style={st.file}>
                      <Icon name="document-outline" size={16} color={colors.primary} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.optTitle} numberOfLines={1}>{f.name}</Text>
                        <Text style={s.hint}>{at(f.mtime)} · {size(f.size)}</Text>
                      </View>
                      <SmallBtn label="กู้คืน…" icon="refresh-outline" busy={busy === `r:${f.name}`} onPress={() => restoreFrom(f)} />
                    </View>
                  ))
                ) : (
                  <Text style={s.hint}>ยังไม่มีไฟล์</Text>
                )}
            </>
          }
        />
      </Card>
      <DeviceList devices={devices} thisId={st8.hasKey ? c.deviceId : 0} onChanged={() => { loadDevices(); bridge.get().then(setSt8).catch(() => {}); }} notify={notify} onRevokeThis={() => bridge.clearKey()} />
    </>
  );
}

/** 2 คอลัมน์เมื่อพื้นที่กว้างพอ (วัดความกว้างจริง) · จอแคบเรียงเป็นคอลัมน์เดียว */
export function TwoCol({ left, right, min = 720, gap = 20 }: { left: ReactNode; right: ReactNode; min?: number; gap?: number }) {
  const [w, setW] = useState(0);
  const wide = w >= min;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'flex-start', gap }}>
      <View style={[st.col, wide ? { flex: 1 } : { alignSelf: 'stretch' }]}>{left}</View>
      <View style={[st.col, wide ? { flex: 1 } : { alignSelf: 'stretch' }]}>{right}</View>
    </View>
  );
}

/** เครื่องที่เปิดสำรองอัตโนมัติไว้ (จากเซิร์ฟเวอร์) */
function DeviceList({ devices, thisId, onChanged, notify, onRevokeThis }: {
  devices: BackupDevice[]; thisId: number; onChanged: () => void; notify: Notify; onRevokeThis?: () => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(0);
  if (!devices.length) return null;
  const revoke = async (d: BackupDevice) => {
    if (confirm !== d.id) return setConfirm(d.id);
    setConfirm(0);
    try {
      await api.revokeBackupDevice(d.id);
      if (d.id === thisId) await onRevokeThis?.();
      notify('success', `ยกเลิกสิทธิ์สำรองอัตโนมัติของ ${d.name} แล้ว`);
      onChanged();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };
  return (
    <Card title="เครื่องที่สำรองอัตโนมัติ">
      <Text style={s.sub}>คอมที่ได้รับสิทธิ์ดาวน์โหลดไฟล์สำรองอัตโนมัติ — ยกเลิกเมื่อเลิกใช้เครื่องนั้น</Text>
      {devices.map((d) => (
        <View key={d.id} style={st.file}>
          <Icon name="desktop-outline" size={16} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.optTitle} numberOfLines={1}>{d.name}{d.id === thisId ? '  (เครื่องนี้)' : ''}</Text>
            <Text style={s.hint}>เปิดโดย {d.createdBy || '—'} · {thaiDateTime(d.createdAt)} · ใช้ล่าสุด {d.lastUsedAt ? thaiDateTime(d.lastUsedAt) : 'ยังไม่เคย'}</Text>
          </View>
          <Pressable style={[st.revoke, confirm === d.id && st.revokeOn]} onPress={() => revoke(d)} accessibilityLabel={`ยกเลิกสิทธิ์ ${d.name}`}>
            <Text style={[st.revokeText, confirm === d.id && { color: '#fff' }]}>{confirm === d.id ? 'ยืนยันยกเลิก' : 'ยกเลิกสิทธิ์'}</Text>
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

const st = StyleSheet.create({
  col: { gap: 12, minWidth: 0 },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  ok: { backgroundColor: colors.successSoft },
  bad: { backgroundColor: colors.dangerSoft },
  err: { fontFamily: font, fontSize: 13, color: colors.danger },
  warn: { fontFamily: font, fontSize: 12.5, color: '#B26A00' },
  path: { flex: 1, minWidth: 200, fontFamily: font, fontSize: 13, color: colors.text, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  br: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  brOn: { borderColor: colors.primary, backgroundColor: '#F8FAFF' },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  revoke: { paddingHorizontal: 12, height: 34, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  revokeOn: { backgroundColor: colors.danger },
  revokeText: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.danger },
});
