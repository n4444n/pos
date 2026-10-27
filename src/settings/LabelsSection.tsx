// ตั้งค่า → กระดาษบาร์โค้ด (โปรไฟล์ป้าย · ขนาดสติ๊กเกอร์/ดวงต่อแถว · บาร์โค้ด · ข้อความบนป้าย) + ตัวอย่างป้าย
import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import type { AdminSettings } from '../api';
import { Icon } from '../components/Icon';
import { colors } from '../theme';
import { DEFAULT_LABEL_PROFILE, type LabelPreset, type LabelProfile } from '../appSettings';
import { LABEL_PRESETS, profileSummary, resolveSymbology, rollHeight, rollWidth, SAMPLE_LABEL, sheetName, symbologyLabel } from '../labels';
import { LABEL_SYMBOLOGIES, SYMBOLOGIES, type Symbology } from '../barcodeEncode';
import { LabelPreview } from '../components/stock/LabelPreview';
import { Card, Field, Grid, Input, MmInput, NumStep, STICKY, Seg, SmallBtn, Toggle, type Upd, s } from './ui';

/**
 * กระดาษบาร์โค้ด — โปรไฟล์ป้ายติดสินค้า (ขนาดกระดาษ ดวงต่อแถว บาร์โค้ด ข้อความ) ใช้ตอนพิมพ์ป้ายในหน้าสต็อก
 * บันทึกในตั้งค่าร้าน (ทุกเครื่อง/ทุกสาขาใช้ร่วมกัน)
 */
// ตัวอย่างป้ายใช้รหัสที่เข้ากับประเภทบาร์โค้ด (EAN/UPC ต้องเป็นตัวเลข)
const SAMPLE_CODES: Partial<Record<Symbology, string>> = { ean13: '8850001234568', ean8: '96385074', upca: '036000291452', code39: 'AC-004-90' };

export const sampleFor = (p: LabelProfile) => ({ ...SAMPLE_LABEL, code: SAMPLE_CODES[resolveSymbology(p.symbology)] ?? SAMPLE_LABEL.code });

/** กระดาษบาร์โค้ด — หน้าตา/layout ของป้ายเท่านั้น (เครื่องพิมพ์ + ทดสอบพิมพ์ อยู่ที่ "ตั้งค่าเครื่องพิมพ์บาร์โค้ด") */
export function LabelsSection({ v, set, goLabelPrinter }: { v: AdminSettings['barcode']; set: Upd<AdminSettings['barcode']>; goLabelPrinter: () => void }) {
  const profiles = v.labelProfiles?.length ? v.labelProfiles : [DEFAULT_LABEL_PROFILE];
  const [selId, setSelId] = useState(v.labelProfile || profiles[0].id);
  const p = profiles.find((x) => x.id === selId) ?? profiles[0];
  const { width } = useWindowDimensions();
  const wide = width >= 1250;
  const upd = (x: Partial<LabelProfile>) => set({ labelProfiles: profiles.map((q) => (q.id === p.id ? { ...q, ...x } : q)) });
  const add = (base?: LabelProfile) => {
    if (profiles.length >= 12) return;
    const id = `p${Date.now().toString(36)}`;
    const np: LabelProfile = { ...(base ?? DEFAULT_LABEL_PROFILE), id, name: base ? `${base.name} (สำเนา)`.slice(0, 40) : `โปรไฟล์ ${profiles.length + 1}` };
    set({ labelProfiles: [...profiles, np] });
    setSelId(id);
  };
  const remove = () => {
    if (profiles.length <= 1) return;
    const rest = profiles.filter((q) => q.id !== p.id);
    set({ labelProfiles: rest, labelProfile: v.labelProfile === p.id ? rest[0].id : v.labelProfile });
    setSelId(rest[0].id);
  };
  const isDefault = (v.labelProfile || profiles[0].id) === p.id;
  const sample = sampleFor(p);
  // แบบสำเร็จรูปของร้าน (บันทึกเฉพาะค่าขนาดกระดาษ)
  const presets = v.labelPresets ?? [];

  const settings = (
    <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
      <Card title="โปรไฟล์">
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {profiles.map((q) => {
            const on = q.id === p.id;
            const def = (v.labelProfile || profiles[0].id) === q.id;
            return (
              <Pressable key={q.id} onPress={() => setSelId(q.id)} style={[s.profileChip, on && s.profileOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[s.profileName, on && { color: colors.primary }]} numberOfLines={1}>{def ? '★ ' : ''}{q.name}</Text>
                <Text style={s.hint} numberOfLines={1}>{profileSummary(q)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <SmallBtn label="เพิ่มโปรไฟล์" icon="add" onPress={() => add()} disabled={profiles.length >= 12} />
          <SmallBtn label="ทำสำเนา" icon="copy-outline" onPress={() => add(p)} disabled={profiles.length >= 12} />
          <SmallBtn label={isDefault ? 'ค่าเริ่มต้นอยู่แล้ว' : 'ตั้งเป็นค่าเริ่มต้น'} icon="star-outline" onPress={() => set({ labelProfile: p.id })} disabled={isDefault} />
          <SmallBtn label="ลบโปรไฟล์นี้" icon="trash-outline" onPress={remove} disabled={profiles.length <= 1} />
        </View>
        <Field label="ชื่อโปรไฟล์" hint="★ = โปรไฟล์ที่เลือกไว้ก่อนเมื่อพิมพ์ป้าย (แต่ละเครื่องจำโปรไฟล์ที่ใช้ล่าสุด)">
          <Input value={p.name} onChange={(t) => upd({ name: t })} max={40} placeholder="เช่น สติ๊กเกอร์ม้วน 50×30" />
        </Field>
      </Card>

      <PaperSizeCard p={p} upd={upd} presets={presets} setPresets={(x) => set({ labelPresets: x })} />

      <Card title="บาร์โค้ด">
        <Grid max={4}>
          <Field label="ความสูงบาร์โค้ด (มม.)"><NumStep value={p.barHeight} min={3} max={60} step={0.5} onChange={(n) => upd({ barHeight: n })} /></Field>
          <Field label="ความหนาแท่ง (มม.)" hint="0 = ยืดตามความกว้าง % · แนะนำ 0.25 ขึ้นไป (ดูความละเอียดเครื่องพิมพ์ในเมนู ตั้งค่าเครื่องพิมพ์บาร์โค้ด)">
            <NumStep value={p.barModule ?? 0} min={0} max={1} step={0.05} onChange={(n) => upd({ barModule: n })} />
          </Field>
          <Field label="ความกว้างบาร์โค้ด (% ของดวง)" hint={(p.barModule ?? 0) > 0 ? 'ไม่ใช้ เมื่อตั้งความหนาแท่ง' : undefined}><NumStep value={p.barWidth} min={30} max={100} step={5} onChange={(n) => upd({ barWidth: n })} /></Field>
          <Field label="ระยะห่างชื่อสินค้า ↔ บาร์โค้ด (มม.)"><NumStep value={p.nameGap ?? 0.5} min={0} max={10} step={0.5} onChange={(n) => upd({ nameGap: n })} /></Field>
          <Field label="ระยะห่างบาร์โค้ด ↔ รหัส (มม.)"><NumStep value={p.textGap} min={0} max={10} step={0.5} onChange={(n) => upd({ textGap: n })} /></Field>
        </Grid>
      </Card>

      <Card title="ข้อความบนป้าย">
        <Grid max={4}>
          <Toggle label="แสดงรหัส" value={p.showCode} onChange={(x) => upd({ showCode: x })} />
          <Toggle label="ชื่อสินค้า" value={p.showName} onChange={(x) => upd({ showName: x })} />
          <Toggle label="สี / ไซซ์" value={p.showVariant} onChange={(x) => upd({ showVariant: x })} />
          <Toggle label="ราคา" value={p.showPrice} onChange={(x) => upd({ showPrice: x })} />
          <Toggle label="ชื่อร้าน" value={p.showShop} onChange={(x) => upd({ showShop: x })} />
          <Toggle label="ตัวหนา" value={p.bold} onChange={(x) => upd({ bold: x })} />
          <Toggle label="ตัวเอียง" value={p.italic} onChange={(x) => upd({ italic: x })} />
        </Grid>
        <Field label="ตำแหน่งของตัวอักษร">
          <Seg value={p.align} options={[['left', 'ชิดซ้าย'], ['center', 'กึ่งกลาง'], ['right', 'ชิดขวา']]} onChange={(x) => upd({ align: x as LabelProfile['align'] })} />
        </Field>
        <Grid max={3}>
          <Field label="ขนาดรหัส (pt)"><NumStep value={p.codeSize} min={4} max={20} step={0.5} onChange={(n) => upd({ codeSize: n })} /></Field>
          <Field label="ขนาดชื่อ (pt)"><NumStep value={p.nameSize} min={4} max={20} step={0.5} onChange={(n) => upd({ nameSize: n })} /></Field>
          <Field label="ขนาดราคา (pt)"><NumStep value={p.priceSize} min={4} max={24} step={0.5} onChange={(n) => upd({ priceSize: n })} /></Field>
        </Grid>
      </Card>
    </View>
  );

  const side = (
    <View style={[{ gap: 12 }, wide ? [{ width: 380 }, STICKY] : { width: '100%' }]}>
      <Card title="ตัวอย่างป้าย">
        <View style={s.previewBox}>
          <LabelPreview profile={p} sample={sample} maxWidth={wide ? 340 : 520} />
        </View>
        <Text style={s.hint}>{p.name} · {profileSummary(p)} · {symbologyLabel(resolveSymbology(p.symbology))}</Text>
        <Text style={s.hint}>
          ตัวอย่างใช้รูปแบบเดียวกับตอนพิมพ์จริง · การเลือกเครื่องพิมพ์ ขนาดกระดาษในไดรเวอร์ และทดสอบพิมพ์ อยู่ที่เมนู{' '}
          <Text style={s.link} onPress={goLabelPrinter}>ตั้งค่าเครื่องพิมพ์บาร์โค้ด</Text>
        </Text>
      </Card>
      <Card title="รูปแบบป้าย">
        {/* ตาราง 3 คอลัมน์ · มีรูปแบบเพิ่ม → ขึ้นแถวใหม่ */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, rowGap: 8 }}>
          {([
            ['standard', 'มาตรฐาน'],
            ['classic', 'แบบเดิม'],
            ['compact', 'บาร์โค้ดอย่างเดียว'],
          ] as const).map(([id, label]) => {
            const on = (p.layout ?? 'standard') === id;
            return (
              <View key={id} style={{ width: '33.333%', paddingHorizontal: 4 }}>
                <Pressable onPress={() => upd({ layout: id })} style={({ hovered }: { hovered?: boolean }) => [s.profileChip, { minWidth: 0, maxWidth: undefined, flex: 1, alignItems: 'center', justifyContent: 'center' }, on && s.profileOn, hovered && !on && { borderColor: colors.primary }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={[s.profileName, { textAlign: 'center' }, on && { color: colors.primary }]}>{label}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </Card>
      <Card title="ประเภทบาร์โค้ด">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, rowGap: 8 }}>
          {LABEL_SYMBOLOGIES.map((id) => {
            const x = SYMBOLOGIES.find((y) => y.id === id)!;
            const on = p.symbology === id;
            return (
              <View key={id} style={{ width: '33.333%', paddingHorizontal: 4 }}>
                <Pressable onPress={() => upd({ symbology: id })} style={({ hovered }: { hovered?: boolean }) => [s.profileChip, { minWidth: 0, maxWidth: undefined, flex: 1, alignItems: 'center', justifyContent: 'center' }, on && s.profileOn, hovered && !on && { borderColor: colors.primary }]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={x.label}>
                  <Text style={[s.profileName, { textAlign: 'center' }, on && { color: colors.primary }]}>{x.label}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Text style={s.hint}>{SYMBOLOGIES.find((y) => y.id === p.symbology)?.hint ?? ''}</Text>
        <Text style={s.hint}>รหัสที่ใช้กับประเภทที่เลือกไม่ได้ (เช่น มีตัวพิมพ์เล็กแต่เลือก 128 - A หรือ Code 39) จะพิมพ์เป็น 128 - B แทน — สแกนขายได้เหมือนเดิม</Text>
      </Card>
    </View>
  );

  return (
    <View style={[{ gap: 12 }, wide ? { flexDirection: 'row', alignItems: 'flex-start' } : null]}>
      {settings}
      {side}
    </View>
  );
}

/** ขนาดกระดาษบาร์โค้ด (สติ๊กเกอร์ม้วน): เลือกรูปแบบ หรือกรอกขนาดกระดาษเอง — ขนาดดวงคำนวณจากกระดาษ − ขอบ − ระยะห่าง */
export const r1 = (n: number) => Math.round(n * 10) / 10;

type Geo = { W: number; H: number; T: number; B: number; L: number; R: number; N: number; G: number };

function PaperSizeCard({ p, upd, presets, setPresets }: {
  p: LabelProfile; upd: (x: Partial<LabelProfile>) => void; presets: LabelPreset[]; setPresets: (x: LabelPreset[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [presetName, setPresetName] = useState('');
  const geo: Geo = {
    W: rollWidth(p), H: rollHeight(p), T: p.marginTop, B: p.marginBottom ?? 0, L: p.marginLeft, R: p.marginRight ?? 0, N: p.cols, G: p.gapX,
  };
  const sameGeo = (x: Partial<LabelProfile>) => {
    const q = { ...p, ...x } as LabelProfile;
    return rollWidth(q) === geo.W && rollHeight(q) === geo.H && q.cols === p.cols && q.width === p.width && q.height === p.height
      && q.gapX === p.gapX && q.marginLeft === p.marginLeft && q.marginTop === p.marginTop;
  };
  // หลายแบบอาจขนาดเท่ากัน (เช่น 50×30 กับ 50×30 แบบเดิม) → เลือกแบบที่ค่าตรงทุกช่องก่อน
  const exact = (x: Partial<LabelProfile>) => Object.entries(x).every(([k, val]) => JSON.stringify(p[k as keyof LabelProfile] ?? 0) === JSON.stringify(val ?? 0));
  const geoHits = LABEL_PRESETS.filter((x) => sameGeo(x.apply));
  const builtIn = geoHits.find((x) => exact(x.apply)) ?? geoHits.find((x) => !x.id.endsWith('old')) ?? geoHits[0];
  const mine = presets.find((x) => sameGeo(x.apply));
  const current = mine ? `★ ${mine.label}` : builtIn ? builtIn.label : 'กำหนดเอง';
  const hintOf = (x: Partial<LabelProfile>) => {
    const q = { ...p, ...x } as LabelProfile;
    return `ม้วน ${rollWidth(q)} × ${rollHeight(q)} มม. · ${q.cols} ดวง/แถว`;
  };
  const choose = (x: Partial<LabelProfile>) => {
    upd({ ...x, startAt: Math.min(p.startAt ?? 1, x.cols ?? p.cols) });
    setErr('');
    setOpen(false);
  };
  // กรอกขนาดกระดาษ/ขอบ/คอลัมน์ → คำนวณขนาดดวงใหม่ (ปฏิเสธถ้าดวงเล็กกว่า 5 มม.)
  const apply = (x: Partial<Geo>): boolean => {
    const g = { ...geo, ...x };
    const width = r1((g.W - g.L - g.R - (g.N - 1) * g.G) / g.N);
    const height = r1(g.H - g.T - g.B);
    if (width < 5 || height < 5) {
      setErr(`ขนาดนี้ทำให้ดวงเหลือ ${width} × ${height} มม. (ต้องอย่างน้อย 5 × 5 มม.) — ลดขอบ / ระยะห่าง / จำนวนคอลัมน์ หรือเพิ่มขนาดกระดาษ`);
      return false;
    }
    setErr('');
    upd({
      paper: 'roll', rows: 1, pageWidth: g.W, pageHeight: g.H, marginTop: g.T, marginBottom: g.B, marginLeft: g.L, marginRight: g.R,
      cols: g.N, gapX: g.G, width, height, startAt: Math.min(p.startAt ?? 1, g.N),
    });
    return true;
  };
  const savePreset = () => {
    if (presets.length >= 24) return;
    const a: Partial<LabelProfile> = {
      paper: 'roll', pageWidth: geo.W, pageHeight: geo.H, width: p.width, height: p.height, cols: p.cols, rows: 1, gapX: p.gapX, gapY: p.gapY,
      marginTop: p.marginTop, marginLeft: p.marginLeft, marginRight: geo.R, marginBottom: geo.B, padding: p.padding,
    };
    const label = presetName.trim() || `${geo.W} × ${geo.H} มม.${p.cols > 1 ? ` · ${p.cols} ดวง` : ''}`;
    setPresets([...presets, { id: `u${Date.now().toString(36)}`, label, apply: a }]);
    setPresetName('');
  };

  if (p.paper === 'a4') {
    return (
      <Card title="ขนาดกระดาษ">
        <Text style={s.hint}>
          โปรไฟล์นี้ตั้งเป็นกระดาษแผ่น ({sheetName(p)} · {p.cols} × {p.rows} ดวง) ซึ่งยังพิมพ์ได้ตามเดิม แต่หน้านี้ตั้งค่าได้เฉพาะสติ๊กเกอร์ม้วน
        </Text>
        <View style={s.row}>
          <SmallBtn label="เปลี่ยนเป็นสติ๊กเกอร์ม้วน" icon="swap-horizontal" onPress={() => upd({ paper: 'roll', pageWidth: 0, pageHeight: 0, rows: 1, cols: Math.min(p.cols, 8), startAt: 1 })} />
        </View>
      </Card>
    );
  }

  return (
    <Card title="ขนาดกระดาษ">
      <Field label="รูปแบบกระดาษ" hint="เลือกแบบสำเร็จรูปเพื่อกรอกค่าให้ แล้วแก้ช่องด้านล่างต่อได้ · แก้ค่าเองแล้วจะเป็น “กำหนดเอง”">
        <Pressable onPress={() => setOpen(!open)} style={[s.input, s.dd]} accessibilityRole="button" accessibilityLabel="รูปแบบกระดาษ">
          <Text style={[s.ddT, (mine || builtIn) && { color: colors.text }]} numberOfLines={1}>{current}</Text>
          <Text style={s.hint} numberOfLines={1}>{hintOf({})}</Text>
          <Icon name="chevron-down" size={16} color={colors.sub} />
        </Pressable>
        {open ? (
          <View style={s.ddList}>
            {LABEL_PRESETS.map((x) => (
              <Pressable key={x.id} onPress={() => choose(x.apply)} style={({ hovered }: { hovered?: boolean }) => [s.ddItem, hovered && s.ddHover, builtIn?.id === x.id && !mine && s.ddOn]}>
                <Text style={s.presetT}>{x.label}</Text>
                <Text style={[s.hint, { flex: 1 }]} numberOfLines={1}>{x.hint}</Text>
              </Pressable>
            ))}
            {presets.map((x) => (
              <View key={x.id} style={[s.ddItem, mine?.id === x.id && s.ddOn]}>
                <Pressable onPress={() => choose(x.apply)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLabel={`ใช้แบบ ${x.label}`}>
                  <Text style={[s.presetT, { color: colors.primary }]}>★ {x.label}</Text>
                  <Text style={[s.hint, { flex: 1 }]} numberOfLines={1}>{hintOf(x.apply)}</Text>
                </Pressable>
                <Pressable onPress={() => setPresets(presets.filter((y) => y.id !== x.id))} style={s.ddDel} accessibilityLabel={`ลบแบบ ${x.label}`}>
                  <Icon name="close" size={14} color={colors.sub} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setOpen(false)} style={({ hovered }: { hovered?: boolean }) => [s.ddItem, hovered && s.ddHover, !mine && !builtIn && s.ddOn]}>
              <Text style={s.presetT}>กำหนดเอง</Text>
              <Text style={[s.hint, { flex: 1 }]}>กรอกขนาดในช่องด้านล่าง</Text>
            </Pressable>
          </View>
        ) : null}
      </Field>
      <Grid max={2}>
        <Field label="จุดเริ่มพิมพ์" hint="เริ่มที่ดวงที่เท่าไรของแถวแรก (ใช้แถวที่ลอกไปบางดวงแล้ว)">
          <MmInput value={Math.min(p.startAt ?? 1, p.cols)} int onCommit={(n) => (n >= 1 && n <= p.cols ? (upd({ startAt: n }), true) : false)} />
        </Field>
        <Field label="จำนวนคอลัมน์" hint="ดวงต่อแถว (1–8)">
          <MmInput value={p.cols} int onCommit={(n) => n >= 1 && n <= 8 && apply({ N: n })} />
        </Field>
      </Grid>
      <Text style={[s.label, { marginTop: 4 }]}>ขนาดกระดาษ (มม.)</Text>
      <Grid max={2}>
        <Field label="กว้าง"><MmInput value={geo.W} onCommit={(n) => n >= 5 && n <= 300 && apply({ W: n })} /></Field>
        <Field label="สูง"><MmInput value={geo.H} onCommit={(n) => n >= 5 && n <= 420 && apply({ H: n })} /></Field>
        <Field label="บน"><MmInput value={geo.T} onCommit={(n) => n <= 100 && apply({ T: n })} /></Field>
        <Field label="ล่าง"><MmInput value={geo.B} onCommit={(n) => n <= 100 && apply({ B: n })} /></Field>
        <Field label="ซ้าย"><MmInput value={geo.L} onCommit={(n) => n <= 100 && apply({ L: n })} /></Field>
        <Field label="ขวา"><MmInput value={geo.R} onCommit={(n) => n <= 100 && apply({ R: n })} /></Field>
        <Field label="ระยะห่างระหว่างดวง"><MmInput value={geo.G} onCommit={(n) => n <= 50 && apply({ G: n })} /></Field>
        <Field label="ขอบในดวง" hint="ระยะจากขอบดวงถึงข้อความ"><MmInput value={p.padding} onCommit={(n) => (n <= 20 ? (upd({ padding: n }), true) : false)} /></Field>
      </Grid>
      <View style={s.ddInfo}>
        <Icon name="pricetag-outline" size={16} color={colors.primary} />
        <Text style={[s.sub, { flex: 1 }]}>
          ขนาดดวง <Text style={{ fontWeight: '700', color: colors.text }}>{p.width} × {p.height} มม.</Text> · {p.cols} ดวง/แถว · กระดาษ {geo.W} × {geo.H} มม.
        </Text>
      </View>
      {err ? <Text style={[s.hint, { color: colors.danger }]}>⚠ {err}</Text> : null}
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <View style={{ width: 220 }}>
          <Input value={presetName} onChange={setPresetName} max={40} placeholder={`ชื่อแบบ เช่น ${geo.W} × ${geo.H} มม.`} />
        </View>
        <SmallBtn label="บันทึกเป็นรูปแบบกระดาษของร้าน" icon="bookmark-outline" onPress={savePreset} disabled={presets.length >= 24} />
      </View>
    </Card>
  );
}
