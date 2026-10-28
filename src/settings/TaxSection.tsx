// ตั้งค่า → ภาษี (VAT): ผู้ประกอบการ · จด VAT / สำนักงานใหญ่-สาขาที่ รายสาขา · ตารางอัตรา VAT (วันเริ่ม/สิ้นสุด)
// · เครื่อง POS (หมายเลขเครื่องต่อเครื่อง) · เครื่องนี้ใช้เครื่อง POS ไหน
// บันทึกทันทีทีละรายการ (ไม่ใช้ปุ่มบันทึกรวมของหน้าตั้งค่า)
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type TaxAdmin, type TaxTerminal, type VatRate } from '../api';
import { DateField } from '../components/DateField';
import { Icon, type IconName } from '../components/Icon';
import { thaiDateTime, validTaxId } from '../format';
import { getDeviceTerminal, setDeviceTerminal, taxBranchText } from '../terminal';
import { colors, font, radius } from '../theme';

type Notify = (kind: 'success' | 'error' | 'info', text: string) => void;

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const day = (s: string | null) => {
  if (!s) return 'ไม่มีกำหนด';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y + 543}`;
};

export function TaxSection({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  const [data, setData] = useState<TaxAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.tax());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  /** เรียก API แล้วใช้ผลล่าสุด + แจ้งผล */
  const run = async (fn: () => Promise<TaxAdmin>, ok: string) => {
    try {
      setData(await fn());
      notify('success', ok);
      onChanged();
      return true;
    } catch (e) {
      notify('error', (e as Error).message);
      return false;
    }
  };

  if (error) return <Text style={s.error}>{error}</Text>;
  if (!data) return <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />;
  return (
    <View style={{ gap: 12 }}>
      <Status data={data} />
      <CompanyCard data={data} run={run} />
      <BranchCard data={data} run={run} />
      <RatesCard data={data} run={run} />
      <TerminalsCard data={data} run={run} />
      <ThisDeviceCard data={data} notify={notify} onChanged={onChanged} />
    </View>
  );
}

type Run = (fn: () => Promise<TaxAdmin>, ok: string) => Promise<boolean>;

/**
 * สรุปว่าตั้งอะไรไว้แล้วบ้าง — เป็นรายการ "ตั้งเพิ่มได้" ไม่ใช่เงื่อนไขบังคับ
 * ไม่ตั้งอะไรเลยก็ขายได้ตามปกติ บิลจะไม่คิด VAT และไม่ระบุเครื่อง POS
 */
function Status({ data }: { data: TaxAdmin }) {
  const vatBranches = data.branches.filter((b) => b.vatRegistered);
  const on = vatBranches.length > 0;
  const checks: [boolean, string][] = [
    [!!data.company.taxId && data.company.taxIdValid, 'เลขประจำตัวผู้เสียภาษี 13 หลัก'],
    [on && vatBranches.every((b) => !!b.taxBranchNo), 'ระบุสำนักงานใหญ่ / สาขาที่ ของสาขาที่จด VAT'],
    [data.rateToday !== null, 'มีอัตรา VAT ที่มีผลวันนี้'],
    [on && vatBranches.every((b) => data.terminals.some((t) => t.branchId === b.id && t.active)), 'ตั้งเครื่อง POS ของสาขาที่จด VAT'],
    [data.company.lockEdit, 'ห้ามแก้ไขบิลที่ออกแล้ว (ยกเลิกแล้วออกใหม่)'],
  ];
  const done = checks.filter((c) => c[0]).length;
  const full = done === checks.length;
  return (
    <View style={[s.status, full && { borderColor: '#BFE8D3', backgroundColor: colors.successSoft }]}>
      <View style={s.row}>
        <Icon name={full ? 'shield-checkmark' : 'information-circle'} size={20} color={full ? colors.success : colors.primary} />
        <Text style={s.statusTitle}>
          {full ? 'ครบตามข้อกำหนดภาษีมูลค่าเพิ่ม' : `ตั้งค่าไว้ ${done}/${checks.length} รายการ`}
          {data.rateToday !== null ? ` · อัตรา VAT วันนี้ ${data.rateToday}%` : ''}
        </Text>
      </View>
      <Text style={s.hint}>
        ส่วนนี้ไม่บังคับ — ไม่ตั้งก็ขายได้ตามปกติ (บิลไม่คิด VAT) ตั้งเมื่อร้านจด VAT และต้องออกเอกสารตามข้อกำหนดกรมสรรพากร
      </Text>
      <View style={s.checks}>
        {checks.map(([ok, label]) => (
          <View key={label} style={s.check}>
            <Icon name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={ok ? colors.success : colors.faint} />
            <Text style={[s.hint, { color: ok ? colors.text : colors.sub }]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CompanyCard({ data, run }: { data: TaxAdmin; run: Run }) {
  const [legalName, setLegalName] = useState(data.company.legalName);
  const [taxId, setTaxId] = useState(data.company.taxId);
  useEffect(() => {
    setLegalName(data.company.legalName);
    setTaxId(data.company.taxId);
  }, [data.company.legalName, data.company.taxId]);
  const dirty = legalName !== data.company.legalName || taxId !== data.company.taxId;
  const idOk = !taxId || validTaxId(taxId);
  return (
    <Card title="ผู้ประกอบการ" icon="business-outline">
      <View style={s.grid2}>
        <Field label="ชื่อผู้ประกอบการตามที่จดทะเบียน" hint={`พิมพ์บนใบกำกับภาษีอย่างย่อ · ว่าง = ใช้ชื่อร้าน (${data.company.shopName})`}>
          <TextInput value={legalName} onChangeText={setLegalName} maxLength={160} placeholder="เช่น บริษัท เอบีซี จำกัด" placeholderTextColor={colors.faint} style={s.input} />
        </Field>
        <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)" hint={taxId && !idOk ? 'เลขไม่ถูกต้อง — ตรวจสอบเลขหลักสุดท้าย' : taxId.length === 13 ? 'ตรวจเลขถูกต้อง' : 'ตัวเลข 13 หลัก'}>
          <TextInput
            value={taxId}
            onChangeText={(t) => setTaxId(t.replace(/[^0-9]/g, '').slice(0, 13))}
            keyboardType="number-pad"
            placeholder="0000000000000"
            placeholderTextColor={colors.faint}
            style={[s.input, taxId.length === 13 && (idOk ? s.inputOk : s.inputBad)]}
          />
        </Field>
      </View>
      <View style={[s.row, { justifyContent: 'flex-end' }]}>
        <Btn label="บันทึกผู้ประกอบการ" icon="save-outline" primary disabled={!dirty || !idOk} onPress={() => run(() => api.taxCompany({ legalName, taxId }), 'บันทึกข้อมูลผู้ประกอบการแล้ว')} />
      </View>
      <ToggleRow
        label="ห้ามแก้ไขบิลที่ออกแล้ว (แนะนำ)"
        hint="สาขาที่จด VAT: ใบกำกับภาษีที่ออกแล้วแก้ไขไม่ได้ — ถ้าเปลี่ยน/คืนสินค้า ให้ยกเลิกบิล (มีเหตุผล + ผู้อนุมัติ + เวลา บิลยังเก็บไว้) แล้วออกบิลใหม่"
        value={data.company.lockEdit}
        onChange={(v) => run(() => api.taxCompany({ lockEdit: v }), v ? 'เปิด ห้ามแก้ไขบิล แล้ว' : 'ปิด ห้ามแก้ไขบิล แล้ว')}
      />
    </Card>
  );
}

function BranchCard({ data, run }: { data: TaxAdmin; run: Run }) {
  return (
    <Card title="สาขา: จด VAT · สำนักงานใหญ่ / สาขาที่" icon="storefront-outline">
      <Text style={s.hint}>สาขาที่ไม่ได้จด VAT จะไม่คิด/ไม่แสดง VAT ในบิล · เลขสาขาตามทะเบียนภาษี 5 หลัก (สำนักงานใหญ่ = 00000) พิมพ์บนใบกำกับภาษี</Text>
      {data.branches.map((b) => (
        <BranchRow key={b.id} b={b} run={run} />
      ))}
    </Card>
  );
}
function BranchRow({ b, run }: { b: TaxAdmin['branches'][number]; run: Run }) {
  const [no, setNo] = useState(b.taxBranchNo);
  useEffect(() => setNo(b.taxBranchNo), [b.taxBranchNo]);
  const hq = no === '00000';
  const save = (taxBranchNo: string) => run(() => api.taxBranch(b.id, { taxBranchNo }), `บันทึก ${b.name}: ${taxBranchText(taxBranchNo) || 'ไม่ระบุสาขา'}`);
  return (
    <View style={s.branchRow}>
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={s.label}>{b.name} <Text style={s.hint}>{b.code}{b.isMain ? ' · สาขาหลัก' : ''}</Text></Text>
        <Text style={s.hint}>{b.vatRegistered ? `จด VAT · ${taxBranchText(b.taxBranchNo) || 'ยังไม่ระบุสาขาตามทะเบียนภาษี'}` : 'ไม่ได้จด VAT'}</Text>
      </View>
      <View style={s.row}>
        <Text style={s.hint}>จด VAT</Text>
        <Switch value={b.vatRegistered} onChange={(v) => run(() => api.taxBranch(b.id, { vatRegistered: v }), `${b.name}: ${v ? 'จด VAT' : 'ไม่จด VAT'}`)} />
      </View>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <Seg value={hq ? 'hq' : 'br'} options={[['hq', 'สำนักงานใหญ่'], ['br', 'สาขาที่']]} onChange={(v) => (v === 'hq' ? save('00000') : setNo(no === '00000' ? '' : no))} />
        {!hq ? (
          <>
            <TextInput
              value={no}
              onChangeText={(t) => setNo(t.replace(/[^0-9]/g, '').slice(0, 5))}
              onBlur={() => no !== b.taxBranchNo && (no.length === 5 || no === '') && save(no)}
              keyboardType="number-pad"
              placeholder="00001"
              placeholderTextColor={colors.faint}
              style={[s.input, { width: 90, textAlign: 'center' }]}
              accessibilityLabel={`เลขสาขา ${b.name}`}
            />
            <Btn label="บันทึก" icon="save-outline" disabled={no === b.taxBranchNo || (no.length !== 5 && no !== '')} onPress={() => save(no)} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function RatesCard({ data, run }: { data: TaxAdmin; run: Run }) {
  const [form, setForm] = useState<{ id: number | null; rate: string; startDate: string; endDate: string; note: string } | null>(null);
  const open = (r?: VatRate) =>
    setForm(r ? { id: r.id, rate: String(r.rate), startDate: r.startDate, endDate: r.endDate ?? '', note: r.note } : { id: null, rate: '', startDate: data.today, endDate: '', note: '' });
  const submit = async () => {
    if (!form) return;
    const body = { rate: form.rate, startDate: form.startDate, endDate: form.endDate || null, note: form.note };
    const ok = await run(() => (form.id ? api.updateVatRate(form.id, body) : api.addVatRate(body)), form.id ? 'แก้ไขอัตรา VAT แล้ว' : 'เพิ่มอัตรา VAT แล้ว');
    if (ok) setForm(null);
  };
  const state = (r: VatRate) => (r.current ? ['มีผลวันนี้', colors.success] : r.startDate > data.today ? ['ยังไม่ถึงวันเริ่ม', colors.primary] : ['สิ้นสุดแล้ว', colors.sub]);
  return (
    <Card title="อัตรา VAT" icon="calculator-outline" right={<Btn label="เพิ่มอัตรา" icon="add" onPress={() => open()} />}>
      <Text style={s.hint}>
        ราคาสินค้ารวม VAT แล้ว · ระบบเลือกอัตราตามวันที่ออกบิล และเก็บอัตราที่ใช้ไว้ในบิลแต่ละใบ (บิลเก่าไม่เปลี่ยนเมื่อแก้ตาราง) · เปลี่ยนอัตรา = กำหนดวันสิ้นสุดของอัตราเดิม แล้วเพิ่มอัตราใหม่ที่เริ่มวันถัดไป
      </Text>
      {data.rateToday === null && data.branches.some((b) => b.vatRegistered) ? (
        <View style={s.warn}>
          <Icon name="information-circle-outline" size={16} color="#B26A00" />
          <Text style={[s.hint, { color: '#B26A00', flex: 1 }]}>
            ยังไม่มีอัตรา VAT ที่มีผลวันนี้ — ขายได้ตามปกติ แต่บิลจะไม่คิด VAT (ถ้าร้านจด VAT ให้เพิ่มอัตราเพื่อให้บิลคิดภาษีถูกต้อง)
          </Text>
        </View>
      ) : null}
      <TableWrap>
        <View style={[s.tr, s.th]}>
          <Text style={[s.thText, { width: 70 }]}>อัตรา</Text>
          <Text style={[s.thText, { flex: 1 }]}>ช่วงวันที่</Text>
          <Text style={[s.thText, { width: 110 }]}>สถานะ</Text>
          <Text style={[s.thText, { width: 70, textAlign: 'center' }]}>บิล</Text>
          <Text style={[s.thText, { width: 76 }]} />
        </View>
        {data.rates.length === 0 ? <Text style={[s.hint, { padding: 12 }]}>ยังไม่มีอัตรา VAT</Text> : null}
        {data.rates.map((r) => {
          const [label, color] = state(r);
          return (
            <View key={r.id} style={s.tr}>
              <Text style={[s.td, { width: 70, fontWeight: '700' }]}>{r.rate}%</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.td}>{day(r.startDate)} – {day(r.endDate)}</Text>
                {r.note ? <Text style={s.hint} numberOfLines={1}>{r.note}</Text> : null}
              </View>
              <Text style={[s.td, { width: 110, color, fontWeight: '600' }]}>{label}</Text>
              <Text style={[s.td, { width: 70, textAlign: 'center' }]}>{r.bills.toLocaleString()}</Text>
              <View style={[s.row, { width: 76, gap: 4, justifyContent: 'flex-end' }]}>
                <IconBtn icon="create-outline" label="แก้ไขอัตรา" onPress={() => open(r)} />
                <IconBtn icon="trash-outline" label="ลบอัตรา" danger disabled={r.bills > 0} onPress={() => run(() => api.deleteVatRate(r.id), 'ลบอัตรา VAT แล้ว')} />
              </View>
            </View>
          );
        })}
      </TableWrap>
      {form ? (
        <View style={s.form}>
          <Text style={s.label}>{form.id ? 'แก้ไขอัตรา VAT' : 'เพิ่มอัตรา VAT'}</Text>
          <View style={[s.row, { flexWrap: 'wrap', alignItems: 'flex-end' }]}>
            <Field label="อัตรา (%)">
              <TextInput value={form.rate} onChangeText={(t) => setForm({ ...form, rate: t.replace(/[^0-9.]/g, '').slice(0, 5) })} keyboardType="decimal-pad" placeholder="เช่น 7" placeholderTextColor={colors.faint} style={[s.input, { width: 90 }]} />
            </Field>
            <Field label="เริ่มใช้วันที่">
              <DateField type="date" label="เริ่มใช้วันที่" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} width={160} />
            </Field>
            <Field label="ถึงวันที่ (ว่าง = ไม่มีกำหนด)">
              <View style={s.row}>
                <DateField type="date" label="ถึงวันที่" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} width={160} />
                {form.endDate ? <IconBtn icon="close" label="ล้างวันสิ้นสุด" onPress={() => setForm({ ...form, endDate: '' })} /> : null}
              </View>
            </Field>
            <View style={{ flex: 1, minWidth: 180 }}>
              <Field label="หมายเหตุ">
                <TextInput value={form.note} onChangeText={(t) => setForm({ ...form, note: t })} maxLength={120} placeholder="เช่น ตามพระราชกฤษฎีกา ฉบับที่ ..." placeholderTextColor={colors.faint} style={s.input} />
              </Field>
            </View>
          </View>
          <View style={[s.row, { justifyContent: 'flex-end' }]}>
            <Btn label="ยกเลิก" icon="close" onPress={() => setForm(null)} />
            <Btn label={form.id ? 'บันทึก' : 'เพิ่มอัตรา'} icon="save-outline" primary disabled={!form.rate || !form.startDate} onPress={submit} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function TerminalsCard({ data, run }: { data: TaxAdmin; run: Run }) {
  const [form, setForm] = useState<{ id: number | null; branchId: number; code: string; rdNo: string; name: string; active: boolean } | null>(null);
  const open = (t?: TaxTerminal) =>
    setForm(t ? { ...t } : { id: null, branchId: data.branches[0]?.id ?? 0, code: nextCode(data.terminals, data.branches[0]?.id ?? 0), rdNo: '', name: '', active: true });
  const submit = async () => {
    if (!form) return;
    const body = { code: form.code, rdNo: form.rdNo, name: form.name, active: form.active };
    const ok = await run(() => (form.id ? api.updateTerminal(form.id, body) : api.addTerminal({ ...body, branchId: form.branchId })), form.id ? `บันทึกเครื่อง ${form.code} แล้ว` : `เพิ่มเครื่อง ${form.code} แล้ว`);
    if (ok) setForm(null);
  };
  const branchName = (id: number) => data.branches.find((b) => b.id === id)?.name ?? `สาขา #${id}`;
  return (
    <Card title="เครื่อง POS" icon="desktop-outline" right={<Btn label="เพิ่มเครื่อง" icon="add" onPress={() => open()} />}>
      <Text style={s.hint}>
        แต่ละเครื่องที่ออกบิลต้องมีหมายเลขเครื่องที่ได้รับอนุมัติจากกรมสรรพากร · เลขที่บิลรันแยกต่อเครื่อง (เช่น INV-POS01-…) · เมื่อสาขาตั้งเครื่องแล้ว ทุกเครื่องของสาขานั้นต้องเลือก “เครื่องนี้” ก่อนขาย
      </Text>
      <TableWrap>
        <View style={[s.tr, s.th]}>
          <Text style={[s.thText, { width: 80 }]}>รหัส</Text>
          <Text style={[s.thText, { flex: 1 }]}>หมายเลขเครื่อง · ชื่อ</Text>
          <Text style={[s.thText, { width: 120 }]}>สาขา</Text>
          <Text style={[s.thText, { width: 110 }]}>บิล</Text>
          <Text style={[s.thText, { width: 76 }]} />
        </View>
        {data.terminals.length === 0 ? <Text style={[s.hint, { padding: 12 }]}>ยังไม่ได้ตั้งเครื่อง POS — บิลจะไม่ระบุเครื่อง</Text> : null}
        {data.terminals.map((t) => (
          <View key={t.id} style={[s.tr, !t.active && { opacity: 0.5 }]}>
            <Text style={[s.td, { width: 80, fontWeight: '700' }]}>{t.code}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.td, !t.rdNo && { color: colors.danger }]}>{t.rdNo || 'ยังไม่ใส่หมายเลขเครื่อง'}</Text>
              <Text style={s.hint} numberOfLines={1}>{t.name || '-'}{t.active ? '' : ' · ปิดใช้งาน'}</Text>
            </View>
            <Text style={[s.td, { width: 120 }]} numberOfLines={1}>{branchName(t.branchId)}</Text>
            <View style={{ width: 110 }}>
              <Text style={s.td}>{(t.bills ?? 0).toLocaleString()} ใบ</Text>
              {t.lastBillAt ? <Text style={s.hint} numberOfLines={1}>ล่าสุด {thaiDateTime(t.lastBillAt)}</Text> : null}
            </View>
            <View style={[s.row, { width: 76, gap: 4, justifyContent: 'flex-end' }]}>
              <IconBtn icon="create-outline" label={`แก้ไข ${t.code}`} onPress={() => open(t)} />
              <IconBtn icon="trash-outline" label={`ลบ ${t.code}`} danger disabled={(t.bills ?? 0) > 0} onPress={() => run(() => api.deleteTerminal(t.id), `ลบเครื่อง ${t.code} แล้ว`)} />
            </View>
          </View>
        ))}
      </TableWrap>
      {form ? (
        <View style={s.form}>
          <Text style={s.label}>{form.id ? `แก้ไขเครื่อง ${form.code}` : 'เพิ่มเครื่อง POS'}</Text>
          {!form.id && data.branches.length > 1 ? (
            <Field label="สาขา">
              <Seg
                value={String(form.branchId)}
                options={data.branches.map((b) => [String(b.id), b.name] as [string, string])}
                onChange={(v) => setForm({ ...form, branchId: Number(v), code: nextCode(data.terminals, Number(v)) })}
              />
            </Field>
          ) : null}
          <View style={[s.row, { flexWrap: 'wrap', alignItems: 'flex-start' }]}>
            <Field label="รหัสเครื่อง" hint="อังกฤษ/ตัวเลข ใช้ในเลขที่บิล">
              <TextInput value={form.code} onChangeText={(t) => setForm({ ...form, code: t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) })} autoCapitalize="characters" style={[s.input, { width: 120 }]} />
            </Field>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Field label="หมายเลขเครื่องที่ได้รับอนุมัติจากกรมสรรพากร" hint="ตามหนังสืออนุมัติใช้เครื่องบันทึกการเก็บเงิน">
                <TextInput value={form.rdNo} onChangeText={(t) => setForm({ ...form, rdNo: t.slice(0, 40) })} placeholder="เช่น E05123456789" placeholderTextColor={colors.faint} style={s.input} />
              </Field>
            </View>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Field label="ชื่อเรียก">
                <TextInput value={form.name} onChangeText={(t) => setForm({ ...form, name: t.slice(0, 60) })} placeholder="เช่น แคชเชียร์หน้าร้าน" placeholderTextColor={colors.faint} style={s.input} />
              </Field>
            </View>
          </View>
          {form.id ? <ToggleRow label="ใช้งานเครื่องนี้" hint="ปิด = เลือกเป็นเครื่องขายไม่ได้ (บิลเดิมยังอยู่)" value={form.active} onChange={(v) => setForm({ ...form, active: v })} /> : null}
          <View style={[s.row, { justifyContent: 'flex-end' }]}>
            <Btn label="ยกเลิก" icon="close" onPress={() => setForm(null)} />
            <Btn label={form.id ? 'บันทึก' : 'เพิ่มเครื่อง'} icon="save-outline" primary disabled={!form.code} onPress={submit} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}
/** รหัสเครื่องถัดไปของสาขา: POS01, POS02 … */
function nextCode(list: TaxTerminal[], branchId: number) {
  const used = new Set(list.filter((t) => t.branchId === branchId).map((t) => t.code));
  for (let i = 1; i < 100; i++) {
    const c = `POS${String(i).padStart(2, '0')}`;
    if (!used.has(c)) return c;
  }
  return '';
}

/** เครื่องนี้ (คอมพิวเตอร์/แท็บเล็ตที่เปิดหน้านี้อยู่) ใช้เป็นเครื่อง POS ไหน — เก็บในเครื่อง */
function ThisDeviceCard({ data, notify, onChanged }: { data: TaxAdmin; notify: Notify; onChanged: () => void }) {
  const [list, setList] = useState<TaxTerminal[] | null>(null);
  const [cur, setCur] = useState(getDeviceTerminal());
  useEffect(() => {
    api.branchTerminals().then(setList, () => setList([]));
  }, [data.terminals]);
  const pick = (id: number | null) => {
    setDeviceTerminal(id);
    setCur(id);
    onChanged();
    const t = list?.find((x) => x.id === id);
    notify('success', t ? `เครื่องนี้ = ${t.code}${t.rdNo ? ` (${t.rdNo})` : ''}` : 'เครื่องนี้ไม่ระบุเครื่อง POS');
  };
  const mine = list?.find((x) => x.id === cur);
  return (
    <Card title="เครื่องนี้" icon="phone-portrait-outline">
      <Text style={s.hint}>เลือกว่าคอมพิวเตอร์/แท็บเล็ตที่เปิดอยู่นี้คือเครื่อง POS ไหน (เก็บไว้ในเครื่องนี้ · แต่ละเครื่องเลือกของตัวเอง) — บิลที่ขายจากเครื่องนี้จะบันทึกหมายเลขเครื่องนี้</Text>
      {!list ? <ActivityIndicator color={colors.primary} /> : null}
      {list && list.length === 0 ? <Text style={s.hint}>สาขาที่ใช้งานอยู่ยังไม่มีเครื่อง POS — เพิ่มที่การ์ด “เครื่อง POS” ด้านบน</Text> : null}
      {list && list.length ? (
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {list.map((t) => {
            const on = t.id === cur;
            return (
              <Pressable key={t.id} onPress={() => pick(t.id)} style={[s.devChip, on && s.devOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[s.label, on && { color: colors.primary }]}>{t.code}</Text>
                <Text style={s.hint}>{t.rdNo || 'ไม่มีหมายเลขเครื่อง'}{t.name ? ` · ${t.name}` : ''}</Text>
              </Pressable>
            );
          })}
          {cur ? <Btn label="ไม่ระบุ" icon="close" onPress={() => pick(null)} /> : null}
        </View>
      ) : null}
      <Text style={[s.hint, { color: mine ? colors.success : colors.sub }]}>{mine ? `เครื่องนี้ใช้เป็น ${mine.code}` : 'เครื่องนี้ยังไม่ได้เลือกเครื่อง POS — ขายได้ตามปกติ บิลแค่ไม่ระบุเครื่อง'}</Text>
    </Card>
  );
}

// ---------- ชิ้นส่วนเล็ก ----------
/** ตาราง: จอแคบเลื่อนซ้าย-ขวาได้ (ไม่บีบคอลัมน์จนตัวอักษรตกบรรทัด) */
function TableWrap({ children }: { children: ReactNode }) {
  return (
    <View style={s.table}>
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator>
        <View style={{ flex: 1, minWidth: 560 }}>{children}</View>
      </ScrollView>
    </View>
  );
}
function Card({ title, icon, right, children }: { title: string; icon: IconName; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={s.card}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View style={s.row}>
          <Icon name={icon} size={18} color={colors.primary} />
          <Text style={s.cardTitle}>{title}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6, flexGrow: 1 }}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}
function Btn({ label, icon, onPress, primary, disabled }: { label: string; icon: IconName; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[s.btn, primary && s.btnPrimary, disabled && { opacity: 0.45 }]} onPress={onPress} disabled={disabled} accessibilityLabel={label}>
      <Icon name={icon} size={15} color={primary ? '#fff' : colors.primary} />
      <Text style={[s.btnText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}
function IconBtn({ icon, label, onPress, danger, disabled }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[s.iconBtn, disabled && { opacity: 0.3 }]} onPress={onPress} disabled={disabled} accessibilityLabel={label}>
      <Icon name={icon} size={16} color={danger ? colors.danger : colors.sub} />
    </Pressable>
  );
}
function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[s.track, value && s.trackOn]} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={[s.knob, value && { transform: [{ translateX: 18 }] }]} />
    </Pressable>
  );
}
function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable style={s.toggleRow} onPress={() => onChange(!value)}>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onChange={onChange} />
    </Pressable>
  );
}
function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <View style={s.seg}>
      {options.map(([v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)} style={[s.segBtn, v === value && s.segOn]} accessibilityRole="button">
          <Text style={[s.segText, v === value && { color: '#fff', fontWeight: '600' }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { fontFamily: font, color: colors.danger, padding: 12 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, gap: 12, backgroundColor: '#fff' },
  cardTitle: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text },
  label: { fontFamily: font, fontSize: 13, fontWeight: '600', color: colors.text },
  hint: { fontFamily: font, fontSize: 11.5, color: colors.sub, lineHeight: 17 },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  inputOk: { borderColor: colors.success },
  inputBad: { borderColor: colors.danger },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  status: { borderWidth: 1, borderColor: '#F5D9A8', backgroundColor: '#FFF8EC', borderRadius: radius.lg, padding: 12, gap: 8 },
  statusTitle: { fontFamily: font, fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  checks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  branchRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F3F6' },
  table: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F3F6' },
  th: { backgroundColor: colors.surface, borderTopWidth: 0 },
  thText: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.sub },
  td: { fontFamily: font, fontSize: 13, color: colors.text },
  form: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontFamily: font, fontSize: 12.5, fontWeight: '600', color: colors.primary },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  track: { width: 42, height: 24, borderRadius: 12, backgroundColor: colors.line, padding: 3 },
  trackOn: { backgroundColor: colors.success },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F3F6' },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 3, gap: 2, flexWrap: 'wrap' },
  segBtn: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.primary },
  segText: { fontFamily: font, fontSize: 12.5, color: colors.text },
  devChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', minWidth: 140, gap: 2 },
  devOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
