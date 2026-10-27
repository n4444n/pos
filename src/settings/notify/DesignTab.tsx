// การแจ้งเตือน → แท็บหน้าตาการ์ด LINE (ข้อความ · สี · โลโก้) + ตัวอย่าง
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { AdminSettings, NotifyEventInfo, NotifyEventKey } from '../../api';
import { FlexCard } from '../../components/notify/FlexCard';
import { Icon } from '../../components/Icon';
import { colors } from '../../theme';
import { Card, Field, Grid, Input, Seg, SmallBtn, Toggle, type Upd, s } from '../ui';
import type { TestFn } from './NotifySection';

const EMOJIS = ['🛍️', '💰', '🧾', '🚫', '✏️', '📦', '⛔', '🔓', '🔒', '💵', '📊', '🎉', '⚠️', '✅', '🔔', '⭐'];

const SWATCHES = ['#2F6BFF', '#06C755', '#1F9D63', '#0E9AA7', '#6B4EFF', '#D23B7E', '#E5484D', '#C62828', '#D98200', '#F5A524', '#1B1F27', '#64748B'];

type FocusField = { f: 'title' | 'subtitle' | 'footer' | 'itemsTitle' } | { f: 'label' | 'value'; i: number };

export function DesignTab({ v, set, catalog, test, testing, lineOn }: {
  v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; catalog: NotifyEventInfo[]; test: TestFn; testing: string | null; lineOn: boolean;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 1250;
  const [key, setKey] = useState<NotifyEventKey>('sale');
  const [focus, setFocus] = useState<FocusField>({ f: 'title' });
  const info = catalog.find((e) => e.key === key);
  const tpl = v.templates[key];
  const st = v.style;
  if (!info || !tpl) return <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />;

  const setTpl = (x: Partial<typeof tpl>) => set({ templates: { ...v.templates, [key]: { ...tpl, ...x } } });
  const setStyle = (x: Partial<typeof st>) => set({ style: { ...st, ...x } });
  const setLine = (i: number, x: Partial<{ label: string; value: string }>) => setTpl({ lines: tpl.lines.map((l, j) => (j === i ? { ...l, ...x } : l)) });
  const moveLine = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= tpl.lines.length) return;
    const lines = [...tpl.lines];
    [lines[i], lines[j]] = [lines[j], lines[i]];
    setTpl({ lines });
  };
  const insert = (ph: string) => {
    const token = `{${ph}}`;
    if (focus.f === 'label' || focus.f === 'value') {
      const l = tpl.lines[focus.i];
      if (l) return setLine(focus.i, { [focus.f]: (l[focus.f] + token).slice(0, focus.f === 'label' ? 60 : 200) });
      return setTpl({ title: tpl.title + token });
    }
    setTpl({ [focus.f]: (tpl[focus.f] + token).slice(0, 160) } as Partial<typeof tpl>);
  };
  const vars = { ...info.sample, time: info.sample.time || '' };
  const focusName = focus.f === 'title' ? 'หัวเรื่อง' : focus.f === 'subtitle' ? 'บรรทัดรอง' : focus.f === 'footer' ? 'ท้ายการ์ด' : focus.f === 'itemsTitle' ? 'หัวข้อรายการ' : `บรรทัดที่ ${'i' in focus ? focus.i + 1 : ''}`;
  const isDefault = JSON.stringify(tpl) === JSON.stringify(info.defaultTemplate);

  const preview = (
    <View style={{ gap: 8 }}>
      <FlexCard tpl={tpl} style={st} vars={vars} items={info.hasItems ? info.sampleItems : []} />
      <Text style={[s.hint, { textAlign: 'center' }]}>ตัวอย่างด้วยข้อมูลสมมุติ · ข้อความจริงใช้ข้อมูลจากบิล/กะ/สินค้า</Text>
      <SmallBtn
        label={lineOn ? `ส่งตัวอย่าง “${info.label}” ไป LINE` : 'ตั้งค่า LINE ก่อนส่งตัวอย่าง'}
        icon="paper-plane-outline"
        busy={testing === 'line' + key}
        disabled={!lineOn}
        onPress={() => test('line', key)}
      />
    </View>
  );

  return (
    <>
      <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
        {catalog.map((e) => {
          const on = e.key === key;
          return (
            <Pressable key={e.key} onPress={() => { setKey(e.key); setFocus({ f: 'title' }); }} style={[s.evChip, on && s.evChipOn]}>
              <Text style={{ fontSize: 14 }}>{v.templates[e.key]?.emoji || '🔔'}</Text>
              <Text style={[s.chText, on && { color: '#fff', fontWeight: '700' }]}>{e.label}</Text>
              {!v.events[e.key]?.on ? <Text style={[s.hint, on && { color: '#DCE6FF' }]}>(ปิด)</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={[{ gap: 12 }, wide && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <Card title={`ข้อความในการ์ด: ${info.label}`}>
            <View style={s.phBox}>
              <Text style={s.hint}>แตะตัวแปรเพื่อแทรกลงใน <Text style={{ fontWeight: '700', color: colors.primary }}>{focusName}</Text> (ช่องที่เลือกล่าสุด) — ตัวแปรจะถูกแทนด้วยข้อมูลจริงตอนส่ง</Text>
              <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                {info.placeholders.map(([k, label]) => (
                  <Pressable key={k} onPress={() => insert(k)} style={s.phChip} accessibilityLabel={`แทรก ${label}`}>
                    <Text style={s.phText}>{label}</Text>
                    <Text style={[s.code, { fontSize: 10, color: colors.sub }]}>{`{${k}}`}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Field label="ไอคอน (อีโมจิ)">
              <View style={[s.row, { flexWrap: 'wrap', gap: 4 }]}>
                <Input compact value={tpl.emoji} onChange={(t) => setTpl({ emoji: t })} max={8} />
                {EMOJIS.map((e) => (
                  <Pressable key={e} onPress={() => setTpl({ emoji: e })} style={[s.emoji, tpl.emoji === e && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}>
                    <Text style={{ fontSize: 16 }}>{e}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setTpl({ emoji: '' })} style={s.emoji}><Text style={s.hint}>ไม่มี</Text></Pressable>
              </View>
            </Field>
            <Grid>
              <Field label="หัวเรื่อง">
                <Input value={tpl.title} onChange={(t) => setTpl({ title: t })} onFocus={() => setFocus({ f: 'title' })} max={120} />
              </Field>
              <Field label="บรรทัดรอง (ใต้หัวเรื่อง)">
                <Input value={tpl.subtitle} onChange={(t) => setTpl({ subtitle: t })} onFocus={() => setFocus({ f: 'subtitle' })} placeholder="เว้นว่าง = ไม่แสดง" max={120} />
              </Field>
            </Grid>
            <Field label="สีหัวการ์ด" hint="“สีหลัก” = ใช้สีหลักของร้าน (ตั้งด้านล่าง)">
              <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                <Pressable onPress={() => setTpl({ color: '' })} style={[s.swatchAuto, !tpl.color && s.swatchOn]}>
                  <View style={[s.swatchDot, { backgroundColor: st.color }]} />
                  <Text style={s.hint}>สีหลัก</Text>
                </Pressable>
                {SWATCHES.map((c) => (
                  <Pressable key={c} onPress={() => setTpl({ color: c })} style={[s.swatch, { backgroundColor: c }, tpl.color === c && s.swatchOn]} accessibilityLabel={c} />
                ))}
                <ColorInput value={tpl.color} onChange={(c) => setTpl({ color: c })} />
              </View>
            </Field>

            <View style={{ gap: 6 }}>
              <Text style={s.label}>บรรทัดข้อมูล (ชื่อ : ค่า)</Text>
              {tpl.lines.map((l, i) => (
                <View key={i} style={s.lineEdit}>
                  <View style={{ width: 130, flexGrow: 1 }}>
                    <Input value={l.label} onChange={(t) => setLine(i, { label: t })} onFocus={() => setFocus({ f: 'label', i })} placeholder="ชื่อ" max={60} />
                  </View>
                  <View style={{ flex: 2, minWidth: 140 }}>
                    <Input value={l.value} onChange={(t) => setLine(i, { value: t })} onFocus={() => setFocus({ f: 'value', i })} placeholder="ค่า เช่น {total}" max={200} />
                  </View>
                  <View style={s.row}>
                    <Pressable onPress={() => moveLine(i, -1)} style={s.arrow} disabled={i === 0} accessibilityLabel="เลื่อนขึ้น"><Icon name="chevron-up" size={16} color={i === 0 ? colors.line : colors.text} /></Pressable>
                    <Pressable onPress={() => moveLine(i, 1)} style={s.arrow} disabled={i === tpl.lines.length - 1} accessibilityLabel="เลื่อนลง"><Icon name="chevron-down" size={16} color={i === tpl.lines.length - 1 ? colors.line : colors.text} /></Pressable>
                    <Pressable onPress={() => setTpl({ lines: tpl.lines.filter((_, j) => j !== i) })} style={s.arrow} accessibilityLabel="ลบบรรทัด"><Icon name="trash-outline" size={15} color={colors.danger} /></Pressable>
                  </View>
                </View>
              ))}
              {tpl.lines.length < 12 ? (
                <View style={[s.row, { justifyContent: 'flex-start' }]}>
                  <SmallBtn label="เพิ่มบรรทัด" icon="add" onPress={() => { setTpl({ lines: [...tpl.lines, { label: '', value: '' }] }); setFocus({ f: 'label', i: tpl.lines.length }); }} />
                </View>
              ) : null}
            </View>

            {info.hasItems ? (
              <View style={{ gap: 8 }}>
                <Toggle label="แสดงรายการ" hint={key === 'daily' ? 'ยอดขายแยกตามสาขา' : key === 'sale' ? 'สินค้าในบิล (สูงสุด 12 รายการ)' : 'รายการสินค้า/SKU'} value={tpl.showItems} onChange={(x) => setTpl({ showItems: x })} />
                {tpl.showItems ? (
                  <Field label="หัวข้อรายการ">
                    <Input value={tpl.itemsTitle} onChange={(t) => setTpl({ itemsTitle: t })} onFocus={() => setFocus({ f: 'itemsTitle' })} max={60} />
                  </Field>
                ) : null}
              </View>
            ) : null}
            <Field label="ข้อความท้ายการ์ด">
              <Input value={tpl.footer} onChange={(t) => setTpl({ footer: t })} onFocus={() => setFocus({ f: 'footer' })} placeholder="เว้นว่าง = ไม่แสดง" max={160} />
            </Field>
            <View style={[s.row, { justifyContent: 'flex-end' }]}>
              <SmallBtn label="คืนค่าเริ่มต้นของการ์ดนี้" icon="refresh-outline" disabled={isDefault} onPress={() => setTpl(structuredClone(info.defaultTemplate))} />
            </View>
          </Card>

          {!wide ? preview : null}

          <Card title="รูปแบบร่วมของทุกการ์ด">
            <Field label="สีหลักของร้าน">
              <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                {SWATCHES.map((c) => (
                  <Pressable key={c} onPress={() => setStyle({ color: c })} style={[s.swatch, { backgroundColor: c }, st.color === c && s.swatchOn]} accessibilityLabel={c} />
                ))}
                <ColorInput value={st.color} onChange={(c) => c && setStyle({ color: c })} />
              </View>
            </Field>
            <Field label="ขนาดการ์ด">
              <Seg value={st.size} options={[['kilo', 'เล็ก'], ['mega', 'กลาง'], ['giga', 'ใหญ่']]} onChange={(x) => setStyle({ size: x as 'kilo' | 'mega' | 'giga' })} />
            </Field>
            <Field label="โลโก้ร้าน (URL รูป https)" hint="รูปต้องเปิดได้จากอินเทอร์เน็ต เช่น ลิงก์รูปจาก Facebook/LINE OA หรือ https://<ngrok>/uploads/… · เว้นว่าง = ไม่แสดง">
              <Input value={st.logoUrl} onChange={(t) => setStyle({ logoUrl: t.trim() })} placeholder="https://…/logo.png" max={500} />
            </Field>
            <Grid>
              <Field label="ปุ่มท้ายการ์ด" hint="เว้นว่าง = ไม่มีปุ่ม">
                <Input value={st.buttonLabel} onChange={(t) => setStyle({ buttonLabel: t })} placeholder="เช่น เปิดระบบ POS" max={40} />
              </Field>
              <Field label="ลิงก์ของปุ่ม" hint="เช่น เว็บไซต์หรือ LINE OA ของร้าน">
                <Input value={st.buttonUrl} onChange={(t) => setStyle({ buttonUrl: t.trim() })} placeholder="https://" max={500} />
              </Field>
            </Grid>
          </Card>
        </View>
        {wide ? <View style={{ width: 400, gap: 8, position: 'sticky' as 'relative', top: 0 }}>{preview}</View> : null}
      </View>
    </>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return (
    <View style={[s.row, { gap: 4 }]}>
      <View style={[s.swatchDot, { width: 22, height: 22, backgroundColor: /^#[0-9a-fA-F]{6}$/.test(t) ? t : '#fff', borderWidth: 1, borderColor: colors.line }]} />
      <TextInput
        value={t}
        onChangeText={(x) => {
          const c = ('#' + x.replace(/[^0-9a-fA-F]/g, '')).slice(0, 7);
          setT(c);
          if (/^#[0-9a-fA-F]{6}$/.test(c)) onChange(c.toUpperCase());
        }}
        placeholder="#RRGGBB"
        placeholderTextColor={colors.faint}
        maxLength={7}
        autoCapitalize="characters"
        style={[s.input, { width: 96, height: 34, fontSize: 12 }]}
      />
    </View>
  );
}
