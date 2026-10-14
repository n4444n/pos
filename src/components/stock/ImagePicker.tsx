import { createElement, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, imageSrc } from '../../api';
import { makeVariants } from '../../imageVariants';
import { colors, font, radius } from '../../theme';
import { GarmentArt } from '../GarmentArt';
import { Icon } from '../Icon';

const ARTS = ['tshirt', 'polo', 'longsleeve', 'tank', 'shirt', 'blouse', 'pants', 'shorts', 'dress', 'slipdress', 'skirt', 'hoodie', 'jacket', 'sweater', 'bag', 'cap', 'socks', 'belt', 'scarf'];
const TINTS = ['#F4F4F2', '#9AA0A8', '#232326', '#24345C', '#4F6D96', '#9CC3E6', '#C8443E', '#EBB3C2', '#D9C6A5', '#8A5A3B', '#6B7444', '#A9B99C', '#D5A23B', '#E8EEF9'];

/** ย่อรูปในเบราว์เซอร์ก่อนอัปโหลด (ด้านยาวสุด 900px, JPEG) — ไฟล์เล็ก โหลดเร็ว */
export function resizeToDataUrl(file: File, max = 900): Promise<string> {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onerror = () => fail(new Error('อ่านไฟล์ไม่ได้'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => fail(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

interface Props {
  imageUrl: string | null;
  art: string;
  tint: string;
  onChange: (v: { imageUrl?: string | null; art?: string; tint?: string }) => void;
}

/** ภาพสินค้า: อัปโหลดรูปจริง หรือเลือกไอคอนเสื้อผ้า + สี */
export function ImagePicker({ imageUrl, art, tint, onChange }: Props) {
  const [mode, setMode] = useState<'photo' | 'icon'>(imageUrl ? 'photo' : 'icon');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pick = () => inputRef.current?.click();
  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await resizeToDataUrl(file);
      // รูปย่อ กลาง/เล็ก สำหรับตั้งค่า "คุณภาพรูป" ในหน้าขาย (ย่อไม่สำเร็จก็ยังอัปโหลดรูปหลักได้)
      const variants = await makeVariants(dataUrl).catch(() => undefined);
      const r = await api.upload(dataUrl, variants);
      onChange({ imageUrl: r.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={s.modes}>
        {(['photo', 'icon'] as const).map((m) => (
          <Pressable key={m} style={s.radioRow} onPress={() => setMode(m)} accessibilityRole="radio" accessibilityState={{ checked: mode === m }}>
            <View style={[s.radio, mode === m && s.radioOn]}>{mode === m ? <View style={s.radioDot} /> : null}</View>
            <Text style={s.radioText}>{m === 'photo' ? 'รูปภาพ' : 'ไอคอน + กำหนดสี'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'photo' ? (
        <View style={s.photoBox}>
          {Platform.OS === 'web'
            ? createElement('input', {
                ref: inputRef,
                type: 'file',
                accept: 'image/jpeg,image/png,image/webp',
                style: { display: 'none' },
                onChange: (e: { target: { files?: FileList } }) => onFile(e.target.files?.[0]),
              })
            : null}
          {imageUrl ? (
            <View style={s.preview}>
              <Image source={{ uri: imageSrc(imageUrl) }} style={s.previewImg} resizeMode="cover" />
              <View style={s.previewActions}>
                <Pressable style={s.smallBtn} onPress={pick}>
                  <Icon name="swap-horizontal" size={14} color={colors.text} />
                  <Text style={s.smallText}>เปลี่ยนรูป</Text>
                </Pressable>
                <Pressable style={s.smallBtn} onPress={() => onChange({ imageUrl: null })}>
                  <Icon name="trash-outline" size={14} color={colors.danger} />
                  <Text style={[s.smallText, { color: colors.danger }]}>ลบรูป</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={s.drop} onPress={pick} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.primary} /> : <Icon name="cloud-upload-outline" size={24} color={colors.sub} />}
              <Text style={s.dropText}>{busy ? 'กำลังอัปโหลด…' : 'เลือกไฟล์รูป'}</Text>
              <Text style={s.dropSub}>JPG / PNG / WEBP · ระบบย่อขนาดให้อัตโนมัติ</Text>
            </Pressable>
          )}
          {error ? <Text style={s.error}>{error}</Text> : null}
        </View>
      ) : (
        <View style={s.iconBox}>
          <View style={s.iconPreview}>
            <GarmentArt art={art} color={tint} size={72} />
          </View>
          <View style={{ flex: 1, gap: 8, minWidth: 200 }}>
            <View style={s.grid}>
              {ARTS.map((a) => (
                <Pressable key={a} style={[s.artBtn, a === art && s.artOn]} onPress={() => onChange({ art: a, imageUrl: null })} accessibilityLabel={`ไอคอน ${a}`}>
                  <GarmentArt art={a} color={a === art ? colors.primary : colors.sub} size={22} outline />
                </Pressable>
              ))}
            </View>
            <View style={s.grid}>
              {TINTS.map((t) => (
                <Pressable key={t} style={[s.tint, { backgroundColor: t }, t === tint && s.tintOn]} onPress={() => onChange({ tint: t, imageUrl: null })} accessibilityLabel={`สี ${t}`}>
                  {t === tint ? <Icon name="checkmark" size={14} color={t === '#F4F4F2' || t === '#E8EEF9' || t === '#EFE6D2' ? colors.text : '#fff'} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  modes: { flexDirection: 'row', gap: 18 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  radioText: { fontFamily: font, fontSize: 13, color: colors.text },
  photoBox: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  drop: { width: '100%', maxWidth: 260, height: 150, borderRadius: radius.md, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4 },
  dropText: { fontFamily: font, fontSize: 13, color: colors.text, fontWeight: '500' },
  dropSub: { fontFamily: font, fontSize: 10, color: colors.faint },
  preview: { alignItems: 'center', gap: 8 },
  previewImg: { width: 160, height: 160, borderRadius: radius.md, backgroundColor: colors.surface },
  previewActions: { flexDirection: 'row', gap: 8 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  smallText: { fontFamily: font, fontSize: 12, color: colors.text },
  error: { fontFamily: font, fontSize: 12, color: colors.danger, marginTop: 6 },
  iconBox: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12 },
  iconPreview: { width: 100, height: 100, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  artBtn: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  artOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tint: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  tintOn: { borderWidth: 2, borderColor: colors.primary },
});
