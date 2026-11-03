// ค่าใช้จ่ายร้าน + สมุดเงินสดในลิ้นชัก
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import {
  api, imageSrc,
  type DrawerLedger, type Expense, type ExpenseCategory, type ExpenseInput, type ExpenseList, type ExpenseSource,
} from '../api';
import { DateField } from '../components/DateField';
import { Icon, type IconName } from '../components/Icon';
import { NavDrawer, Sidebar, toggleNavMode, type Route } from '../components/NavMenu';
import { CashMoveDialog } from '../components/shift/CashMoveDialog';
import { Sheet } from '../components/Sheet';
import { resizeToDataUrl } from '../components/stock/ImagePicker';
import { ToastView } from '../components/ToastView';
import { baht, isoDate, signedBaht, thaiDate, thaiDateTime } from '../format';
import { uiLang } from '../i18n/current';
import { can, useSession } from '../session';
import type { Toast } from '../store/usePos';
import { colors, font, radius } from '../theme';
import { downloadFile } from '../download';

const SOURCES: { id: ExpenseSource; label: string; short: string; icon: IconName }[] = [
  { id: 'drawer', label: 'เงินสดในลิ้นชัก', short: 'ลิ้นชัก', icon: 'cash-outline' },
  { id: 'transfer', label: 'โอนจากบัญชีร้าน', short: 'โอน', icon: 'swap-horizontal-outline' },
  { id: 'card', label: 'บัตรเครดิต / เดบิต', short: 'บัตร', icon: 'card-outline' },
  { id: 'owner', label: 'เงินสดนอกลิ้นชัก / เจ้าของสำรองจ่าย', short: 'นอกลิ้นชัก', icon: 'person-outline' },
];
const srcOf = (id: string) => SOURCES.find((x) => x.id === id) ?? SOURCES[0];

const today = () => isoDate(new Date());
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
};
const monthStart = (offset = 0) => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth() + offset, 1));
};
const monthEnd = (offset = 0) => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0));
};
const shortDate = (s: string) => thaiDate(new Date(`${s}T12:00:00`));

interface Props {
  onNavigate: (r: Route) => void;
  /** เงินในลิ้นชักเปลี่ยน → หน้าขาย/กะโหลดใหม่ */
  onDrawerChanged: () => void;
}

export function ExpenseScreen({ onNavigate, onDrawerChanged }: Props) {
  const { me } = useSession();
  const manager = can(me, 'expenses', 'edit'); // สิทธิ์แก้ไขตามบทบาท (ตั้งที่ พนักงาน → การจัดการสิทธิ์)
  const { width } = useWindowDimensions();
  const showSidebar = width >= 1100;
  const mobile = width < 768;
  const wide = width >= (showSidebar ? 1320 : 1060);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerNav, setDrawerNav] = useState(false);
  const [tab, setTab] = useState<'list' | 'drawer'>(() => {
    try {
      return globalThis.localStorage?.getItem('pos.expenseTab') === 'drawer' ? 'drawer' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem('pos.expenseTab', tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  const [range, setRange] = useState(() => ({ from: monthStart(), to: monthEnd() }));
  const [category, setCategory] = useState('');
  const source = ''; // ตัวกรองแหล่งเงินถูกเอาออกจากหน้าจอ (ยังส่งค่าว่างให้ API)
  const [q, setQ] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [allBranches, setAllBranches] = useState(false);
  const [data, setData] = useState<ExpenseList | null>(null);
  const [ledger, setLedger] = useState<DrawerLedger | null>(null);
  const [ledgerShift, setLedgerShift] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<null | { edit: Expense | null; source?: ExpenseSource }>(null);
  const [cats, setCats] = useState(false);
  const [view, setView] = useState<Expense | null>(null);
  const [del, setDel] = useState<Expense | null>(null);
  const [move, setMove] = useState<null | 'in' | 'out'>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);

  const filter = useMemo(
    () => ({ ...range, category, source, q: q.trim(), voided: showVoid ? '1' : '', branch: allBranches ? 'all' : '' }),
    [range, category, source, q, showVoid, allBranches],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, d] = await Promise.all([api.expenses(filter), api.drawer(ledgerShift)]);
      setData(l);
      setLedger(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, ledgerShift]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const catOf = useCallback(
    (id: string): ExpenseCategory => data?.categories.find((c) => c.id === id) ?? { id, name: id, icon: '📝', color: '#94A3B8' },
    [data],
  );
  const openShift = ledger?.shift?.status === 'open' ? ledger.shift : null;
  const sum = data?.summary;
  const drawerTotal = sum?.bySource.find((x) => x.source === 'drawer')?.total ?? 0;
  const changed = () => {
    load();
    onDrawerChanged();
  };

  return (
    <View style={[s.root, { padding: mobile ? 10 : 16 }]}>
      {showSidebar && sidebarOpen ? <Sidebar route="expenses" onNavigate={onNavigate} /> : null}
      <View style={[s.main, mobile && { padding: 10 }]}>
        {/* ---------- header ---------- */}
        <View style={s.header}>
          <View style={[s.row, { flexShrink: 1 }]}>
            <Pressable style={s.iconBtn} onPress={() => (showSidebar ? toggleNavMode() : setDrawerNav(true))} accessibilityLabel="เมนู">
              <Icon name="menu-outline" size={24} color={colors.primary} />
            </Pressable>
            <View style={{ flexShrink: 1 }}>
              <Text style={s.title}>ค่าใช้จ่าย<Text style={s.titleSub}> / เงินในลิ้นชัก</Text></Text>
              {!mobile ? <Text style={s.sub}>ลงบันทึกค่าใช้จ่ายร้านทั้งหมด · ทุกการเคลื่อนไหวของเงินสดในลิ้นชัก</Text> : null}
            </View>
          </View>
          <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
            {manager ? (
              <Pressable style={[s.actBtn, s.ghost]} onPress={() => setCats(true)} accessibilityLabel="จัดการหมวดค่าใช้จ่าย">
                <Icon name="pricetags-outline" size={17} color={colors.text} />
                {!mobile ? <Text style={s.ghostText}>หมวด</Text> : null}
              </Pressable>
            ) : null}
            {manager && Platform.OS === 'web' && tab === 'list' ? (
              <Pressable
                style={[s.actBtn, s.excelBtn]}
                onPress={() => downloadFile(api.expensesXlsxUrl(filter))}
                accessibilityLabel="ส่งออก Excel"
              >
                <Icon name="download-outline" size={17} color="#1F7A4D" />
                <Text style={s.excelText}>Excel</Text>
              </Pressable>
            ) : null}
            <Pressable style={[s.actBtn, s.primary]} onPress={() => setForm({ edit: null })} accessibilityLabel="บันทึกค่าใช้จ่าย">
              <Icon name="add" size={18} color="#fff" />
              <Text style={s.primaryText}>บันทึกค่าใช้จ่าย</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.tabs}>
          {([['list', 'ค่าใช้จ่ายร้าน', 'receipt-outline'], ['drawer', 'เงินในลิ้นชัก', 'cash-outline']] as const).map(([id, label, icon]) => {
            const on = tab === id;
            return (
              <Pressable key={id} onPress={() => setTab(id)} style={[s.tab, on && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Icon name={icon} size={16} color={on ? colors.primary : colors.sub} />
                <Text style={[s.tabText, on && { color: colors.primary, fontWeight: '700' }]}>{label}</Text>
                {id === 'drawer' && openShift ? <View style={s.liveDot} /> : null}
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {tab === 'list' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
            {/* ---------- ตัวกรอง: ค้นหา · ช่วงวันที่ · ตัวเลือก ---------- */}
            <View style={s.filters}>
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                <View style={[s.search, { height: 40 }]}>
                  <Icon name="search" size={16} color={colors.sub} />
                  <TextInput value={q} onChangeText={setQ} placeholder="ค้นหา รายการ ร้านค้า เลขที่ใบเสร็จ" placeholderTextColor={colors.faint} style={s.searchInput} />
                  {q ? (
                    <Pressable onPress={() => setQ('')} hitSlop={6} accessibilityLabel="ล้างคำค้นหา">
                      <Icon name="close-circle" size={16} color={colors.faint} />
                    </Pressable>
                  ) : null}
                </View>
                <DateField grow={mobile} type="date" label="ตั้งแต่วันที่" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} width={150} />
                <Text style={s.sub}>–</Text>
                <DateField grow={mobile} type="date" label="ถึงวันที่" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} width={150} />
                <Pressable style={[s.row, { marginLeft: 4 }]} onPress={() => setShowVoid((v) => !v)}>
                  <Icon name={showVoid ? 'checkbox' : 'square-outline'} size={18} color={showVoid ? colors.primary : colors.faint} />
                  <Text style={s.sub}>แสดงที่ยกเลิก</Text>
                </Pressable>
                {manager ? (
                  <Pressable style={s.row} onPress={() => setAllBranches((v) => !v)}>
                    <Icon name={allBranches ? 'checkbox' : 'square-outline'} size={18} color={allBranches ? colors.primary : colors.faint} />
                    <Text style={s.sub}>รวมทุกสาขา</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* ---------- สรุป ---------- */}
            {sum ? (
              <View style={[{ gap: 12 }, wide && { flexDirection: 'row', alignItems: 'stretch' }]}>
                <View style={[s.sumWrap, wide && { flex: 1 }]}>
                  <View style={[s.sumCard, { backgroundColor: '#FFF1F1', flexBasis: 220 }]}>
                    <Text style={s.statLabel}>ค่าใช้จ่ายรวม</Text>
                    <Text style={[s.bigValue, { color: colors.danger }]}>{baht(sum.total)}</Text>
                    <Text style={s.sub}>{sum.count} รายการ · {shortDate(range.from || today())} – {shortDate(range.to || today())}</Text>
                  </View>
                  <SumCard label="จ่ายจากลิ้นชัก" value={baht(drawerTotal)} icon="cash-outline" />
                  <SumCard label="จ่ายจากแหล่งอื่น" value={baht(sum.total - drawerTotal)} icon="card-outline" />
                  <SumCard label="เฉลี่ยต่อวัน" value={baht(sum.byDay.length ? sum.total / Math.max(1, daysBetween(range.from, range.to)) : 0)} icon="calendar-outline" />
                </View>
                {sum.byCategory.length ? (
                  <View style={[s.catBox, wide && { width: 420 }]}>
                    <Text style={s.boxTitle}>แยกตามหมวด</Text>
                    {sum.byCategory.slice(0, 8).map((c) => {
                      const cat = catOf(c.category);
                      const pct = sum.total ? (c.total / sum.total) * 100 : 0;
                      const on = category === c.category;
                      return (
                        <Pressable key={c.category} onPress={() => setCategory(on ? '' : c.category)} style={[s.catRow, on && { backgroundColor: colors.primarySoft }]}>
                          <Text style={{ fontSize: 15, width: 22 }}>{cat.icon}</Text>
                          <View style={{ flex: 1, gap: 3 }}>
                            <View style={[s.row, { justifyContent: 'space-between' }]}>
                              <Text style={s.catName} numberOfLines={1}>{cat.name}</Text>
                              <Text style={s.catAmt}>{baht(c.total)}</Text>
                            </View>
                            <View style={s.barBg}><View style={[s.bar, { width: `${Math.max(2, pct)}%`, backgroundColor: cat.color }]} /></View>
                          </View>
                          <Text style={[s.sub, { width: 38, textAlign: 'right' }]}>{pct.toFixed(0)}%</Text>
                        </Pressable>
                      );
                    })}
                    {category ? (
                      <Pressable onPress={() => setCategory('')}><Text style={[s.sub, { color: colors.primary }]}>แสดงทุกหมวด ×</Text></Pressable>
                    ) : <Text style={s.hint}>แตะหมวดเพื่อกรองรายการ</Text>}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* ---------- รายการ ---------- */}
            {loading && !data ? <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} /> : null}
            {data && data.rows.length === 0 ? (
              <View style={s.empty}>
                <Icon name="receipt-outline" size={34} color={colors.faint} />
                <Text style={s.emptyText}>ยังไม่มีค่าใช้จ่ายในช่วงนี้</Text>
                <Pressable style={[s.actBtn, s.primary, { marginTop: 6 }]} onPress={() => setForm({ edit: null })}>
                  <Icon name="add" size={18} color="#fff" />
                  <Text style={s.primaryText}>บันทึกค่าใช้จ่าย</Text>
                </Pressable>
              </View>
            ) : null}
            {data && data.rows.length ? (
              <ExpenseTable
                rows={data.rows}
                allBranches={allBranches}
                manager={manager}
                onView={setView}
                onEdit={(r) => setForm({ edit: r })}
                onDelete={setDel}
              />
            ) : null}
          </ScrollView>
        ) : (
          <DrawerTab
            ledger={ledger}
            loading={loading}
            wide={wide}
            mobile={mobile}
            onPickShift={setLedgerShift}
            onExpense={() => setForm({ edit: null, source: 'drawer' })}
            onMove={setMove}
          />
        )}
      </View>

      <NavDrawer visible={drawerNav} onClose={() => setDrawerNav(false)} route="expenses" onNavigate={onNavigate} />
      {form && data ? (
        <ExpenseForm
          edit={form.edit}
          initialSource={form.source}
          categories={data.categories}
          manager={manager}
          openShift={openShift}
          drawerBalance={openShift && ledger?.totals ? ledger.totals.expected : null}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            notify('success', msg);
            changed();
          }}
          notify={notify}
        />
      ) : null}
      {view && data ? (
        <ExpenseView
          expense={view}
          catOf={catOf}
          manager={manager}
          onClose={() => setView(null)}
          onEdit={() => {
            setForm({ edit: view });
            setView(null);
          }}
          onDelete={() => {
            setDel(view);
            setView(null);
          }}
        />
      ) : null}
      {del ? (
        <DeleteExpense
          expense={del}
          onClose={() => setDel(null)}
          onDone={(msg) => {
            setDel(null);
            notify('success', msg);
            changed();
          }}
        />
      ) : null}
      {cats && data ? (
        <CategoryEditor
          categories={data.categories}
          onClose={() => setCats(false)}
          onSaved={(list) => {
            setCats(false);
            setData((d) => (d ? { ...d, categories: list } : d));
            notify('success', 'บันทึกหมวดค่าใช้จ่ายแล้ว');
          }}
          notify={notify}
        />
      ) : null}
      <CashMoveDialog
        visible={!!move}
        kind={move ?? 'in'}
        onClose={() => setMove(null)}
        onDone={() => {
          setMove(null);
          notify('success', 'บันทึกรายการเงินเข้า/ออกแล้ว');
          changed();
        }}
      />
      <ToastView toast={toast} onDone={() => setToast(null)} />
    </View>
  );
}

const daysBetween = (a: string, b: string) => {
  if (!a || !b) return 1;
  const ms = new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
};

/** เลขที่เอกสารค่าใช้จ่าย: EXP + ปี พ.ศ. 2 หลัก (ตามวันที่สร้าง) + เลขลำดับ 6 หลัก เช่น EXP69000143 */
export const expenseDocNo = (r: Pick<Expense, 'id' | 'createdAt' | 'date'>) => {
  const y = Number((r.createdAt || r.date).slice(0, 4)) + 543;
  return `EXP${String(y % 100).padStart(2, '0')}${String(r.id).padStart(6, '0')}`;
};
/** '2026-10-31' หรือ '2026-10-31 14:05:00' → '31/10/2569' (EN: 31/10/2026) */
const dmy = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${Number(y) + (uiLang() === 'en' ? 0 : 543)}`;
};

type SortKey = 'doc' | 'total' | 'created' | 'date' | 'qty';
// ความกว้างขั้นต่ำ (min) + สัดส่วนที่ขยายเมื่อจอกว้าง (grow) — ทุกคอลัมน์ขยายตามสัดส่วน ไม่ให้รายละเอียดกินที่ว่างทั้งหมด
type ColAlign = 'left' | 'center' | 'right';
const COLS: { key: SortKey | 'status' | 'detail' | 'action'; label: string; min: number; grow: number; align: ColAlign }[] = [
  { key: 'doc', label: 'เลขที่เอกสาร', min: 118, grow: 1.1, align: 'left' },
  { key: 'status', label: 'สถานะ', min: 84, grow: 0.8, align: 'center' },
  { key: 'total', label: 'ยอดรวม', min: 104, grow: 1, align: 'right' },
  { key: 'created', label: 'วันที่สร้าง', min: 112, grow: 0.9, align: 'center' },
  { key: 'date', label: 'วันที่จ่าย', min: 112, grow: 0.9, align: 'center' },
  { key: 'qty', label: 'จำนวน', min: 76, grow: 0.6, align: 'center' },
  { key: 'detail', label: 'รายละเอียด', min: 150, grow: 2.6, align: 'left' },
  { key: 'action', label: 'จัดการ', min: 132, grow: 0.8, align: 'center' },
];
const MIN_TABLE = COLS.reduce((t, c) => t + c.min, 0);
const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

/** ตารางค่าใช้จ่าย — เลขที่เอกสาร · สถานะ · ยอดรวม · วันที่สร้าง · วันที่จ่าย · จำนวนรายการ · รายละเอียดย่อ */
function ExpenseTable({ rows, allBranches, manager, onView, onEdit, onDelete }: {
  rows: Expense[]; allBranches: boolean; manager: boolean;
  onView: (r: Expense) => void; onEdit: (r: Expense) => void; onDelete: (r: Expense) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'doc', desc: true });
  const sorted = useMemo(() => {
    const val = (r: Expense): number | string =>
      sort.key === 'doc' ? r.id : sort.key === 'total' ? r.amount : sort.key === 'created' ? r.createdAt : sort.key === 'date' ? r.date : r.items.length || 1;
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : a.id - b.id;
      return sort.desc ? -c : c;
    });
  }, [rows, sort]);
  const total = rows.reduce((t, r) => t + (r.voidedAt ? 0 : r.amount), 0);
  const qty = rows.reduce((t, r) => t + (r.voidedAt ? 0 : r.items.length || 1), 0);
  const cell = (c: (typeof COLS)[number]) => [{ flexGrow: c.grow, flexShrink: 0, flexBasis: c.min, minWidth: c.min, alignItems: JUSTIFY[c.align] }];

  return (
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }} style={s.tableWrap}>
      <View style={{ flex: 1, minWidth: MIN_TABLE }}>
        <View style={[s.trow, s.thead]}>
          {COLS.map((c) => {
            const sortable = c.key !== 'status' && c.key !== 'detail' && c.key !== 'action';
            const on = sortable && sort.key === c.key;
            return (
              <Pressable
                key={c.key}
                disabled={!sortable}
                onPress={() => setSort((x) => ({ key: c.key as SortKey, desc: x.key === c.key ? !x.desc : true }))}
                style={[s.tcell, ...cell(c), { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: JUSTIFY[c.align] }]}
                accessibilityRole={sortable ? 'button' : undefined}
              >
                <Text style={s.th} numberOfLines={1}>{c.label}</Text>
                {sortable ? <Icon name={on ? (sort.desc ? 'arrow-down' : 'arrow-up') : 'swap-vertical'} size={12} color={on ? colors.primary : colors.faint} /> : null}
              </Pressable>
            );
          })}
        </View>
        {sorted.map((r, i) => {
          const voided = !!r.voidedAt;
          const n = r.items.length || 1;
          const detail = [r.description, r.vendor, allBranches ? r.branchName : ''].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={r.id}
              onPress={() => onView(r)}
              style={({ hovered }: { hovered?: boolean }) => [s.trow, i % 2 === 1 && { backgroundColor: '#F7F9FC' }, hovered && { backgroundColor: '#EEF3FF' }]}
              accessibilityLabel={`ค่าใช้จ่าย ${expenseDocNo(r)}`}
            >
              <View style={[s.tcell, ...cell(COLS[0])]}>
                <Text style={[s.td, s.docNo, voided && s.strike]}>{expenseDocNo(r)}</Text>
              </View>
              <View style={[s.tcell, ...cell(COLS[1]), { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }]}>
                <Icon name={voided ? 'close-circle-outline' : 'checkbox-outline'} size={14} color={voided ? colors.danger : colors.text} />
                <Text style={[s.td, voided && { color: colors.danger }]}>{voided ? 'ยกเลิก' : 'สำเร็จ'}</Text>
              </View>
              <View style={[s.tcell, ...cell(COLS[2])]}>
                <Text style={[s.td, s.money, voided && s.strike]}>{baht(r.amount)}</Text>
              </View>
              <View style={[s.tcell, ...cell(COLS[3]), { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }]}>
                <Icon name="calendar-outline" size={13} color={colors.sub} />
                <Text style={s.td}>{dmy(r.createdAt || r.date)}</Text>
              </View>
              <View style={[s.tcell, ...cell(COLS[4]), { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }]}>
                <Icon name="calendar-outline" size={13} color={colors.sub} />
                <Text style={s.td}>{dmy(r.date)}</Text>
              </View>
              <View style={[s.tcell, ...cell(COLS[5])]}>
                <Text style={s.td}>{n}</Text>
              </View>
              <View style={[s.tcell, ...cell(COLS[6])]}>
                <Text style={[s.td, voided && s.strike]} numberOfLines={1}>{detail || '—'}</Text>
              </View>
              <View style={[s.tcell, ...cell(COLS[7]), { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 6 }]}>
                <RowBtn icon="eye-outline" label="ดู" tone="view" onPress={() => onView(r)} />
                <RowBtn icon="grid-outline" label="แก้ไข" tone="edit" disabled={!manager || voided} onPress={() => onEdit(r)} />
                <RowBtn icon="trash-outline" label="ลบ" tone="del" disabled={!manager || voided} onPress={() => onDelete(r)} />
              </View>
            </Pressable>
          );
        })}
        <View style={[s.trow, s.tfoot]}>
          {COLS.map((c) => (
            <View key={c.key} style={[s.tcell, ...cell(c)]}>
              {c.key === 'doc' ? <Text style={s.tfootText}>รวม (฿)</Text>
                : c.key === 'total' ? <Text style={[s.tfootText, s.money]}>{baht(total)}</Text>
                : c.key === 'qty' ? <Text style={s.tfootText}>{qty}</Text>
                : c.key === 'detail' ? <Text style={s.hint} numberOfLines={1}>ไม่รวมที่ยกเลิก · แตะแถวเพื่อดูรายการทั้งหมด</Text>
                : null}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/** ปุ่มไอคอนในคอลัมน์จัดการ — ดู (ฟ้า) · แก้ไข (เขียว) · ลบ (แดง) */
const ROW_BTN = {
  view: { fg: '#2F6BFF', bg: '#EEF3FF', line: '#D6E2FF' },
  edit: { fg: '#1F9D63', bg: '#E9F7EF', line: '#C9EBD7' },
  del: { fg: '#E5484D', bg: '#FDEDED', line: '#F8CFD0' },
} as const;
function RowBtn({ icon, label, tone, onPress, disabled }: { icon: IconName; label: string; tone: keyof typeof ROW_BTN; onPress: () => void; disabled?: boolean }) {
  const t = ROW_BTN[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={3}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(Platform.OS === 'web' ? ({ title: label } as object) : {})}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
        s.rowBtn,
        disabled ? s.rowBtnOff : { backgroundColor: t.bg, borderColor: hovered ? t.fg : t.line },
        pressed && !disabled && { transform: [{ scale: 0.94 }] },
      ]}
    >
      <Icon name={icon} size={17} color={disabled ? '#C3CAD5' : t.fg} />
    </Pressable>
  );
}

/** popup ดูค่าใช้จ่าย (อ่านอย่างเดียว) — ข้อมูลเอกสาร + รายการทั้งหมด */
function ExpenseView({ expense: e, catOf, manager, onClose, onEdit, onDelete }: {
  expense: Expense; catOf: (id: string) => ExpenseCategory; manager: boolean;
  onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const voided = !!e.voidedAt;
  const items = e.items.length
    ? e.items
    : [{ description: e.description, category: e.category, qty: 1, unit: '', unitPrice: e.amount, amount: e.amount }];
  const info: [string, string][] = [
    ['วันที่จ่าย', dmy(e.date)],
    ['วันที่สร้าง', thaiDateTime(e.createdAt)],
    ['จ่ายจาก', `${srcOf(e.source).label}${e.shiftNo ? ` · กะ #${e.shiftNo}` : ''}`],
    ['ร้านค้า / ผู้รับเงิน', e.vendor || '—'],
    ['เลขที่ใบเสร็จ / บิล', e.refNo || '—'],
    ['บันทึกโดย', e.staff || '—'],
  ];
  if (e.updatedAt && e.updatedAt !== e.createdAt) info.push(['แก้ไขล่าสุด', thaiDateTime(e.updatedAt)]);
  if (e.branchName) info.push(['สาขา', e.branchName]);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={expenseDocNo(e)}
      width={820}
      footer={
        <View style={[s.row, { flex: 1 }]}>
          {manager && !voided ? (
            <Pressable style={[s.actBtn, s.ghost]} onPress={onDelete}>
              <Icon name="trash-outline" size={16} color={colors.danger} />
              <Text style={[s.ghostText, { color: colors.danger }]}>ลบ</Text>
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }} />
          <Pressable style={[s.actBtn, s.ghost]} onPress={onClose}><Text style={s.ghostText}>ปิด</Text></Pressable>
          {manager && !voided ? (
            <Pressable style={[s.actBtn, s.primary]} onPress={onEdit}>
              <Icon name="create-outline" size={16} color="#fff" />
              <Text style={s.primaryText}>แก้ไข</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
        <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
          <View style={[s.tag, voided ? { backgroundColor: colors.dangerSoft } : { backgroundColor: '#E6F6EE' }]}>
            <Icon name={voided ? 'close-circle-outline' : 'checkmark-circle-outline'} size={13} color={voided ? colors.danger : '#1F9D63'} />
            <Text style={[s.tagText, { color: voided ? colors.danger : '#1F9D63' }]}>{voided ? 'ยกเลิก' : 'สำเร็จ'}</Text>
          </View>
          <Text style={[s.viewTotal, voided && s.strike]}>{baht(e.amount)}</Text>
        </View>
        {voided ? (
          <View style={[s.notice, { backgroundColor: colors.dangerSoft }]}>
            <Text style={[s.td, { color: colors.danger }]}>ยกเลิกแล้วโดย {e.voidedBy} · {thaiDateTime(e.voidedAt!)} · {e.voidReason}</Text>
          </View>
        ) : null}

        <View style={s.infoGrid}>
          {info.map(([k, v]) => (
            <View key={k} style={s.infoItem}>
              <Text style={s.hint}>{k}</Text>
              <Text style={s.td}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={s.tableWrap}>
          <View style={[s.trow, s.thead]}>
            <View style={[s.tcell, { width: 44 }]}><Text style={s.th}>#</Text></View>
            <View style={[s.tcell, { flex: 1, minWidth: 160 }]}><Text style={s.th}>รายละเอียด</Text></View>
            <View style={[s.tcell, { width: 170 }]}><Text style={s.th}>หมวดหมู่</Text></View>
            <View style={[s.tcell, { width: 110, alignItems: 'flex-end' }]}><Text style={s.th}>จำนวน / หน่วย</Text></View>
            <View style={[s.tcell, { width: 110, alignItems: 'flex-end' }]}><Text style={s.th}>ราคา / หน่วย</Text></View>
            <View style={[s.tcell, { width: 110, alignItems: 'flex-end' }]}><Text style={s.th}>รวม</Text></View>
          </View>
          {items.map((x, i) => {
            const c = catOf(x.category);
            return (
              <View key={i} style={[s.trow, i % 2 === 1 && { backgroundColor: '#F7F9FC' }]}>
                <View style={[s.tcell, { width: 44 }]}><Text style={s.td}>{i + 1}</Text></View>
                <View style={[s.tcell, { flex: 1, minWidth: 160 }]}><Text style={s.td}>{x.description || '—'}</Text></View>
                <View style={[s.tcell, { width: 170 }]}><Text style={s.td} numberOfLines={1}>{c.icon} {c.name}</Text></View>
                <View style={[s.tcell, { width: 110, alignItems: 'flex-end' }]}><Text style={s.td}>{x.qty} {x.unit}</Text></View>
                <View style={[s.tcell, { width: 110, alignItems: 'flex-end' }]}><Text style={[s.td, s.money]}>{baht(x.unitPrice)}</Text></View>
                <View style={[s.tcell, { width: 110, alignItems: 'flex-end' }]}><Text style={[s.td, s.money]}>{baht(x.amount)}</Text></View>
              </View>
            );
          })}
          <View style={[s.trow, s.tfoot]}>
            <View style={[s.tcell, { flex: 1 }]}><Text style={s.tfootText}>รวม {items.length} รายการ</Text></View>
            <View style={[s.tcell, { width: 110, alignItems: 'flex-end' }]}><Text style={[s.tfootText, s.money]}>{baht(e.amount)}</Text></View>
          </View>
        </View>

        {e.note ? (
          <View style={{ gap: 4 }}>
            <Text style={s.label}>หมายเหตุ</Text>
            <Text style={s.td}>{e.note}</Text>
          </View>
        ) : null}
        {e.photo ? (
          <View style={{ gap: 6 }}>
            <Text style={s.label}>รูปใบเสร็จ / หลักฐาน</Text>
            <Pressable onPress={() => Platform.OS === 'web' && window.open(e.photo, '_blank')} accessibilityLabel="ดูรูปใบเสร็จ">
              <Image source={{ uri: e.photo }} style={s.viewPhoto} resizeMode="contain" />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** ยืนยันลบค่าใช้จ่าย — เป็นการยกเลิก (เก็บเอกสารไว้ในประวัติ · คืนเงินเข้าลิ้นชักให้อัตโนมัติ) */
function DeleteExpense({ expense: e, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!reason.trim()) return setError('กรุณาระบุเหตุผลที่ลบ');
    setBusy(true);
    setError(null);
    try {
      const r = await api.voidExpense(e.id, reason.trim());
      onDone(r.refunded ? `ลบ ${expenseDocNo(e)} แล้ว · คืนเงินเข้าลิ้นชักให้อัตโนมัติ` : `ลบ ${expenseDocNo(e)} แล้ว`);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title={`ลบ ${expenseDocNo(e)}?`}
      width={460}
      footer={
        <View style={[s.row, { flex: 1, justifyContent: 'flex-end' }]}>
          <Pressable style={[s.actBtn, s.ghost]} onPress={onClose}><Text style={s.ghostText}>ไม่ลบ</Text></Pressable>
          <Pressable style={[s.actBtn, { backgroundColor: colors.danger }, busy && { opacity: 0.6 }]} onPress={go} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Icon name="trash-outline" size={16} color="#fff" />
                <Text style={s.primaryText}>ยืนยันลบ</Text>
              </>
            )}
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: 10 }}>
        <Text style={s.td}>{e.description} · {baht(e.amount)}</Text>
        <Text style={s.hint}>
          รายการจะหายจากยอดค่าใช้จ่าย แต่เอกสารยังเก็บไว้ในประวัติ (ติ๊ก "แสดงที่ยกเลิก" เพื่อดู){e.source === 'drawer' ? ' · จ่ายจากลิ้นชัก: คืนเงินเข้าลิ้นชักให้อัตโนมัติ' : ''}
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="เหตุผลที่ลบ เช่น ลงซ้ำ / ลงผิด"
          placeholderTextColor={colors.faint}
          style={s.input}
          autoFocus
          onSubmitEditing={go}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}
      </View>
    </Sheet>
  );
}

function SumCard({ label, value, icon }: { label: string; value: string; icon: IconName }) {
  return (
    <View style={s.sumCard}>
      <View style={s.row}>
        <Icon name={icon} size={14} color={colors.sub} />
        <Text style={s.statLabel}>{label}</Text>
      </View>
      <Text style={s.sumValue}>{value}</Text>
    </View>
  );
}

// ======================= สมุดเงินสดในลิ้นชัก =======================
const ENTRY_STYLE: Record<string, { icon: IconName; color: string }> = {
  open: { icon: 'lock-open-outline', color: colors.primary },
  sale: { icon: 'cart-outline', color: colors.success },
  edit: { icon: 'create-outline', color: '#D98200' },
  void: { icon: 'close-circle-outline', color: colors.danger },
  cash_in: { icon: 'arrow-down-circle-outline', color: colors.success },
  cash_out: { icon: 'arrow-up-circle-outline', color: '#D98200' },
  expense: { icon: 'receipt-outline', color: colors.danger },
  expense_void: { icon: 'arrow-undo-outline', color: colors.success },
};

function DrawerTab({ ledger, loading, wide, mobile, onPickShift, onExpense, onMove }: {
  ledger: DrawerLedger | null; loading: boolean; wide: boolean; mobile: boolean;
  onPickShift: (id: number) => void; onExpense: () => void; onMove: (k: 'in' | 'out') => void;
}) {
  const [pick, setPick] = useState(false);
  const [onlyMoves, setOnlyMoves] = useState(false);
  if (!ledger) return loading ? <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} /> : null;
  const sh = ledger.shift;
  const t = ledger.totals;
  if (!sh || !t) {
    return (
      <View style={s.empty}>
        <Icon name="cash-outline" size={34} color={colors.faint} />
        <Text style={s.emptyText}>ยังไม่มีกะ — เปิดกะที่หน้า “กะการขาย” เพื่อเริ่มบันทึกเงินในลิ้นชัก</Text>
      </View>
    );
  }
  const open = sh.status === 'open';
  const entries = onlyMoves ? ledger.entries.filter((e) => e.type !== 'sale') : ledger.entries;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
      <View style={[s.shiftCard, !open && { borderColor: colors.line, backgroundColor: colors.surface }]}>
        <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
          <Pressable style={[s.row, { flexShrink: 1 }]} onPress={() => setPick(true)} accessibilityLabel="เลือกกะ">
            {open ? <View style={s.liveDot} /> : <Icon name="lock-closed-outline" size={15} color={colors.sub} />}
            <Text style={s.curTitle}>กะ #{sh.shiftNo} · {shortDate(sh.businessDate)}</Text>
            <Text style={s.sub}>{open ? 'กำลังเปิด' : 'ปิดแล้ว'} · {sh.openedBy.replace('พนักงาน: ', '')}</Text>
            <Icon name="chevron-down" size={16} color={colors.primary} />
          </Pressable>
          {open ? (
            <View style={[s.row, { flexWrap: 'wrap' }, mobile && { width: '100%' }]}>
              <Pressable style={[s.actBtn, s.ghost, { height: 38 }]} onPress={() => onMove('in')}>
                <Icon name="arrow-down-circle-outline" size={16} color={colors.success} />
                <Text style={s.ghostText}>นำเงินเข้า</Text>
              </Pressable>
              <Pressable style={[s.actBtn, s.ghost, { height: 38 }]} onPress={() => onMove('out')}>
                <Icon name="arrow-up-circle-outline" size={16} color="#D98200" />
                <Text style={s.ghostText}>นำเงินออก</Text>
              </Pressable>
              <Pressable style={[s.actBtn, s.primary, { height: 38 }]} onPress={onExpense}>
                <Icon name="receipt-outline" size={16} color="#fff" />
                <Text style={s.primaryText}>ค่าใช้จ่ายจากลิ้นชัก</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <View style={s.statsRow}>
          <Stat label="เงินตั้งต้น" value={baht(t.opening)} />
          <Stat label="ขายเงินสด" value={`+${baht(t.cashSales)}`} tone={colors.success} />
          <Stat label="คืนเงินลูกค้า" value={`−${baht(t.refunds)}`} tone={t.refunds ? colors.danger : undefined} />
          <Stat label="นำเงินเข้า" value={`+${baht(t.cashIn)}`} />
          <Stat label="นำเงินออก" value={`−${baht(t.cashOut)}`} />
          <Stat label="ค่าใช้จ่าย" value={`−${baht(t.expenses)}`} tone={t.expenses ? colors.danger : undefined} />
          <Stat label={open ? 'ควรมีในลิ้นชักตอนนี้' : 'ควรมีในลิ้นชัก'} value={baht(t.expected)} accent />
          {!open && sh.countedCash != null ? (
            <Stat
              label={`นับได้จริง (${sh.diff === 0 ? 'ตรง' : (sh.diff ?? 0) > 0 ? 'เกิน' : 'ขาด'})`}
              value={`${baht(sh.countedCash)} · ${signedBaht(sh.diff ?? 0)}`}
              tone={sh.diff === 0 ? colors.success : colors.danger}
            />
          ) : null}
        </View>
      </View>

      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.boxTitle}>สมุดเงินสดในลิ้นชัก ({entries.length} รายการ)</Text>
        <Pressable style={s.row} onPress={() => setOnlyMoves((v) => !v)}>
          <Icon name={onlyMoves ? 'checkbox' : 'square-outline'} size={18} color={onlyMoves ? colors.primary : colors.faint} />
          <Text style={s.sub}>ซ่อนรายการขาย</Text>
        </Pressable>
      </View>
      <View style={s.list}>
        {wide ? (
          <View style={[s.ledgerRow, s.ledgerHead]}>
            <Text style={[s.th, { width: 64 }]}>เวลา</Text>
            <Text style={[s.th, { flex: 1 }]}>รายการ</Text>
            <Text style={[s.th, { width: 140 }]}>โดย</Text>
            <Text style={[s.th, { width: 120, textAlign: 'right' }]}>เข้า / ออก</Text>
            <Text style={[s.th, { width: 120, textAlign: 'right' }]}>คงเหลือ</Text>
          </View>
        ) : null}
        {entries.map((e, i) => {
          const st = ENTRY_STYLE[e.type] ?? ENTRY_STYLE.sale;
          return (
            <View key={i} style={[s.ledgerRow, !wide && { gap: 6, paddingHorizontal: 8 }]}>
              <Text style={[s.td, { width: wide ? 64 : 40, color: colors.sub, fontSize: wide ? 13 : 11 }]}>{e.at.slice(11, 16)}</Text>
              <View style={[s.row, { flex: 1, minWidth: 0 }]}>
                <Icon name={st.icon} size={17} color={st.color} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.td} numberOfLines={1}>{e.label}</Text>
                  {e.detail ? <Text style={s.hint} numberOfLines={2}>{e.detail}</Text> : null}
                  {!wide && e.staff ? <Text style={s.hint}>{e.staff}</Text> : null}
                </View>
              </View>
              {wide ? <Text style={[s.td, { width: 140, color: colors.sub }]} numberOfLines={1}>{e.staff.replace('พนักงาน: ', '')}</Text> : null}
              <Text style={[s.td, { width: wide ? 120 : 80, textAlign: 'right', fontWeight: '700', fontSize: wide ? 13 : 12, color: e.type === 'open' ? colors.text : e.amount >= 0 ? colors.success : colors.danger }]}>
                {e.type === 'open' ? baht(e.amount) : signedBaht(e.amount)}
              </Text>
              <Text style={[s.td, { width: wide ? 120 : 74, textAlign: 'right', fontSize: wide ? 13 : 12, color: wide ? colors.text : colors.sub }]}>{baht(e.balance)}</Text>
            </View>
          );
        })}
      </View>
      <Text style={s.hint}>
        คงเหลือ = เงินสดที่ควรมีในลิ้นชัก (ไม่รวมพร้อมเพย์/บัตร/โอน) · ค่าใช้จ่ายที่จ่ายจากลิ้นชักถูกหักออกจากกะอัตโนมัติ และนับรวมตอนปิดกะ
      </Text>

      <Sheet visible={pick} onClose={() => setPick(false)} title="เลือกกะ" width={420}>
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 6 }}>
          {ledger.shifts.map((x) => (
            <Pressable
              key={x.id}
              style={[s.pickRow, x.id === sh.id && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}
              onPress={() => {
                onPickShift(x.id);
                setPick(false);
              }}
            >
              {x.status === 'open' ? <View style={s.liveDot} /> : <Icon name="lock-closed-outline" size={14} color={colors.sub} />}
              <Text style={[s.td, { flex: 1 }]}>กะ #{x.shiftNo} · {shortDate(x.businessDate)}</Text>
              <Text style={s.sub}>{x.openedBy.replace('พนักงาน: ', '')}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </ScrollView>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: string }) {
  return (
    <View style={[s.stat, accent && { backgroundColor: colors.primary }]}>
      <Text style={[s.statLabel, accent && { color: 'rgba(255,255,255,0.85)' }]}>{label}</Text>
      <Text style={[s.statValue, tone ? { color: tone } : null, accent && { color: '#fff' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ======================= ฟอร์มค่าใช้จ่าย =======================
function ExpenseForm({ edit, initialSource, categories, manager, openShift, drawerBalance, onClose, onSaved, notify }: {
  edit: Expense | null; initialSource?: ExpenseSource; categories: ExpenseCategory[]; manager: boolean;
  openShift: DrawerLedger['shift']; drawerBalance: number | null;
  onClose: () => void; onSaved: (msg: string) => void; notify: (k: Toast['kind'], t: string) => void;
}) {
  const readOnly = !!edit && (!manager || !!edit.voidedAt);
  const blank = (): ItemDraft => ({ description: '', category: '', qty: '1', unit: 'ชิ้น', unitPrice: '' });
  const [v, setV] = useState<Omit<ExpenseInput, 'items'>>(() =>
    edit
      ? { date: edit.date, source: edit.source, vendor: edit.vendor, refNo: edit.refNo, photo: edit.photo, note: edit.note }
      : { date: today(), source: initialSource ?? (openShift ? 'drawer' : 'transfer'), vendor: '', refNo: '', photo: '', note: '' },
  );
  const [items, setItems] = useState<ItemDraft[]>(() =>
    edit?.items?.length
      ? edit.items.map((x) => ({ description: x.description, category: x.category, qty: String(x.qty), unit: x.unit, unitPrice: String(x.unitPrice) }))
      : [blank()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [uploading, setUploading] = useState(false);
  const set = (x: Partial<ExpenseInput>) => setV((o) => ({ ...o, ...x }));
  const amount = round2(items.reduce((a, x) => a + lineTotal(x), 0));
  const drawer = v.source === 'drawer';
  const lockedDrawer = !!edit && edit.source === 'drawer' && edit.shiftStatus !== 'open';
  const balanceAfter = drawerBalance != null ? drawerBalance + (edit?.source === 'drawer' ? edit.amount : 0) - amount : null;

  const save = async () => {
    setError(null);
    const filled = items.filter((x) => x.description.trim() || num(x.unitPrice) > 0 || x.category);
    if (!filled.length) return setError('กรุณาเพิ่มรายการค่าใช้จ่ายอย่างน้อย 1 รายการ');
    const bad = filled.findIndex((x) => !x.category);
    if (bad >= 0) return setError(`รายการที่ ${items.indexOf(filled[bad]) + 1}: กรุณาเลือกหมวดหมู่`);
    if (!(amount > 0)) return setError('ยอดรวมต้องมากกว่า 0 — กรอกราคา/หน่วย');
    if (drawer && !openShift && !(edit && edit.source === 'drawer')) return setError('ยังไม่ได้เปิดกะ — จ่ายจากลิ้นชักไม่ได้ เลือกแหล่งเงินอื่น หรือเปิดกะก่อน');
    setBusy(true);
    try {
      const body: ExpenseInput = { ...v, items: filled.map((x) => ({ ...x, qty: num(x.qty), unitPrice: num(x.unitPrice) })) };
      if (edit) await api.updateExpense(edit.id, body);
      else await api.createExpense(body);
      onSaved(edit ? 'แก้ไขค่าใช้จ่ายแล้ว' : drawer ? `บันทึกค่าใช้จ่าย ${baht(amount)} · หักจากเงินในลิ้นชักแล้ว` : `บันทึกค่าใช้จ่าย ${baht(amount)} แล้ว`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doVoid = async () => {
    if (!edit) return;
    if (!voidReason.trim()) return setError('กรุณาระบุเหตุผลที่ยกเลิก');
    setBusy(true);
    try {
      const r = await api.voidExpense(edit.id, voidReason.trim());
      onSaved(r.refunded ? 'ยกเลิกแล้ว · คืนเงินเข้าลิ้นชักให้อัตโนมัติ' : 'ยกเลิกรายการแล้ว');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = () => {
    if (Platform.OS !== 'web') return;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png,image/webp';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      setUploading(true);
      try {
        set({ photo: (await api.upload(await resizeToDataUrl(f, 1400))).url });
      } catch (e) {
        notify('error', (e as Error).message);
      } finally {
        setUploading(false);
      }
    };
    inp.click();
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={edit ? (readOnly ? `ค่าใช้จ่าย #${edit.id}` : `แก้ไขค่าใช้จ่าย #${edit.id}`) : 'บันทึกค่าใช้จ่าย'}
      width={940}
      footer={
        readOnly ? (
          <Pressable style={[s.actBtn, s.ghost, { flexGrow: 1 }]} onPress={onClose}><Text style={s.ghostText}>ปิด</Text></Pressable>
        ) : voiding ? (
          <View style={[s.row, { flex: 1, flexWrap: 'wrap' }]}>
            <TextInput value={voidReason} onChangeText={setVoidReason} placeholder="เหตุผลที่ยกเลิก เช่น ลงซ้ำ / ลงผิด" placeholderTextColor={colors.faint} style={[s.input, { flex: 1, minWidth: 200 }]} autoFocus />
            <Pressable style={[s.actBtn, s.ghost]} onPress={() => setVoiding(false)}><Text style={s.ghostText}>ไม่ใช่</Text></Pressable>
            <Pressable style={[s.actBtn, { backgroundColor: colors.danger }]} onPress={doVoid} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>ยืนยันยกเลิก</Text>}
            </Pressable>
          </View>
        ) : (
          <View style={[s.row, { flex: 1 }]}>
            {edit ? (
              <Pressable style={[s.actBtn, s.ghost]} onPress={() => setVoiding(true)}>
                <Icon name="trash-outline" size={16} color={colors.danger} />
                <Text style={[s.ghostText, { color: colors.danger }]}>ยกเลิกรายการ</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable style={[s.actBtn, s.ghost]} onPress={onClose}><Text style={s.ghostText}>ปิด</Text></Pressable>
            <Pressable style={[s.actBtn, s.primary, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Icon name="save-outline" size={16} color="#fff" />
                  <Text style={s.primaryText}>บันทึก</Text>
                </>
              )}
            </Pressable>
          </View>
        )
      }
    >
      <ScrollView style={{ maxHeight: 660 }} contentContainerStyle={{ gap: 14, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
        {edit?.voidedAt ? (
          <View style={[s.notice, { backgroundColor: colors.dangerSoft }]}>
            <Text style={[s.td, { color: colors.danger }]}>ยกเลิกแล้วโดย {edit.voidedBy} · {thaiDateTime(edit.voidedAt)} · {edit.voidReason}</Text>
          </View>
        ) : null}
        <View pointerEvents={readOnly ? 'none' : 'auto'} style={{ gap: 14 }}>
          {/* รายการ (เหมือนระบบเดิม: รายละเอียด · หมวดหมู่ · จำนวน/หน่วย · ราคา/หน่วย · ราคา) */}
          <ItemsEditor items={items} setItems={setItems} categories={categories} lockMoney={lockedDrawer} blank={blank} total={amount} />

          {/* แหล่งเงิน */}
          <View style={{ gap: 6 }}>
            <Text style={s.label}>จ่ายจาก</Text>
            <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
              {SOURCES.map((x) => {
                const on = v.source === x.id;
                const dis = lockedDrawer || (x.id === 'drawer' && !openShift && edit?.source !== 'drawer');
                return (
                  <Pressable key={x.id} disabled={dis} onPress={() => set({ source: x.id, date: x.id === 'drawer' ? today() : v.date })} style={[s.srcChip, on && s.srcOn, dis && !on && { opacity: 0.4 }]}>
                    <Icon name={x.icon} size={16} color={on ? colors.primary : colors.sub} />
                    <Text style={[s.chipText, on && { color: colors.primary, fontWeight: '700' }]}>{x.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {lockedDrawer ? (
              <Text style={s.hint}>จ่ายจากลิ้นชักของกะ #{edit?.shiftNo} ที่ปิดแล้ว — แก้จำนวนเงิน/แหล่งเงินไม่ได้ (ยกเลิกแล้วบันทึกใหม่แทน)</Text>
            ) : drawer ? (
              openShift ? (
                <View style={[s.notice, balanceAfter != null && balanceAfter < 0 && { backgroundColor: colors.dangerSoft }]}>
                  <Icon name="cash-outline" size={16} color="#B26A00" />
                  <Text style={[s.sub, { flex: 1, color: '#8A5300' }]}>
                    หักจากเงินในลิ้นชักของกะ #{openShift.shiftNo} อัตโนมัติ · เงินในลิ้นชักตอนนี้ {baht(drawerBalance ?? 0)}
                    {amount > 0 && balanceAfter != null ? ` → เหลือ ${baht(balanceAfter)}` : ''}
                  </Text>
                </View>
              ) : (
                <Text style={[s.hint, { color: colors.danger }]}>ยังไม่ได้เปิดกะ — จ่ายจากลิ้นชักไม่ได้</Text>
              )
            ) : null}
          </View>

          <View style={s.grid}>
            <View style={s.gridItem}>
              <Text style={s.label}>วันที่จ่าย</Text>
              {drawer ? (
                <View style={[s.input, { justifyContent: 'center', backgroundColor: colors.surface }]}><Text style={s.td}>{shortDate(v.date ?? today())} (วันที่เงินออกจากลิ้นชัก)</Text></View>
              ) : (
                <DateField type="date" label="วันที่จ่าย" value={v.date ?? today()} onChange={(d) => set({ date: d })} grow />
              )}
            </View>
            <View style={s.gridItem}>
              <Text style={s.label}>ร้านค้า / ผู้รับเงิน</Text>
              <TextInput value={v.vendor} onChangeText={(t) => set({ vendor: t })} placeholder="ไม่บังคับ" placeholderTextColor={colors.faint} style={s.input} maxLength={100} />
            </View>
            <View style={s.gridItem}>
              <Text style={s.label}>เลขที่ใบเสร็จ / บิล</Text>
              <TextInput value={v.refNo} onChangeText={(t) => set({ refNo: t })} placeholder="ไม่บังคับ" placeholderTextColor={colors.faint} style={s.input} maxLength={60} />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={s.label}>หมายเหตุ</Text>
            <TextInput value={v.note} onChangeText={(t) => set({ note: t })} placeholder="ไม่บังคับ" placeholderTextColor={colors.faint} style={[s.input, { height: 64, paddingTop: 10, textAlignVertical: 'top' }]} multiline maxLength={500} />
          </View>
        </View>

        {/* รูปใบเสร็จ */}
        <View style={{ gap: 6 }}>
          <Text style={s.label}>รูปใบเสร็จ / หลักฐาน</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: 10 }]}>
            {v.photo ? (
              <Pressable onPress={() => Platform.OS === 'web' && window.open(imageSrc(v.photo), '_blank')} accessibilityLabel="ดูรูปใบเสร็จ">
                <Image source={{ uri: imageSrc(v.photo) }} style={s.photo} resizeMode="cover" />
              </Pressable>
            ) : null}
            {!readOnly ? (
              <>
                <Pressable style={[s.actBtn, s.ghost, { height: 38 }]} onPress={upload} disabled={uploading}>
                  {uploading ? <ActivityIndicator color={colors.primary} /> : <Icon name="camera-outline" size={16} color={colors.text} />}
                  <Text style={s.ghostText}>{v.photo ? 'เปลี่ยนรูป' : 'แนบรูป'}</Text>
                </Pressable>
                {v.photo ? (
                  <Pressable style={[s.actBtn, s.ghost, { height: 38 }]} onPress={() => set({ photo: '' })}>
                    <Text style={[s.ghostText, { color: colors.danger }]}>ลบรูป</Text>
                  </Pressable>
                ) : null}
              </>
            ) : !v.photo ? <Text style={s.hint}>ไม่มี</Text> : null}
          </View>
        </View>

        {edit ? (
          <Text style={s.hint}>
            บันทึกโดย {edit.staff} · {thaiDateTime(edit.createdAt)}{edit.shiftNo ? ` · กะ #${edit.shiftNo}` : ''}{edit.updatedAt !== edit.createdAt ? ` · แก้ไขล่าสุด ${thaiDateTime(edit.updatedAt)}` : ''}
            {!manager ? ' · แก้ไข/ยกเลิกต้องมีสิทธิ์แก้ไข' : ''}
          </Text>
        ) : null}
        {error ? <Text style={[s.td, { color: colors.danger }]}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

interface ItemDraft { description: string; category: string; qty: string; unit: string; unitPrice: string }
const num = (t: string | number) => Number(String(t).replace(/,/g, '')) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const lineTotal = (x: ItemDraft) => round2(num(x.qty) * num(x.unitPrice));
const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ItemsEditor({ items, setItems, categories, lockMoney, blank, total }: {
  items: ItemDraft[]; setItems: (f: (x: ItemDraft[]) => ItemDraft[]) => void; categories: ExpenseCategory[];
  lockMoney: boolean; blank: () => ItemDraft; total: number;
}) {
  const { width } = useWindowDimensions();
  const table = width >= 900;
  const [pick, setPick] = useState<number | null>(null);
  const upd = (i: number, x: Partial<ItemDraft>) => setItems((l) => l.map((it, j) => (j === i ? { ...it, ...x } : it)));
  const del = (i: number) => setItems((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [blank()]));
  const cat = (id: string) => categories.find((c) => c.id === id);
  const numInput = (value: string, onChange: (t: string) => void, label: string, extra?: object) => (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, ''))}
      keyboardType="decimal-pad"
      placeholder="0"
      placeholderTextColor={colors.faint}
      editable={!lockMoney}
      selectTextOnFocus
      style={[s.input, { textAlign: 'right' }, lockMoney && { backgroundColor: colors.surface }, extra]}
      accessibilityLabel={label}
    />
  );
  const catBtn = (it: ItemDraft, i: number) => {
    const c = cat(it.category);
    return (
      <Pressable onPress={() => setPick(i)} style={[s.input, s.catPick]} accessibilityLabel={`หมวดหมู่ รายการที่ ${i + 1}`}>
        {c ? <Text style={{ fontSize: 14 }}>{c.icon}</Text> : null}
        <Text style={[s.td, { flex: 1 }, !c && { color: colors.faint }]} numberOfLines={1}>{c ? c.name : 'เลือกหมวดหมู่'}</Text>
        <Icon name="caret-down" size={12} color={colors.sub} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={s.itemsBox}>
        {table ? (
          <View style={[s.itemRow, s.itemHead]}>
            <Text style={[s.th, { width: 30, textAlign: 'center' }]}>ลำดับ</Text>
            <Text style={[s.th, { flex: 1 }]}>รายละเอียด</Text>
            <Text style={[s.th, { width: 190 }]}>หมวดหมู่</Text>
            <Text style={[s.th, { width: 168 }]}>จำนวน / หน่วย</Text>
            <Text style={[s.th, { width: 116 }]}>ราคา / หน่วย</Text>
            <Text style={[s.th, { width: 96, textAlign: 'right' }]}>ราคา</Text>
            <View style={{ width: 34 }} />
          </View>
        ) : null}
        {items.map((it, i) =>
          table ? (
            <View key={i} style={s.itemRow}>
              <Text style={[s.td, { width: 30, textAlign: 'center', color: colors.sub }]}>{i + 1}</Text>
              <TextInput value={it.description} onChangeText={(t) => upd(i, { description: t })} placeholder="ระบุรายละเอียด" placeholderTextColor={colors.faint} style={[s.input, { flex: 1, minWidth: 0 }]} maxLength={200} accessibilityLabel={`รายละเอียด รายการที่ ${i + 1}`} />
              <View style={{ width: 190 }}>{catBtn(it, i)}</View>
              <View style={[s.row, { width: 168, gap: 4 }]}>
                {numInput(it.qty, (t) => upd(i, { qty: t }), `จำนวน รายการที่ ${i + 1}`, { width: 84 })}
                <TextInput value={it.unit} onChangeText={(t) => upd(i, { unit: t })} placeholder="หน่วย" placeholderTextColor={colors.faint} style={[s.input, { width: 80, paddingHorizontal: 8 }]} maxLength={20} accessibilityLabel={`หน่วย รายการที่ ${i + 1}`} />
              </View>
              <View style={{ width: 116 }}>{numInput(it.unitPrice, (t) => upd(i, { unitPrice: t }), `ราคาต่อหน่วย รายการที่ ${i + 1}`)}</View>
              <Text style={[s.td, { width: 96, textAlign: 'right', fontWeight: '600' }]}>{money(lineTotal(it))}</Text>
              <Pressable onPress={() => del(i)} style={s.iconSm} disabled={lockMoney} accessibilityLabel={`ลบรายการที่ ${i + 1}`}>
                <Icon name="trash-outline" size={15} color={lockMoney ? colors.line : colors.danger} />
              </Pressable>
            </View>
          ) : (
            <View key={i} style={s.itemCard}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.label}>รายการที่ {i + 1}</Text>
                <Pressable onPress={() => del(i)} style={s.iconSm} disabled={lockMoney} accessibilityLabel={`ลบรายการที่ ${i + 1}`}>
                  <Icon name="trash-outline" size={15} color={lockMoney ? colors.line : colors.danger} />
                </Pressable>
              </View>
              <TextInput value={it.description} onChangeText={(t) => upd(i, { description: t })} placeholder="ระบุรายละเอียด" placeholderTextColor={colors.faint} style={s.input} maxLength={200} />
              {catBtn(it, i)}
              <View style={[s.row, { gap: 6 }]}>
                <View style={{ flex: 1, gap: 2 }}><Text style={s.hint}>จำนวน</Text>{numInput(it.qty, (t) => upd(i, { qty: t }), `จำนวน รายการที่ ${i + 1}`)}</View>
                <View style={{ width: 80, gap: 2 }}><Text style={s.hint}>หน่วย</Text><TextInput value={it.unit} onChangeText={(t) => upd(i, { unit: t })} style={[s.input, { paddingHorizontal: 8 }]} maxLength={20} /></View>
                <View style={{ flex: 1.3, gap: 2 }}><Text style={s.hint}>ราคา / หน่วย</Text>{numInput(it.unitPrice, (t) => upd(i, { unitPrice: t }), `ราคาต่อหน่วย รายการที่ ${i + 1}`)}</View>
              </View>
              <Text style={[s.td, { textAlign: 'right', fontWeight: '700' }]}>ราคา {money(lineTotal(it))}</Text>
            </View>
          ),
        )}
        <View style={[s.itemRow, { justifyContent: 'space-between', backgroundColor: colors.surface }]}>
          <Pressable style={[s.row, { opacity: lockMoney ? 0.4 : 1 }]} onPress={() => setItems((l) => [...l, { ...blank(), category: l[l.length - 1]?.category ?? '' }])} disabled={lockMoney || items.length >= 50}>
            <Icon name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={[s.td, { color: colors.primary, fontWeight: '600' }]}>เพิ่มรายการ</Text>
          </Pressable>
          <View style={[s.row, { gap: 12 }]}>
            <Text style={s.sub}>{items.length} รายการ · รวม</Text>
            <Text style={s.totalAmt}>฿{money(total)}</Text>
          </View>
        </View>
      </View>
      {lockMoney ? <Text style={s.hint}>กะที่จ่ายเงินปิดแล้ว — แก้รายละเอียด/หมวดได้ แต่แก้จำนวนและราคาไม่ได้</Text> : null}

      <Sheet visible={pick != null} onClose={() => setPick(null)} title="เลือกหมวดหมู่" width={420}>
        <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: 6 }}>
          {categories.map((c) => {
            const on = pick != null && items[pick]?.category === c.id;
            return (
              <Pressable
                key={c.id}
                style={[s.pickRow, on && { borderColor: c.color, backgroundColor: c.color + '14' }]}
                onPress={() => {
                  if (pick != null) upd(pick, { category: c.id });
                  setPick(null);
                }}
              >
                <View style={[s.catIcon, { width: 32, height: 32, backgroundColor: c.color + '1F' }]}><Text style={{ fontSize: 15 }}>{c.icon}</Text></View>
                <Text style={[s.td, { flex: 1 }, on && { fontWeight: '700' }]}>{c.name}</Text>
                {on ? <Icon name="checkmark" size={18} color={c.color} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

// ======================= จัดการหมวด =======================
const PALETTE = ['#6B4EFF', '#F5A524', '#2F6BFF', '#1F9D63', '#0E9AA7', '#D98200', '#D23B7E', '#64748B', '#E5484D', '#475569', '#94A3B8'];
function CategoryEditor({ categories, onClose, onSaved, notify }: {
  categories: ExpenseCategory[]; onClose: () => void; onSaved: (list: ExpenseCategory[]) => void; notify: (k: Toast['kind'], t: string) => void;
}) {
  const [list, setList] = useState(() => categories.map((c) => ({ ...c })));
  const [busy, setBusy] = useState(false);
  const upd = (i: number, x: Partial<ExpenseCategory>) => setList((l) => l.map((c, j) => (j === i ? { ...c, ...x } : c)));
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.saveExpenseCategories(list.filter((c) => c.name.trim())));
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible
      onClose={onClose}
      title="หมวดค่าใช้จ่าย"
      width={560}
      footer={
        <View style={[s.row, { flex: 1 }]}>
          <Pressable style={[s.actBtn, s.ghost]} onPress={() => setList((l) => [...l, { id: '', name: '', icon: '📝', color: PALETTE[l.length % PALETTE.length] }])}>
            <Icon name="add" size={16} color={colors.text} />
            <Text style={s.ghostText}>เพิ่มหมวด</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable style={[s.actBtn, s.primary]} onPress={save} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>บันทึก</Text>}
          </Pressable>
        </View>
      }
    >
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 8 }}>
        <Text style={s.hint}>รายการเดิมที่ใช้หมวดที่ลบไป ยังเก็บไว้ (แสดงเป็นรหัสหมวด)</Text>
        {list.map((c, i) => (
          <View key={i} style={s.catEdit}>
            <TextInput value={c.icon} onChangeText={(t) => upd(i, { icon: t })} style={[s.input, { width: 52, textAlign: 'center', fontSize: 18 }]} maxLength={8} accessibilityLabel="อีโมจิ" />
            <TextInput value={c.name} onChangeText={(t) => upd(i, { name: t })} placeholder="ชื่อหมวด" placeholderTextColor={colors.faint} style={[s.input, { flex: 1, minWidth: 140 }]} maxLength={60} />
            <View style={[s.row, { gap: 4 }]}>
              {PALETTE.slice(0, 6).map((p) => (
                <Pressable key={p} onPress={() => upd(i, { color: p })} style={[s.swatch, { backgroundColor: p }, c.color === p && { borderColor: colors.text }]} accessibilityLabel={p} />
              ))}
            </View>
            <Pressable onPress={() => setList((l) => l.filter((_, j) => j !== i))} style={s.iconSm} accessibilityLabel="ลบหมวด">
              <Icon name="trash-outline" size={16} color={colors.danger} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  rowBtn: { width: 32, height: 32, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  excelBtn: { backgroundColor: '#E9F7EF', borderWidth: 1.5, borderColor: '#BFE6CF' },
  excelText: { fontFamily: font, fontSize: 14, color: '#1F7A4D', fontWeight: '600' },
  rowBtnOff: { backgroundColor: '#F4F6F9', borderColor: '#E7EBF0' },
  viewTotal: { fontFamily: font, fontSize: 22, fontWeight: '800', color: colors.text },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 16, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  infoItem: { flexBasis: 220, flexGrow: 1, gap: 2 },
  viewPhoto: { width: '100%', height: 260, borderRadius: radius.md, backgroundColor: colors.surface },
  tableWrap: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: '#fff' },
  trow: { flexDirection: 'row', alignItems: 'center', minHeight: 36, borderBottomWidth: 1, borderBottomColor: '#EEF1F5', backgroundColor: '#fff' },
  thead: { backgroundColor: '#EEF1F5', minHeight: 38 },
  tfoot: { backgroundColor: '#F7F9FC', borderBottomWidth: 0 },
  tcell: { paddingHorizontal: 10, paddingVertical: 7, justifyContent: 'center' },
  th: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text },
  docNo: { fontVariant: ['tabular-nums'] },
  money: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  strike: { textDecorationLine: 'line-through', color: colors.faint },
  tfootText: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text },
  root: { flex: 1, flexDirection: 'row', gap: 14, backgroundColor: colors.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderRadius: radius.xl, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  title: { fontFamily: font, fontSize: 20, fontWeight: '600', color: colors.text },
  titleSub: { fontSize: 13, fontWeight: '400', color: colors.sub },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub, lineHeight: 18 },
  hint: { fontFamily: font, fontSize: 11, color: colors.sub, lineHeight: 16 },
  label: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  error: { fontFamily: font, color: colors.danger, textAlign: 'center', marginVertical: 8 },
  actBtn: { height: 44, paddingHorizontal: 14, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  ghost: { borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#fff' },
  ghostText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.primary },
  tabText: { fontFamily: font, fontSize: 14, color: colors.sub },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  filters: { gap: 8, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 8 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: font, fontSize: 12, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, minWidth: 220, flexGrow: 1, maxWidth: 360 },
  searchInput: { flex: 1, fontFamily: font, fontSize: 13, color: colors.text, outlineStyle: 'none' } as object,
  sumWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' },
  sumCard: { flexGrow: 1, flexBasis: 150, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  statLabel: { fontFamily: font, fontSize: 12, color: colors.sub },
  sumValue: { fontFamily: font, fontSize: 18, fontWeight: '700', color: colors.text },
  bigValue: { fontFamily: font, fontSize: 26, fontWeight: '700' },
  catBox: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, gap: 4 },
  boxTitle: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 2 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 6, borderRadius: radius.sm },
  catName: { fontFamily: font, fontSize: 12, color: colors.text, flexShrink: 1 },
  catAmt: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.text },
  barBg: { height: 6, borderRadius: 3, backgroundColor: '#EEF1F6', overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#F2F4F7', backgroundColor: '#fff' },
  catIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
  amount: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.danger },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, height: 20, borderRadius: radius.pill, backgroundColor: colors.surface },
  tagText: { fontFamily: font, fontSize: 10.5, color: colors.sub },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 6 },
  emptyText: { fontFamily: font, fontSize: 14, color: colors.sub, textAlign: 'center' },
  shiftCard: { borderRadius: radius.lg, borderWidth: 1.5, borderColor: '#D6E1FF', backgroundColor: '#F8FAFF', padding: 14, gap: 12 },
  curTitle: { fontFamily: font, fontSize: 16, fontWeight: '700', color: colors.text },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, flexBasis: 130, backgroundColor: '#fff', borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12 },
  statValue: { fontFamily: font, fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 2 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#F2F4F7', backgroundColor: '#fff' },
  ledgerHead: { backgroundColor: colors.surface, paddingVertical: 7 },
  th: { fontFamily: font, fontSize: 11, fontWeight: '700', color: colors.sub },
  td: { fontFamily: font, fontSize: 13, color: colors.text },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.lg, paddingHorizontal: 16, height: 64, backgroundColor: '#fff' },
  amountCur: { fontFamily: font, fontSize: 24, color: colors.sub },
  amountInput: { flex: 1, fontFamily: font, fontSize: 30, fontWeight: '700', color: colors.text, outlineStyle: 'none' } as object,
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  srcChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 38, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#fff' },
  srcOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: '#FFF4E0' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { flexGrow: 1, flexBasis: 240, gap: 6, minWidth: 0 },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  catEdit: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F2F4F7' },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff' },
  itemsBox: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#F2F4F7', backgroundColor: '#fff' },
  itemHead: { backgroundColor: colors.surface, paddingVertical: 8 },
  itemCard: { gap: 6, padding: 10, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: '#fff' },
  catPick: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 },
  totalAmt: { fontFamily: font, fontSize: 20, fontWeight: '700', color: colors.danger },
  iconSm: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
