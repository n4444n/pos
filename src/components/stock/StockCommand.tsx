// สต็อก: รับเข้า/ตัดออกจำนวนมากด้วยการสแกนบาร์โค้ด
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { n0 } from '../../format';
import { fileToCommandText, pickFile } from '../../sheetImport';
import { colors, font, radius } from '../../theme';
import type { StockCmdMode, StockCmdResult } from '../../types';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';

const MODES: { id: StockCmdMode; label: string; hint: string }[] = [
  { id: 'check', label: 'เช็คสต็อก', hint: 'เทียบจำนวนที่นับได้กับในระบบ (ไม่แก้ข้อมูล)' },
  { id: 'add', label: 'เพิ่ม/ลบ สต็อก', hint: 'บวกเพิ่มจากยอดเดิม · ใส่ติดลบเพื่อลด เช่น 118-002 -2' },
  { id: 'set', label: 'ปรับสต็อกใหม่', hint: 'ตั้งยอดคงเหลือใหม่ทับยอดเดิม' },
];

interface ParsedLine { code: string; qty: number; line: number }

/** แยกข้อความ "[บาร์โค้ด] [จำนวน]" บรรทัดละรายการ (คั่นด้วยเว้นวรรค/จุลภาค/แท็บ) — ไม่ใส่จำนวน = 1 */
function parse(text: string): { lines: ParsedLine[]; bad: { line: number; text: string }[] } {
  const lines: ParsedLine[] = [];
  const bad: { line: number; text: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    const [code, qtyText, ...rest] = t.split(/[\s,;\t]+/);
    if (qtyText === undefined) return lines.push({ code, qty: 1, line: i + 1 });
    const qty = Number(qtyText.replace(/^\+/, ''));
    if (!Number.isInteger(qty) || rest.length) {
      // แถวหัวตาราง (เช่น "รหัส SKU จำนวน") ข้ามได้
      if (i === 0 && !/\d/.test(qtyText)) return;
      return bad.push({ line: i + 1, text: t });
    }
    lines.push({ code, qty, line: i + 1 });
  });
  return { lines, bad };
}

interface Props {
  manager: boolean;
  compact: boolean;
  notify: (kind: 'success' | 'error' | 'info', text: string) => void;
  /** ยืนยันแก้สต็อกแล้ว → โหลดตารางใหม่ */
  onApplied: () => void;
}

/** คำสั่งพิเศษ: เช็คสต็อก · เพิ่ม/ลบ สต็อก · ปรับสต็อกใหม่ จากข้อความ [บาร์โค้ด] [จำนวน] หรือไฟล์ Excel/CSV */
export function StockCommand({ manager, compact, notify, onApplied }: Props) {
  const modes = manager ? MODES : MODES.filter((m) => m.id === 'check');
  const [mode, setMode] = useState<StockCmdMode>('check');
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StockCmdResult | null>(null);
  const [parseBad, setParseBad] = useState<{ line: number; text: string }[]>([]);
  const [lastLines, setLastLines] = useState<ParsedLine[]>([]);
  const cur = MODES.find((m) => m.id === mode)!;
  const count = parse(text).lines.length;

  const run = async (m: StockCmdMode = mode, apply = false, linesArg?: ParsedLine[]) => {
    const parsed = linesArg ? { lines: linesArg, bad: [] } : parse(text);
    if (!parsed.lines.length) return notify('info', 'พิมพ์หรือสแกน [บาร์โค้ด] [จำนวน] บรรทัดละ 1 รายการ เช่น 118-002 5');
    setBusy(true);
    try {
      const r = await api.stockCommand(m, parsed.lines, apply);
      if (apply) {
        notify('success', `${MODES.find((x) => x.id === m)!.label}: อัปเดต ${r.applied ?? 0} SKU แล้ว`);
        setResult(null);
        setText('');
        onApplied();
      } else {
        setResult(r);
        setParseBad(parsed.bad);
        setLastLines(parsed.lines);
      }
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async () => {
    const f = await pickFile('.xlsx,.csv,.txt');
    if (!f) return;
    try {
      const t = await fileToCommandText(f);
      const n = parse(t).lines.length;
      if (!n) return notify('error', 'ไม่พบข้อมูลในไฟล์ — คอลัมน์ A = บาร์โค้ด/รหัส SKU, คอลัมน์ B = จำนวน');
      setText((old) => (old.trim() ? `${old.trim()}\n${t}` : t));
      notify('success', `นำเข้า ${n} รายการจาก ${f.name}`);
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  const onKey = (e: { nativeEvent: { key: string; ctrlKey?: boolean; metaKey?: boolean } }) => {
    if (e.nativeEvent.key === 'Enter' && (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey)) run();
  };

  const totalErrors = (result?.summary.errors ?? 0) + parseBad.length;

  return (
    <View style={[s.box, compact && { flexDirection: 'column' }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          onKeyPress={Platform.OS === 'web' ? (onKey as never) : undefined}
          multiline
          placeholder="สแกน/พิมพ์ [บาร์โค้ด] [จำนวน] บรรทัดละรายการ เช่น 118-002 5"
          placeholderTextColor={colors.faint}
          style={s.area}
          autoCapitalize="characters"
          autoFocus
          accessibilityLabel="คำสั่งพิเศษ บาร์โค้ด จำนวน"
        />
        <Text style={s.hint}>{cur.hint} · ไม่ใส่จำนวน = 1 · รหัสซ้ำจะรวมกัน · Ctrl+Enter = RUN{count ? ` · ${count} รายการ` : ''}</Text>
      </View>
      <View style={[s.side, compact && { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }]}>
        <View style={s.row}>
          <View style={s.group}>
            <Pressable style={s.modeBtn} onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel={`คำสั่ง ${cur.label}`}>
              <Text style={s.modeText} numberOfLines={1}>{cur.label}</Text>
              <Icon name="caret-down" size={11} color={colors.text} />
            </Pressable>
            <Pressable style={[s.runBtn, busy && { opacity: 0.6 }]} onPress={() => run()} disabled={busy} accessibilityLabel="RUN">
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.runText}>RUN</Text>}
            </Pressable>
          </View>
          <Pressable style={s.clearBtn} onPress={() => setText('')} accessibilityLabel="ล้างคำสั่ง">
            <Icon name="close" size={16} color={colors.text} />
          </Pressable>
        </View>
        <View style={s.row}>
          <Text style={s.format}>[บาร์โค้ด] [จำนวน]</Text>
          {Platform.OS === 'web' ? (
            <Pressable style={s.importBtn} onPress={importFile} accessibilityLabel="นำเข้าไฟล์ Excel หรือ CSV">
              <Icon name="document-attach-outline" size={16} color={colors.success} />
              <Text style={s.importText}>นำเข้า</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* เลือกคำสั่ง */}
      <Sheet visible={menu} onClose={() => setMenu(false)} title="คำสั่งพิเศษ" width={380}>
        <View style={{ gap: 6, paddingBottom: 8 }}>
          {modes.map((m) => (
            <Pressable
              key={m.id}
              style={[s.opt, mode === m.id && s.optOn]}
              onPress={() => {
                setMode(m.id);
                setMenu(false);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.optText, mode === m.id && { color: colors.primary, fontWeight: '700' }]}>{m.label}</Text>
                <Text style={s.hint}>{m.hint}</Text>
              </View>
              {mode === m.id ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
            </Pressable>
          ))}
          {!manager ? <Text style={s.hint}>เพิ่ม/ลบ และปรับสต็อกใหม่ ใช้ได้เฉพาะผู้จัดการ</Text> : null}
        </View>
      </Sheet>

      {/* ผลลัพธ์ */}
      {result ? (
        <Sheet
          visible
          onClose={() => setResult(null)}
          title={`ผล${MODES.find((m) => m.id === result.mode)!.label}`}
          width={760}
          footer={
            <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 }]}>
              <Pressable style={s.ghost} onPress={() => setResult(null)}>
                <Text style={s.ghostText}>{result.mode === 'check' ? 'ปิด' : 'ยกเลิก'}</Text>
              </Pressable>
              {result.mode === 'check' && manager && result.rows.some((r) => r.diff !== 0) ? (
                <Pressable
                  style={[s.primary, { backgroundColor: '#B26A00' }, (busy || totalErrors > 0) && { opacity: 0.45 }]}
                  disabled={busy || totalErrors > 0}
                  onPress={() => run('set', true, lastLines)}
                >
                  <Text style={s.primaryText}>ปรับยอดตามที่นับ ({result.rows.filter((r) => r.diff !== 0).length} SKU)</Text>
                </Pressable>
              ) : null}
              {result.mode !== 'check' ? (
                <Pressable
                  style={[s.primary, (busy || totalErrors > 0 || !result.rows.some((r) => r.diff !== 0)) && { opacity: 0.45 }]}
                  disabled={busy || totalErrors > 0 || !result.rows.some((r) => r.diff !== 0)}
                  onPress={() => run(result.mode, true, lastLines)}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>ยืนยัน{result.mode === 'add' ? 'เพิ่ม/ลบ' : 'ปรับ'}สต็อก ({result.rows.filter((r) => r.diff !== 0).length} SKU)</Text>}
                </Pressable>
              ) : null}
            </View>
          }
        >
          <View style={{ gap: 10 }}>
            <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
              <Chip text={`${n0(result.summary.skus)} SKU`} />
              <Chip text={`${result.mode === 'add' ? 'รวม ' : ''}${n0(result.summary.units)} ชิ้น`} />
              {result.mode === 'check' ? (
                <>
                  <Chip text={`ตรง ${result.summary.match}`} tone="ok" />
                  <Chip text={`เกิน ${result.summary.over}`} tone="warn" />
                  <Chip text={`ขาด ${result.summary.short}`} tone="bad" />
                </>
              ) : null}
              {totalErrors ? <Chip text={`ผิดพลาด ${totalErrors}`} tone="bad" /> : null}
            </View>

            {totalErrors ? (
              <View style={s.errBox}>
                {parseBad.map((b) => (
                  <Text key={`p${b.line}`} style={s.errText}>บรรทัด {b.line}: “{b.text}” — รูปแบบไม่ถูกต้อง (ต้องเป็น [บาร์โค้ด] [จำนวน])</Text>
                ))}
                {result.errors.map((e) => (
                  <Text key={`e${e.line}`} style={s.errText}>บรรทัด {e.line}: {e.code} — {e.error}</Text>
                ))}
                {result.rows.filter((r) => r.error).map((r) => (
                  <Text key={`r${r.id}`} style={s.errText}>{r.input} · {r.name} ({r.label}) — {r.error}</Text>
                ))}
              </View>
            ) : null}

            {!compact ? (
              <View style={s.thead}>
                <Text style={[s.th, { flex: 1.1 }]}>บาร์โค้ด</Text>
                <Text style={[s.th, { flex: 2 }]}>สินค้า · สี/ไซซ์</Text>
                <Text style={[s.th, s.num]}>ในระบบ</Text>
                <Text style={[s.th, s.num]}>{result.mode === 'check' ? 'นับได้' : result.mode === 'add' ? '+/-' : 'ยอดใหม่'}</Text>
                <Text style={[s.th, s.num]}>{result.mode === 'check' ? 'ต่าง' : 'หลังทำ'}</Text>
              </View>
            ) : null}
            <ScrollView style={{ maxHeight: 380 }}>
              {result.rows.map((r) => {
                const toneColor = r.error ? colors.danger : r.diff === 0 ? colors.success : r.diff > 0 ? '#B26A00' : colors.danger;
                const last = result.mode === 'check' ? (r.diff > 0 ? `+${r.diff}` : r.diff === 0 ? 'ตรง' : `${r.diff}`) : n0(r.after);
                const mid = result.mode === 'add' ? (r.qty > 0 ? `+${r.qty}` : `${r.qty}`) : n0(r.qty);
                return compact ? (
                  <View key={r.id} style={s.card}>
                    <Text style={s.code}>{r.input}</Text>
                    <Text style={s.name} numberOfLines={1}>{r.name} · {r.label}</Text>
                    <Text style={s.sub}>
                      ในระบบ {n0(r.before)} · {result.mode === 'check' ? 'นับได้' : result.mode === 'add' ? '+/-' : 'ยอดใหม่'} {mid} ·{' '}
                      <Text style={{ color: toneColor, fontWeight: '700' }}>{result.mode === 'check' ? last : `หลังทำ ${last}`}</Text>
                    </Text>
                  </View>
                ) : (
                  <View key={r.id} style={[s.tr, r.error && { backgroundColor: '#FFF5F5' }]}>
                    <Text style={[s.code, { flex: 1.1 }]} numberOfLines={1}>{r.input}</Text>
                    <View style={{ flex: 2, minWidth: 0 }}>
                      <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                      <Text style={s.sub} numberOfLines={1}>#{r.code} · {r.label}{r.lines.length > 1 ? ` · รวม ${r.lines.length} บรรทัด` : ''}</Text>
                    </View>
                    <Text style={[s.cell, s.num]}>{n0(r.before)}</Text>
                    <Text style={[s.cell, s.num]}>{mid}</Text>
                    <Text style={[s.cell, s.num, { color: toneColor, fontWeight: '700' }]}>{last}</Text>
                  </View>
                );
              })}
              {!result.rows.length ? <Text style={[s.sub, { textAlign: 'center', marginVertical: 16 }]}>ไม่มีรายการที่ใช้ได้</Text> : null}
            </ScrollView>
            {result.mode !== 'check' ? <Text style={s.hint}>ยืนยันแล้วระบบจะคำนวณจากยอดล่าสุด ณ ตอนกดยืนยัน และบันทึกประวัติการปรับสต็อก</Text> : null}
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

function Chip({ text, tone }: { text: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const c = tone === 'ok' ? [colors.successSoft, colors.success] : tone === 'warn' ? ['#FFF4E0', '#B26A00'] : tone === 'bad' ? [colors.dangerSoft, colors.danger] : [colors.surface, colors.text];
  return (
    <View style={{ backgroundColor: c[0], paddingHorizontal: 10, height: 26, borderRadius: radius.pill, justifyContent: 'center' }}>
      <Text style={{ fontFamily: font, fontSize: 12, fontWeight: '600', color: c[1] }}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FBFCFE' },
  area: { fontFamily: font, fontSize: 13, color: colors.text, minHeight: 64, maxHeight: 140, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: 'top', letterSpacing: 0.3 },
  hint: { fontFamily: font, fontSize: 11, color: colors.sub },
  side: { gap: 8, justifyContent: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  group: { flexDirection: 'row', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, backgroundColor: '#fff', minWidth: 128 },
  modeText: { fontFamily: font, fontSize: 13, color: colors.text, flex: 1 },
  runBtn: { height: 36, paddingHorizontal: 14, backgroundColor: '#1E9BE9', alignItems: 'center', justifyContent: 'center' },
  runText: { fontFamily: font, fontSize: 13, color: '#fff', fontWeight: '700', letterSpacing: 0.5 },
  clearBtn: { width: 40, height: 36, borderRadius: radius.sm, backgroundColor: '#E9ECEF', alignItems: 'center', justifyContent: 'center' },
  format: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.text },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: '#EEF0F2' },
  importText: { fontFamily: font, fontSize: 13, color: colors.text },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  optOn: { backgroundColor: colors.primarySoft },
  optText: { fontFamily: font, fontSize: 14, color: colors.text },
  errBox: { backgroundColor: '#FFF5F5', borderRadius: radius.sm, padding: 10, gap: 3, borderWidth: 1, borderColor: '#F7C9CB' },
  errText: { fontFamily: font, fontSize: 12, color: colors.danger },
  thead: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, height: 32, alignItems: 'center', borderRadius: radius.sm, backgroundColor: colors.surface },
  th: { fontFamily: font, fontSize: 12, fontWeight: '700', color: colors.sub },
  num: { width: 70, textAlign: 'right' },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  code: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
  name: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  sub: { fontFamily: font, fontSize: 11, color: colors.sub },
  cell: { fontFamily: font, fontSize: 13, color: colors.text },
  card: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0F2F5', gap: 2 },
  ghost: { height: 44, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  ghostText: { fontFamily: font, fontSize: 14, color: colors.text },
  primary: { height: 44, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: font, fontSize: 14, color: '#fff', fontWeight: '700' },
});
