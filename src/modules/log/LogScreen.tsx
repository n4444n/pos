// LOG (บันทึกการใช้งาน): ทุกการกระทำในโปรแกรม — ใคร ทำอะไร ที่สาขาไหน เมื่อไร สำเร็จหรือไม่
// เห็นได้เฉพาะผู้ดูแลระบบ (เมนูไม่แสดงให้บทบาทอื่น และเซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type LogList, type LogRow } from '../../shared/api';
import { Icon } from '../../shared/ui/Icon';
import type { Route } from '../../shared/ui/NavMenu';
import { DataTable, ExcelButton, k, Pager, PeriodControl, ReportPage, usePeriod, type Column } from '../../shared/ui/ReportKit';
import { Select } from '../../shared/ui/Select';
import { Sheet } from '../../shared/ui/Sheet';
import { useT } from '../../i18n';
import { n0 } from '../../shared/lib/format';
import { colors, font, radius } from '../../shared/lib/theme';

const ALL_STAFF = 'ผู้ใช้ทั้งหมด';
const ALL_BRANCH = 'ทุกสาขา';

export function LogScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { t } = useT();
  const p = usePeriod('today');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<'' | 'ok' | 'fail'>('');
  const [staff, setStaff] = useState('');
  const [branch, setBranch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LogList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LogRow | null>(null);

  useEffect(() => {
    const tm = setTimeout(() => setQ(query.trim()), 350);
    return () => clearTimeout(tm);
  }, [query]);
  useEffect(() => {
    setPage(1);
  }, [p.range.from, p.range.to, q, result, staff, branch]);

  const filter = { ...p.range, q: q || undefined, result, staff: staff || undefined, branch: branch || undefined };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.logs({ ...filter, page, limit: 50 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [p.range.from, p.range.to, q, result, staff, branch, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const roleText = (r: string | null) => (r === 'api' ? 'API key' : r ? t(`role.${r}`) : '-');
  const cols: Column<LogRow>[] = [
    { id: 'at', label: 'วันเวลา', width: 150, render: (r) => <Text style={k.tdText} numberOfLines={1}>{dateTime(r.at)}</Text> },
    {
      id: 'who', label: 'ผู้ใช้', width: 170,
      render: (r) => (
        <View style={{ minWidth: 0 }}>
          <Text style={[k.tdText, { fontWeight: '600' }, !r.staffName && { color: colors.faint }]} numberOfLines={1}>{r.staffName ?? 'ไม่ทราบ (ยังไม่เข้าระบบ)'}</Text>
          <Text style={s.sub} numberOfLines={1}>{roleText(r.role)}</Text>
        </View>
      ),
    },
    { id: 'branch', label: 'สาขา', width: 130, render: (r) => <Text style={[k.tdText, !r.branchName && { color: colors.faint }]} numberOfLines={1}>{r.branchName ?? '-'}</Text> },
    { id: 'action', label: 'การกระทำ', width: 240, render: (r) => <Text style={[k.tdText, { fontWeight: '600' }]} numberOfLines={1}>{r.action}</Text> },
    { id: 'ref', label: 'เลขที่ / ชื่อ', width: 180, render: (r) => <Text style={[k.tdText, !r.ref && { color: colors.faint }]} numberOfLines={1}>{r.ref ?? '-'}</Text> },
    {
      id: 'result', label: 'ผล', width: 120, align: 'center',
      render: (r) => (
        <View style={[s.chip, r.status < 400 ? s.chipOk : s.chipFail]}>
          <Icon name={r.status < 400 ? 'checkmark-circle' : 'close-circle'} size={13} color={r.status < 400 ? colors.success : colors.danger} />
          <Text style={[s.chipText, { color: r.status < 400 ? colors.success : colors.danger }]}>{r.status < 400 ? 'สำเร็จ' : 'ไม่สำเร็จ'}</Text>
        </View>
      ),
    },
    { id: 'ip', label: 'IP', width: 120, render: (r) => <Text style={[k.tdText, { color: colors.sub }]} numberOfLines={1}>{r.ip ?? '-'}</Text> },
  ];

  const staffOpts = [ALL_STAFF, ...(data?.staff ?? []).map((x) => x.name), 'API key'];
  const staffName = staff === 'api' ? 'API key' : data?.staff.find((x) => String(x.id) === staff)?.name ?? ALL_STAFF;
  const branchOpts = [ALL_BRANCH, ...(data?.branches ?? []).map((x) => x.name)];
  const branchName = data?.branches.find((x) => String(x.id) === branch)?.name ?? ALL_BRANCH;

  return (
    <ReportPage
      route="logs"
      title="LOG"
      sub="บันทึกการใช้งานทุกการกระทำในโปรแกรม — เห็นได้เฉพาะผู้ดูแลระบบ"
      onNavigate={onNavigate}
      right={<ExcelButton url={() => api.logsXlsxUrl(filter)} disabled={!data} />}
    >
      <View style={k.toolbar}>
        <PeriodControl p={p} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="ค้นหา การกระทำ / เลขที่ / ผู้ใช้ / รายละเอียด"
          placeholderTextColor={colors.faint}
          style={k.search}
          accessibilityLabel="ค้นหา LOG"
        />
        <Pressable style={k.pill} onPress={load} accessibilityLabel="โหลดใหม่">
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="refresh" size={16} color={colors.primary} />}
        </Pressable>
      </View>
      <View style={k.toolbar}>
        <View style={k.seg}>
          {([['', 'ทั้งหมด'], ['ok', 'สำเร็จ'], ['fail', 'ไม่สำเร็จ']] as const).map(([id, label]) => (
            <Pressable key={id || 'all'} style={[k.segBtn, result === id && k.segOn]} onPress={() => setResult(id)} accessibilityRole="button">
              <Text style={[k.segText, result === id && { color: '#fff', fontWeight: '600' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ width: 200 }}>
          <Select
            placeholder="ผู้ใช้"
            icon="person-outline"
            value={staffName}
            options={staffOpts}
            onChange={(v) => setStaff(v === 'API key' ? 'api' : String(data?.staff.find((x) => x.name === v)?.id ?? ''))}
          />
        </View>
        {(data?.branches.length ?? 0) > 1 ? (
          <View style={{ width: 180 }}>
            <Select
              placeholder="สาขา"
              icon="storefront-outline"
              value={branchName}
              options={branchOpts}
              onChange={(v) => setBranch(String(data?.branches.find((x) => x.name === v)?.id ?? ''))}
            />
          </View>
        ) : null}
      </View>
      {error ? <Text style={k.error}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        <Pager
          page={data?.page ?? 1}
          pages={data?.pages ?? 1}
          onPage={setPage}
          info={data ? (data.failed ? `ทั้งหมด ${n0(data.total)} รายการ · ไม่สำเร็จ ${n0(data.failed)}` : `ทั้งหมด ${n0(data.total)} รายการ`) : ''}
        />
        <View style={{ opacity: loading ? 0.55 : 1 }}>
          <DataTable
            cols={cols}
            rows={data?.rows ?? []}
            keyOf={(r) => String(r.id)}
            empty={loading ? 'กำลังโหลด…' : 'ไม่มีรายการในช่วงนี้'}
            onRowPress={(r) => setOpen(r)}
            rowHint={(r) => `ดูรายละเอียด ${r.action}`}
          />
        </View>
        <Text style={k.note}>
          บันทึกอัตโนมัติทุกครั้งที่มีการเพิ่ม / แก้ไข / ลบข้อมูล เข้า-ออกระบบ และดาวน์โหลดไฟล์ · ไม่เก็บ PIN รหัสผ่าน และรหัสลับ · เก็บย้อนหลัง 365 วัน · กดแถวเพื่อดูรายละเอียด
        </Text>
      </ScrollView>

      <DetailSheet row={open} onClose={() => setOpen(null)} roleText={roleText} />
    </ReportPage>
  );
}

/** รายละเอียด 1 รายการ: ข้อมูลที่ส่งมา (ตัดข้อมูลลับแล้ว) · ข้อความผิดพลาด */
function DetailSheet({ row, onClose, roleText }: { row: LogRow | null; onClose: () => void; roleText: (r: string | null) => string }) {
  let pretty = '';
  let errText = '';
  if (row?.detail) {
    try {
      const d = JSON.parse(row.detail) as { data?: unknown; query?: string; error?: string };
      errText = d.error ?? '';
      const rest: Record<string, unknown> = {};
      if (d.data !== undefined) rest.data = d.data;
      if (d.query) rest.query = d.query;
      pretty = Object.keys(rest).length ? JSON.stringify(rest.data ?? rest, null, 2) + (d.query && rest.data !== undefined ? `\n\nquery: ${d.query}` : '') : '';
    } catch {
      pretty = row.detail;
    }
  }
  return (
    <Sheet visible={!!row} onClose={onClose} title={row ? row.action : 'รายละเอียด'} width={620}>
      {row ? (
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <View style={s.info}>
            <Info icon="time-outline" label="วันเวลา" value={dateTime(row.at, true)} />
            <Info icon="person-outline" label="ผู้ใช้" value={`${row.staffName ?? 'ไม่ทราบ'} · ${roleText(row.role)}`} />
            <Info icon="storefront-outline" label="สาขา" value={row.branchName ?? '-'} />
            <Info icon="document-text-outline" label="เลขที่ / ชื่อ" value={row.ref ?? '-'} />
            <Info icon={row.status < 400 ? 'checkmark-circle-outline' : 'close-circle-outline'} label="ผล" value={row.status < 400 ? `สำเร็จ (${row.status})` : `ไม่สำเร็จ (${row.status})`} />
            <Info icon="globe-outline" label="IP" value={row.ip ?? '-'} />
          </View>
          {errText ? <Text style={k.error}>{errText}</Text> : null}
          {pretty ? (
            <View style={{ gap: 6 }}>
              <Text style={s.label}>ข้อมูลที่ส่ง (ซ่อน PIN / รหัสลับแล้ว)</Text>
              <ScrollView style={s.code} contentContainerStyle={{ padding: 12 }}>
                <Text style={s.codeText} selectable>{pretty}</Text>
              </ScrollView>
            </View>
          ) : null}
          <Text style={s.sub} selectable>{`${row.method} ${row.path}`}</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

function Info({ icon, label, value }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string }) {
  return (
    <View style={s.infoItem}>
      <Icon name={icon} size={16} color={colors.sub} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

/** 2026-11-09 10:22:46 → 9/11/2569 10:22 (sec = แสดงวินาที) */
function dateTime(v: string, sec = false) {
  const [d, tm] = v.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  return `${day}/${m}/${y + 543} ${tm?.slice(0, sec ? 8 : 5) ?? ''}`;
}

const s = StyleSheet.create({
  sub: { fontFamily: font, fontSize: 11, color: colors.sub },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  chipOk: { backgroundColor: colors.successSoft },
  chipFail: { backgroundColor: colors.dangerSoft },
  chipText: { fontFamily: font, fontSize: 12, fontWeight: '600' },
  info: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexBasis: '48%', flexGrow: 1, minWidth: 220 },
  infoLabel: { fontFamily: font, fontSize: 12, color: colors.sub, width: 78 },
  infoValue: { fontFamily: font, fontSize: 13, color: colors.text, flex: 1 },
  label: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub },
  code: { maxHeight: Platform.OS === 'web' ? ('40vh' as unknown as number) : 320, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#F8FAFC' },
  codeText: { fontFamily: Platform.OS === 'web' ? 'Consolas, monospace' : font, fontSize: 12, color: colors.text, lineHeight: 18 },
});
