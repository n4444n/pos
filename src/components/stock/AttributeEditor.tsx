// สต็อก: กำหนดคุณสมบัติของ SKU (สี · ไซซ์ · อื่น ๆ สูงสุด 3)
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ATTR_PRESETS, COLOR_SWATCHES, guessHex, MAX_ATTRS, SIZE_PRESETS, uid, type DAttr } from '../../stockDraft';
import { colors, font, radius } from '../../theme';
import type { AttrType } from '../../types';
import { Icon } from '../Icon';

interface Props {
  attrs: DAttr[];
  onChange: (attrs: DAttr[]) => void;
}

const TYPE_LABEL: Record<AttrType, string> = { color: 'สี (Color)', size: 'ขนาด (Size)', custom: 'อื่นๆ (ดีไซน์ / ลาย / ทรง)' };

/** คุณสมบัติของ SKU (สูงสุด 3): สี · ไซซ์ · ดีไซน์/อื่นๆ — แต่ละประเภทใช้ได้ครั้งเดียว */
export function AttributeEditor({ attrs, onChange }: Props) {
  const [palette, setPalette] = useState<string | null>(null); // option id ที่เปิดเลือกสีอยู่
  const used = new Set(attrs.map((a) => a.type));
  const free = (['color', 'size', 'custom'] as AttrType[]).filter((t) => !used.has(t));

  const update = (i: number, a: DAttr) => onChange(attrs.map((x, j) => (j === i ? a : x)));
  const remove = (i: number) => onChange(attrs.filter((_, j) => j !== i));
  const add = (type: AttrType) =>
    onChange([...attrs, { id: uid(), type, name: ATTR_PRESETS[type], options: type === 'color' ? [{ id: uid(), value: '', hex: '#232326' }] : [{ id: uid(), value: '' }] }]);

  return (
    <View style={{ gap: 12 }}>
      {attrs.length === 0 ? (
        <Text style={s.hint}>สินค้านี้ยังไม่มีตัวเลือก (ขายเป็น SKU เดียว) — เพิ่มคุณสมบัติด้านล่าง ถ้ามีหลายสีหรือหลายไซซ์</Text>
      ) : null}

      {attrs.map((a, i) => (
        <View key={a.id} style={s.block}>
          <View style={s.blockHead}>
            <Text style={s.blockTitle}>คุณสมบัติ {i + 1}</Text>
            <Pressable onPress={() => remove(i)} style={s.removeAttr} accessibilityLabel={`ลบคุณสมบัติ ${a.name}`}>
              <Icon name="trash-outline" size={14} color={colors.danger} />
              <Text style={s.removeText}>ลบคุณสมบัตินี้</Text>
            </Pressable>
          </View>

          {/* ประเภท */}
          <View style={s.typeRow}>
            {(['color', 'size', 'custom'] as AttrType[]).map((t) => {
              const on = a.type === t;
              const disabled = !on && used.has(t);
              return (
                <Pressable
                  key={t}
                  disabled={disabled}
                  onPress={() => update(i, { ...a, type: t, name: t === 'custom' && a.type !== 'custom' ? ATTR_PRESETS.custom : ATTR_PRESETS[t] })}
                  style={[s.typeBtn, on && s.typeOn, disabled && { opacity: 0.35 }]}
                >
                  <Text style={[s.typeText, on && s.typeTextOn]}>{TYPE_LABEL[t]}</Text>
                </Pressable>
              );
            })}
          </View>
          {a.type === 'custom' ? (
            <TextInput
              value={a.name}
              onChangeText={(t) => update(i, { ...a, name: t })}
              placeholder="ชื่อคุณสมบัติ เช่น ดีไซน์, ลาย, ทรง, ความยาวแขน"
              placeholderTextColor={colors.faint}
              style={[s.input, { marginBottom: 4 }]}
              maxLength={30}
              accessibilityLabel="ชื่อคุณสมบัติ"
            />
          ) : null}

          {a.type === 'size' ? (
            <View style={s.presetRow}>
              <Text style={s.presetLabel}>ชุดไซซ์ด่วน:</Text>
              {SIZE_PRESETS.map((p) => (
                <Pressable
                  key={p.label}
                  style={s.preset}
                  onPress={() => {
                    const have = new Set(a.options.map((o) => o.value.trim()).filter(Boolean));
                    const kept = a.options.filter((o) => o.value.trim());
                    update(i, { ...a, options: [...kept, ...p.values.filter((v) => !have.has(v)).map((v) => ({ id: uid(), value: v }))] });
                  }}
                >
                  <Text style={s.presetText}>+ {p.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={s.optLabel}>ตัวเลือก</Text>
          {a.options.map((o, k) => (
            <View key={o.id}>
              <View style={s.optRow}>
                {a.type === 'color' ? (
                  <Pressable
                    style={[s.swatch, { backgroundColor: o.hex }]}
                    onPress={() => setPalette(palette === o.id ? null : o.id)}
                    accessibilityLabel={`เลือกสีของ ${o.value || 'ตัวเลือก'}`}
                  />
                ) : null}
                <TextInput
                  value={o.value}
                  onChangeText={(t) =>
                    update(i, {
                      ...a,
                      options: a.options.map((x) =>
                        x.id !== o.id ? x : { ...x, value: t, hex: a.type === 'color' && !x.picked ? guessHex(t) ?? x.hex : x.hex },
                      ),
                    })
                  }
                  placeholder={a.type === 'color' ? 'เช่น ดำ, ขาว, Mix' : a.type === 'size' ? 'เช่น M, 32, Free Size' : 'เช่น ลายทาง, Oversize'}
                  placeholderTextColor={colors.faint}
                  style={[s.input, { flex: 1 }, !o.value.trim() && s.inputEmpty]}
                  maxLength={30}
                  accessibilityLabel={`${a.name} ตัวเลือกที่ ${k + 1}`}
                />
                <Pressable
                  onPress={() => update(i, { ...a, options: a.options.filter((x) => x.id !== o.id) })}
                  style={s.del}
                  disabled={a.options.length <= 1}
                  accessibilityLabel={`ลบตัวเลือก ${o.value}`}
                >
                  <Icon name="trash" size={16} color={a.options.length <= 1 ? colors.line : colors.text} />
                </Pressable>
              </View>
              {palette === o.id ? (
                <View style={s.palette}>
                  {COLOR_SWATCHES.map((c) => (
                    <Pressable
                      key={c}
                      style={[s.palDot, { backgroundColor: c }, o.hex === c && s.palOn]}
                      onPress={() => {
                        update(i, { ...a, options: a.options.map((x) => (x.id === o.id ? { ...x, hex: c, picked: true } : x)) });
                        setPalette(null);
                      }}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
          <Pressable
            style={s.addOpt}
            onPress={() => update(i, { ...a, options: [...a.options, a.type === 'color' ? { id: uid(), value: '', hex: '#9AA0A8' } : { id: uid(), value: '' }] })}
          >
            <Icon name="add" size={16} color={colors.primary} />
            <Text style={s.addOptText}>เพิ่มตัวเลือก ({a.options.length})</Text>
          </Pressable>
        </View>
      ))}

      {attrs.length < MAX_ATTRS ? (
        <View style={s.addRow}>
          <Text style={s.addLabel}>+ เพิ่มคุณสมบัติ:</Text>
          {free.map((t) => (
            <Pressable key={t} style={s.addAttr} onPress={() => add(t)}>
              <Icon name={t === 'color' ? 'color-palette-outline' : t === 'size' ? 'resize-outline' : 'pricetags-outline'} size={15} color={colors.primary} />
              <Text style={s.addAttrText}>{t === 'custom' ? 'ดีไซน์ / อื่นๆ' : ATTR_PRESETS[t]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  hint: { fontFamily: font, fontSize: 12, color: colors.sub, backgroundColor: colors.surface, padding: 12, borderRadius: radius.md, lineHeight: 19 },
  block: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 8 },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blockTitle: { fontFamily: font, fontSize: 13, fontWeight: '700', color: colors.text },
  removeAttr: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 28, borderRadius: radius.pill },
  removeText: { fontFamily: font, fontSize: 11, color: colors.danger },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeBtn: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', justifyContent: 'center' },
  typeOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { fontFamily: font, fontSize: 12, color: colors.text },
  typeTextOn: { color: '#fff', fontWeight: '600' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  presetLabel: { fontFamily: font, fontSize: 11, color: colors.sub },
  preset: { paddingHorizontal: 10, height: 26, borderRadius: radius.pill, backgroundColor: colors.primarySoft, justifyContent: 'center' },
  presetText: { fontFamily: font, fontSize: 11, color: colors.primary, fontWeight: '600' },
  optLabel: { fontFamily: font, fontSize: 12, fontWeight: '600', color: colors.text, marginTop: 4 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { fontFamily: font, fontSize: 14, color: colors.text, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', paddingHorizontal: 12 },
  inputEmpty: { borderColor: '#F3C4C6' },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  del: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8, marginTop: 6, marginLeft: 42, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  palDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  palOn: { borderWidth: 2, borderColor: colors.primary },
  addOpt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#9DB7F7', backgroundColor: '#fff', marginTop: 2 },
  addOptText: { fontFamily: font, fontSize: 13, color: colors.primary, fontWeight: '500' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  addLabel: { fontFamily: font, fontSize: 12, color: colors.sub },
  addAttr: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: '#BBD0FF', backgroundColor: colors.primarySoft },
  addAttrText: { fontFamily: font, fontSize: 12, color: colors.primary, fontWeight: '600' },
});
