// รายงาน → สินค้า: สินค้าขายได้กี่ชิ้น ยอดขาย ต้นทุน/ราคาขายเฉลี่ย กำไร คงเหลือ — รายสินค้า หรือแยกตาม SKU + ส่งออก Excel
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, type ProductReport, type ProductReportFilter, type ProductReportRow } from '../api';
import { Icon } from '../components/Icon';
import type { Route } from '../components/NavMenu';
import {
  BranchControl, Check, DataTable, ExcelButton, k, Pager, PeriodControl, rangeText, ReportPage, useBranchScope, usePeriod, type Column,
} from '../components/report/ReportKit';
import { Sheet } from '../components/Sheet';
import { n0, n2 } from '../format';
import { colors, font } from '../theme';

const money = (v: number | null) => (v == null ? '–' : `${Number.isInteger(v) ? n0(v) : n2(v)} ฿`);

export function ProductReportScreen({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const p = usePeriod('month');
  const b = useBranchScope();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [pickCat, setPickCat] = useState(false);
  const [bySku, setBySku] = useState(false);
  const [soldOnly, setSoldOnly] = useState(true);
  const [showStock, setShowStock] = useState(true);
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: 'units', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProductReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** หน้าต่าง "ดู SKU" ของสินค้าที่เลือก */
  const [skuOf, setSkuOf] = useState<{ row: ProductReportRow; list: ProductReportRow[] | null } | null>(null);
  const [skuSort, setSkuSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: 'units', dir: 'desc' });

  useEffect(() => {
    api.categories().then(setCategories, () => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  // เปลี่ยนตัวกรอง → กลับไปหน้าแรก
  useEffect(() => {
    setPage(1);
  }, [p.range.from, p.range.to, b.scope, q, category, bySku, soldOnly, sort.id, sort.dir]);

  const filter: ProductReportFilter = {
    ...p.range, branch: b.scope || undefined, q: q || undefined, category: category || undefined,
    mode: bySku ? 'sku' : 'product', sold: soldOnly ? '1' : '0', sort: sort.id, dir: sort.dir,
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.productReport({ ...filter, page, limit: 50 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filter), page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  const showSkus = async (r: ProductReportRow) => {
    const id = r.productId;
    if (!id) return;
    setSkuOf({ row: r, list: null });
    setSkuSort({ id: 'units', dir: 'desc' });
    try {
      // ไม่ใช้คำค้นหา → เห็นทุก SKU ของสินค้านี้ (ตามช่วงเวลา/สาขา/เฉพาะที่ขายได้ ที่เลือกอยู่)
      const d = await api.productReport({ ...filter, mode: 'sku', productId: id, q: undefined, page: 1, limit: 500 });
      setSkuOf((cur) => (cur?.row.productId === id ? { row: r, list: d.rows } : cur));
    } catch (e) {
      setSkuOf(null);
      setError((e as Error).message);
    }
  };
  const skuRows = (() => {
    const list = [...(skuOf?.list ?? [])];
    const get: Record<string, (r: ProductReportRow) => number | string> = {
      sku: (r) => r.sku, attr: (r) => r.attribute, units: (r) => r.units, sales: (r) => r.sales, avg: (r) => r.avgSell ?? -1,
      profit: (r) => r.profit, stock: (r) => r.stock ?? -Infinity,
    };
    const g = get[skuSort.id] ?? get.units;
    list.sort((a, b) => {
      const x = g(a);
      const y = g(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return (skuSort.dir === 'asc' ? c : -c) || a.sku.localeCompare(b.sku);
    });
    return list;
  })();

  const t = data?.total;
  const num = (s: string, faint = false, extra?: object) => <Text style={[k.tdText, { textAlign: 'center' }, faint && { color: colors.faint }, extra]}>{s}</Text>;
  const cols: Column<ProductReportRow>[] = [
    { id: 'code', label: 'รหัส', width: 100, sortable: true, render: (r) => r.code || '–', total: 'รวม' },
    {
      id: 'name', label: 'ชื่อสินค้า', width: bySku ? 230 : 290, sortable: true,
      render: (r) => (
        <View style={{ gap: 2 }}>
          <Text style={k.tdText} numberOfLines={2}>
            {r.name}
            {!bySku && r.productId && r.skuCount > 0 ? (
              <Text style={{ color: colors.primary }} onPress={() => showSkus(r)} accessibilityRole="button">
                {'  '}[ดู SKU {r.skuCount}]
              </Text>
            ) : null}
          </Text>
          <Text style={k.note} numberOfLines={1}>{r.category}</Text>
        </View>
      ),
      total: t ? `${n0(t.rows)} รายการ` : undefined,
    },
    ...(bySku
      ? [
          { id: 'sku', label: 'รหัส SKU', width: 150, render: (r: ProductReportRow) => r.sku || '–' },
          { id: 'attr', label: 'คุณสมบัติ', width: 130, render: (r: ProductReportRow) => r.attribute || '–' },
        ]
      : []),
    ...(showStock
      ? [{ id: 'stock', label: 'คงเหลือ', width: 90, align: 'center' as const, sortable: true,
          render: (r: ProductReportRow) => num(r.stock == null ? '–' : n0(r.stock), r.stock == null, r.stock != null && r.stock <= 0 ? { color: colors.danger, fontWeight: '600' } : undefined),
          total: t ? n0(t.stock) : undefined }]
      : []),
    { id: 'units', label: 'ขายได้', width: 90, align: 'center', sortable: true, render: (r) => num(`${n0(r.units)} ชิ้น`, !r.units, { fontWeight: '600' }), total: t ? `${n0(t.units)} ชิ้น` : undefined },
    { id: 'sales', label: 'ยอดขาย', width: 120, align: 'center', sortable: true, render: (r) => num(money(r.sales), !r.sales), total: t ? money(t.sales) : undefined },
    { id: 'cost', label: 'ต้นทุนเฉลี่ย', width: 110, align: 'center', sortable: true, render: (r) => num(money(r.avgCost), r.avgCost == null) },
    { id: 'sell', label: 'ราคาขายเฉลี่ย', width: 120, align: 'center', sortable: true, render: (r) => num(money(r.avgSell), r.avgSell == null) },
    {
      id: 'profit', label: 'กำไร', width: 120, align: 'center', sortable: true,
      render: (r) => num(money(r.profit), !r.profit, { color: r.profit < 0 ? colors.danger : r.profit ? colors.success : colors.faint }),
      total: t ? money(t.profit) : undefined,
    },
  ];

  const st = skuOf?.list;
  const skuTotal = st && {
    units: st.reduce((a, r) => a + r.units, 0), sales: st.reduce((a, r) => a + r.sales, 0),
    profit: st.reduce((a, r) => a + r.profit, 0), stock: st.reduce((a, r) => a + (r.stock ?? 0), 0),
  };
  const skuTable: Column<ProductReportRow>[] = [
    { id: 'sku', label: 'รหัส SKU', width: 130, sortable: true, render: (r) => r.sku || '–', total: 'รวม' },
    { id: 'attr', label: 'คุณสมบัติ', width: 110, align: 'center', sortable: true, render: (r) => r.attribute || '–', total: st ? `${n0(st.length)} SKU` : undefined },
    ...(showStock
      ? [{ id: 'stock', label: 'คงเหลือ', width: 94, align: 'center' as const, sortable: true,
          render: (r: ProductReportRow) => num(r.stock == null ? '–' : n0(r.stock), r.stock == null, r.stock != null && r.stock <= 0 ? { color: colors.danger, fontWeight: '600' } : undefined),
          total: skuTotal ? n0(skuTotal.stock) : undefined }]
      : []),
    { id: 'units', label: 'จำนวน', width: 90, align: 'center', sortable: true, render: (r) => <Text style={[k.tdText, { textAlign: 'center' }, !r.units && { color: colors.faint }]}>{n0(r.units)} ชิ้น</Text>, total: skuTotal ? `${n0(skuTotal.units)} ชิ้น` : undefined },
    { id: 'sales', label: 'ยอดขาย', width: 100, align: 'center', sortable: true, render: (r) => <Text style={[k.tdText, { textAlign: 'center' }, !r.sales && { color: colors.faint }]}>{money(r.sales)}</Text>, total: skuTotal ? money(skuTotal.sales) : undefined },
    {
      id: 'avg', label: 'เฉลี่ย (ต้นทุน / ขาย)', width: 150, align: 'center', sortable: true,
      render: (r) => <Text style={[k.tdText, { textAlign: 'center' }, r.avgSell == null && { color: colors.faint }]}>{money(r.avgCost)} | {money(r.avgSell)}</Text>,
    },
    {
      id: 'profit', label: 'กำไร', width: 110, align: 'center', sortable: true,
      render: (r) => <Text style={[k.tdText, { textAlign: 'center', color: r.profit < 0 ? colors.danger : r.profit ? colors.text : colors.faint }]}>{money(r.profit)}</Text>,
      total: skuTotal ? money(skuTotal.profit) : undefined,
    },
  ];

  const catName = categories.find((c) => c.id === category)?.name;

  return (
    <ReportPage
      route="productReport"
      title="รายงานสินค้า"
      sub="สินค้าขายได้กี่ชิ้น ยอดขาย ต้นทุน กำไร และคงเหลือ"
      onNavigate={onNavigate}
      right={<ExcelButton url={() => api.productReportXlsxUrl(filter)} disabled={!data} />}
    >
      <View style={k.toolbar}>
        <PeriodControl p={p} />
        <BranchControl b={b} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="ค้นหา รหัส / ชื่อ / SKU / บาร์โค้ด / สี / ไซซ์"
          placeholderTextColor={colors.faint}
          style={k.search}
          accessibilityLabel="ค้นหาสินค้า"
        />
      </View>
      <View style={k.toolbar}>
        <Pressable style={[k.pill, !!category && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]} onPress={() => setPickCat(true)} accessibilityLabel="หมวดหมู่">
          <Icon name="folder-open-outline" size={16} color={colors.primary} />
          <Text style={k.pillText} numberOfLines={1}>{catName ?? 'ทุกหมวดหมู่'}</Text>
          <Icon name="chevron-down" size={14} color={colors.sub} />
        </Pressable>
        <Check on={soldOnly} label="เฉพาะที่ขายได้" onPress={() => setSoldOnly((v) => !v)} />
        <Check on={bySku} label="แยกตาม SKU" onPress={() => setBySku((v) => !v)} />
        <Check on={showStock} label="แสดงคงเหลือ" onPress={() => setShowStock((v) => !v)} />
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      {error ? <Text style={k.error}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
        <Pager
          page={data?.page ?? 1}
          pages={data?.pages ?? 1}
          onPage={setPage}
          info={data ? `ทั้งหมด ${n0(data.total.rows)} ${bySku ? 'SKU' : 'สินค้า'} · ${b.label}` : ''}
        />
        <View style={{ opacity: loading ? 0.55 : 1 }}>
          <DataTable
            cols={cols}
            rows={data?.rows ?? []}
            keyOf={(r) => r.key}
            sort={sort}
            onSort={(id) => setSort((s) => ({ id, dir: s.id === id ? (s.dir === 'desc' ? 'asc' : 'desc') : id === 'code' || id === 'name' ? 'asc' : 'desc' }))}
            empty={loading ? 'กำลังโหลด…' : soldOnly ? 'ไม่มีสินค้าที่ขายได้ในช่วงนี้' : 'ไม่พบสินค้า'}
          />
        </View>
        <Pager page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
        <Text style={k.note}>
          ยอดขายและกำไร ยังไม่หักส่วนลดท้ายบิล · กำไร = ยอดขายไม่รวม VAT − ต้นทุน · คงเหลือ = สต็อกตอนนี้ ({b.label}) · ไม่รวมบิลที่ยกเลิก · ไฟล์ Excel มีทั้งแบบแยก SKU และรวมต่อสินค้า
        </Text>
      </ScrollView>

      <Sheet visible={!!skuOf} onClose={() => setSkuOf(null)} title={skuOf ? `${skuOf.row.code} · ${skuOf.row.name}` : ''} width={showStock ? 860 : 770}>
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <Text style={k.note}>
            {rangeText(p.range)} · {b.label}{soldOnly ? ' · เฉพาะ SKU ที่ขายได้' : ''} · ยอดขาย/กำไร ยังไม่หักส่วนลดท้ายบิล
          </Text>
          {st ? (
            <ScrollView style={{ maxHeight: 520 }}>
              <DataTable
                cols={skuTable}
                rows={skuRows}
                keyOf={(r) => r.key}
                sort={skuSort}
                onSort={(id) => setSkuSort((s) => ({ id, dir: s.id === id ? (s.dir === 'desc' ? 'asc' : 'desc') : id === 'sku' || id === 'attr' ? 'asc' : 'desc' }))}
                empty="ไม่มี SKU ที่ขายได้ในช่วงนี้"
              />
            </ScrollView>
          ) : (
            <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} />
          )}
        </View>
      </Sheet>

      <Sheet visible={pickCat} onClose={() => setPickCat(false)} title="หมวดหมู่" width={360}>
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
          {[{ id: '', name: 'ทุกหมวดหมู่' }, ...categories].map((c) => {
            const on = c.id === category;
            return (
              <Pressable key={c.id || 'all'} style={[k.opt, on && k.optOn]} onPress={() => { setCategory(c.id); setPickCat(false); }}>
                <Text style={[k.optText, { fontFamily: font }, on && { color: colors.primary, fontWeight: '600' }]}>{c.name}</Text>
                {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </ReportPage>
  );
}
