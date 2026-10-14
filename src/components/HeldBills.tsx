// พักบิล / เรียกคืนบิล — ลูกค้าไปแลกเงินแล้วจะกลับมาจ่าย → ขายให้คนต่อไปก่อน
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeldBill } from '../api';
import { baht } from '../format';
import type { Pos } from '../store/usePos';
import { colors, font, radius } from '../theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const NOTES = ['ไปแลกเงิน', 'ไปกดเงิน ATM', 'ลืมกระเป๋าเงิน', 'ไปเลือกเพิ่ม', 'ลองชุด'];

function ago(s: string) {
  const t = new Date(s.replace(' ', 'T')).getTime();
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ชม. ${min % 60} นาทีที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  pos: Pos;
}

export function HeldBillsSheet({ visible, onClose, pos }: Props) {
  const [customer, setCustomer] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRecall, setConfirmRecall] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const hasCart = pos.cart.length > 0;

  useEffect(() => {
    if (!visible) return;
    setCustomer(pos.customerName);
    setNote('');
    setError(null);
    setConfirmRecall(null);
    setConfirmDel(null);
    pos.refreshHeld();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      pos.refreshHeld();
    } finally {
      setBusy(null);
    }
  };

  const hold = () =>
    run('hold', async () => {
      const b = await pos.holdCurrent(note.trim(), customer.trim());
      if (b) {
        pos.notify('success', `พักบิล${b.customerName ? ` ${b.customerName}` : ` #${b.id}`} แล้ว · ${baht(b.total)} — ขายคนต่อไปได้เลย`);
        onClose();
      }
    });

  const recall = (b: HeldBill, holdFirst: boolean) =>
    run(`recall${b.id}`, async () => {
      if (holdFirst) await pos.holdCurrent('', pos.customerName);
      const r = await pos.recallHeld(b.id);
      pos.notify('success', `เรียกคืนบิล${r.customerName ? ` ${r.customerName}` : ` #${r.id}`} · ${r.itemCount} ชิ้น ${baht(r.total)}`);
      onClose();
    });

  const items = pos.rows;
  return (
    <Sheet visible={visible} onClose={onClose} title="พักบิล / เรียกคืนบิล" width={560}>
      <ScrollView style={{ maxHeight: 640 }} contentContainerStyle={{ gap: 12, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
        {/* ---------- พักบิลปัจจุบัน ---------- */}
        {hasCart ? (
          <View style={s.holdCard}>
            <View style={s.row}>
              <View style={s.holdIcon}><Icon name="pause" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>พักบิลปัจจุบัน</Text>
                <Text style={s.sub}>{pos.itemCount} ชิ้น · {baht(pos.totals.total)} — ตะกร้าจะว่าง ขายคนต่อไปได้ทันที</Text>
              </View>
            </View>
            <Text style={s.sub} numberOfLines={2}>
              {items.slice(0, 4).map((r) => `${r.product.name} ×${r.line.qty}`).join(' · ')}{items.length > 4 ? ` และอีก ${items.length - 4} รายการ` : ''}
            </Text>
            <TextInput
              value={customer}
              onChangeText={setCustomer}
              placeholder="ชื่อลูกค้า / จุดสังเกต เช่น เสื้อแดง"
              placeholderTextColor={colors.faint}
              style={s.input}
              maxLength={80}
              autoFocus
              onSubmitEditing={hold}
              accessibilityLabel="ชื่อลูกค้าหรือจุดสังเกต"
            />
            <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
              {NOTES.map((n) => (
                <Pressable key={n} onPress={() => setNote(note === n ? '' : n)} style={[s.chip, note === n && s.chipOn]}>
                  <Text style={[s.chipText, note === n && { color: '#fff', fontWeight: '600' }]}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={note} onChangeText={setNote} placeholder="หมายเหตุ (ไม่บังคับ)" placeholderTextColor={colors.faint} style={s.input} maxLength={200} />
            <Pressable style={[s.btn, s.primary]} onPress={hold} disabled={!!busy} accessibilityLabel="พักบิลนี้">
              {busy === 'hold' ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Icon name="pause-circle-outline" size={19} color="#fff" />
                  <Text style={s.primaryText}>พักบิลนี้</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}

        {/* ---------- บิลที่พักไว้ ---------- */}
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={s.title}>บิลที่พักไว้ ({pos.held.length})</Text>
          <Text style={s.sub}>เรียงจากพักก่อน</Text>
        </View>
        {pos.held.length === 0 ? (
          <View style={s.empty}>
            <Icon name="receipt-outline" size={30} color={colors.faint} />
            <Text style={s.sub}>ยังไม่มีบิลที่พักไว้</Text>
          </View>
        ) : null}
        {pos.held.map((b) => {
          const old = Date.now() - new Date(b.createdAt.replace(' ', 'T')).getTime() > 3 * 3600_000;
          return (
            <View key={b.id} style={s.bill}>
              <View style={[s.row, { alignItems: 'flex-start' }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                    <Text style={s.billName} numberOfLines={1}>{b.customerName || `บิลพัก #${b.id}`}</Text>
                    {b.note ? <View style={s.noteTag}><Text style={s.noteText}>{b.note}</Text></View> : null}
                  </View>
                  <Text style={[s.sub, old && { color: '#B26A00' }]}>
                    พักไว้ {ago(b.createdAt)} · {b.createdAt.slice(11, 16)} น. · โดย {b.staff}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.total}>{baht(b.total)}</Text>
                  <Text style={s.sub}>{b.itemCount} ชิ้น</Text>
                </View>
              </View>
              <View style={s.itemsBox}>
                {b.items.slice(0, 5).map((it, i) => (
                  <View key={i} style={[s.row, { justifyContent: 'space-between' }]}>
                    <Text style={[s.itemText, { flex: 1 }]} numberOfLines={1}>{it.name} <Text style={s.sub}>{it.label}</Text></Text>
                    <Text style={s.itemText}>×{it.qty}</Text>
                  </View>
                ))}
                {b.items.length > 5 ? <Text style={s.sub}>และอีก {b.items.length - 5} รายการ</Text> : null}
              </View>

              {confirmRecall === b.id ? (
                <View style={s.confirm}>
                  <Text style={[s.sub, { color: '#8A5300' }]}>ตะกร้ามีสินค้าอยู่ {pos.itemCount} ชิ้น — พักบิลนั้นไว้ก่อน แล้วเรียกคืนบิลนี้?</Text>
                  <View style={[s.row, { justifyContent: 'flex-end' }]}>
                    <Pressable style={[s.btnSm, s.ghost]} onPress={() => setConfirmRecall(null)}><Text style={s.ghostText}>ยกเลิก</Text></Pressable>
                    <Pressable style={[s.btnSm, s.primary]} onPress={() => recall(b, true)} disabled={!!busy}>
                      {busy === `recall${b.id}` ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>พักบิลปัจจุบัน & เรียกคืน</Text>}
                    </Pressable>
                  </View>
                </View>
              ) : confirmDel === b.id ? (
                <View style={[s.confirm, { backgroundColor: colors.dangerSoft }]}>
                  <Text style={[s.sub, { color: colors.danger }]}>ลบบิลที่พักไว้นี้? (ลูกค้าไม่กลับมาแล้ว)</Text>
                  <View style={[s.row, { justifyContent: 'flex-end' }]}>
                    <Pressable style={[s.btnSm, s.ghost]} onPress={() => setConfirmDel(null)}><Text style={s.ghostText}>ไม่ลบ</Text></Pressable>
                    <Pressable
                      style={[s.btnSm, { backgroundColor: colors.danger }]}
                      onPress={() => run(`del${b.id}`, async () => { await pos.deleteHeld(b.id); setConfirmDel(null); pos.notify('success', 'ลบบิลที่พักไว้แล้ว'); })}
                      disabled={!!busy}
                    >
                      {busy === `del${b.id}` ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>ลบบิล</Text>}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={[s.row, { justifyContent: 'flex-end' }]}>
                  <Pressable style={[s.btnSm, s.ghost]} onPress={() => setConfirmDel(b.id)} accessibilityLabel={`ลบบิลพัก ${b.customerName || b.id}`}>
                    <Icon name="trash-outline" size={15} color={colors.danger} />
                  </Pressable>
                  <Pressable
                    style={[s.btnSm, s.primary, { paddingHorizontal: 18 }]}
                    onPress={() => (hasCart ? setConfirmRecall(b.id) : recall(b, false))}
                    disabled={!!busy}
                    accessibilityLabel={`เรียกคืนบิล ${b.customerName || b.id}`}
                  >
                    {busy === `recall${b.id}` ? <ActivityIndicator color="#fff" /> : (
                      <>
                        <Icon name="play-circle-outline" size={17} color="#fff" />
                        <Text style={s.primaryText}>เรียกคืน</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
        <Text style={[s.sub, { textAlign: 'center' }]}>บิลที่พักไว้ยังไม่ตัดสต็อก — ระบบตรวจสต็อกอีกครั้งตอนเรียกคืน · เครื่องอื่นในสาขาเดียวกันเรียกคืนได้</Text>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontFamily: font, fontSize: 12, color: colors.sub, lineHeight: 18 },
  error: { fontFamily: font, fontSize: 13, color: colors.danger },
  holdCard: { gap: 10, padding: 14, borderRadius: radius.lg, borderWidth: 1.5, borderColor: '#D6E1FF', backgroundColor: '#F8FAFF' },
  holdIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, backgroundColor: '#fff' },
  chip: { paddingHorizontal: 12, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: font, fontSize: 12, color: colors.text },
  btn: { height: 50, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSm: { height: 40, minWidth: 44, paddingHorizontal: 12, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primary: { backgroundColor: colors.primary },
  primaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '600' },
  ghost: { borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#fff' },
  ghostText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 20 },
  bill: { gap: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  billName: { fontFamily: font, fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  noteTag: { paddingHorizontal: 8, height: 22, borderRadius: radius.pill, backgroundColor: '#FFF4E0', justifyContent: 'center' },
  noteText: { fontFamily: font, fontSize: 11, color: '#B26A00', fontWeight: '600' },
  total: { fontFamily: font, fontSize: 17, fontWeight: '700', color: colors.text },
  itemsBox: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 10, gap: 3 },
  itemText: { fontFamily: font, fontSize: 12, color: colors.text },
  confirm: { gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: '#FFF4E0' },
});
