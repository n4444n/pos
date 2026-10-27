// ออกใบกำกับภาษีเต็มรูปจากบิลที่คิด VAT — ลูกค้าแจ้งชื่อ / ที่อยู่ / เลขประจำตัวผู้เสียภาษี / สาขา
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { api } from '../../api';
import { baht, validTaxId } from '../../format';
import { printTaxDoc } from '../../print';
import type { Toast } from '../../store/usePos';
import { colors, font, radius } from '../../theme';
import type { OrderDetail } from '../../types';
import { Sheet } from '../Sheet';
import { Chips, FieldLabel } from './Chips';

interface Props {
  visible: boolean;
  order: OrderDetail;
  onClose: () => void;
  onDone: () => void;
  notify: (kind: Toast['kind'], text: string) => void;
}


type Kind = 'hq' | 'branch' | 'person';

export function TaxInvoiceDialog({ visible, order, onClose, onDone, notify }: Props) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [kind, setKind] = useState<Kind>('hq');
  const [branchNo, setBranchNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(order.customerName ?? '');
      setAddress('');
      setTaxId('');
      setKind('hq');
      setBranchNo('');
      setError(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const taxOk = validTaxId(taxId);
  const branchOk = kind !== 'branch' || /^\d{5}$/.test(branchNo);
  const ready = name.trim() && address.trim() && taxOk && branchOk;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = await api.issueTaxInvoice(order.id, {
        buyerName: name.trim(),
        buyerAddress: address.trim(),
        buyerTaxId: taxId,
        buyerBranch: kind === 'hq' ? '00000' : kind === 'branch' ? branchNo : '',
      });
      notify('success', `ออกใบกำกับภาษีเต็มรูป ${doc.docNo} แล้ว`);
      printTaxDoc({ kind: 'invoice', doc });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="ออกใบกำกับภาษีเต็มรูป"
      width={500}
      footer={
        <Pressable style={[s.btn, !ready && { opacity: 0.45 }]} disabled={!ready || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>ออกใบกำกับภาษี · {baht(order.total)}</Text>}
        </Pressable>
      }
    >
      <Text style={s.note}>
        อ้างอิงบิล {order.orderNo} · VAT {baht(order.vat)} — ได้เลขที่ใหม่ (TIV-…) แยกจากบิลขาย · บิลละ 1 ใบ (ข้อมูลผิด ให้ยกเลิกแล้วออกใหม่)
      </Text>

      <FieldLabel required>ชื่อผู้ซื้อ / ชื่อบริษัท</FieldLabel>
      <TextInput value={name} onChangeText={setName} placeholder="เช่น บริษัท ตัวอย่าง จำกัด" placeholderTextColor={colors.faint} style={s.input} maxLength={160} />

      <FieldLabel required>ที่อยู่</FieldLabel>
      <TextInput
        value={address}
        onChangeText={setAddress}
        placeholder="เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
        placeholderTextColor={colors.faint}
        style={[s.input, { height: 64, paddingTop: 10, textAlignVertical: 'top' }]}
        multiline
        maxLength={400}
      />

      <FieldLabel required>เลขประจำตัวผู้เสียภาษี (13 หลัก)</FieldLabel>
      <TextInput
        value={taxId}
        onChangeText={(t) => setTaxId(t.replace(/[^0-9]/g, '').slice(0, 13))}
        placeholder="0000000000000"
        placeholderTextColor={colors.faint}
        keyboardType="number-pad"
        style={[s.input, s.mono]}
        maxLength={13}
      />
      {taxId.length === 13 && !taxOk ? <Text style={s.error}>เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (เลขตรวจสอบหลักสุดท้ายไม่ตรง)</Text> : null}

      <FieldLabel>สถานประกอบการของผู้ซื้อ</FieldLabel>
      <Chips
        options={[
          { value: 'hq' as Kind, label: 'สำนักงานใหญ่' },
          { value: 'branch' as Kind, label: 'สาขาที่…' },
          { value: 'person' as Kind, label: 'บุคคลธรรมดา' },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === 'branch' ? (
        <TextInput
          value={branchNo}
          onChangeText={(t) => setBranchNo(t.replace(/[^0-9]/g, '').slice(0, 5))}
          placeholder="เลขสาขา 5 หลัก เช่น 00001"
          placeholderTextColor={colors.faint}
          keyboardType="number-pad"
          style={[s.input, s.mono]}
          maxLength={5}
        />
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { fontFamily: font, fontSize: 12, color: colors.sub, backgroundColor: colors.surface, padding: 10, borderRadius: radius.md, lineHeight: 18 },
  input: { fontFamily: font, fontSize: 13, color: colors.text, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12, marginTop: 6 },
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
  error: { fontFamily: font, fontSize: 12.5, color: colors.danger, marginTop: 8 },
  btn: { height: 50, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font, fontSize: 15, color: '#fff', fontWeight: '600' },
});
