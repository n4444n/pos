// ตัวอย่างการ์ดแจ้งเตือน LINE (จำลองหน้าตา Flex Message bubble ให้ใกล้ของจริง)
import { Image, StyleSheet, Text, View } from 'react-native';
import type { CardStyle, CardTemplate, NotifyItem } from '../../api';

const HEX = /^#[0-9a-fA-F]{6}$/;
export const fillVars = (s: string, vars: Record<string, string>) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
export function onColor(hex: string) {
  const h = (HEX.test(hex) ? hex : '#2F6BFF').slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#1B1F27' : '#FFFFFF';
}
const WIDTH = { kilo: 260, mega: 300, giga: 360 } as const;
const font = "'IBM Plex Sans Thai', 'Noto Sans Thai', system-ui, sans-serif";

interface Props {
  tpl: CardTemplate;
  style: CardStyle;
  vars: Record<string, string>;
  items: NotifyItem[];
  /** แสดงกรอบห้องแชท LINE รอบการ์ด */
  chat?: boolean;
}

export function FlexCard({ tpl, style, vars, items, chat = true }: Props) {
  const color = HEX.test(tpl.color) ? tpl.color : HEX.test(style.color) ? style.color : '#2F6BFF';
  const fg = onColor(color);
  const title = fillVars(`${tpl.emoji ? tpl.emoji + ' ' : ''}${tpl.title}`, vars);
  const subtitle = fillVars(tpl.subtitle, vars);
  const lines = tpl.lines.map((l) => ({ label: fillVars(l.label, vars), value: fillVars(l.value, vars) })).filter((l) => l.label.trim() || l.value.trim());
  const footer = fillVars(tpl.footer, vars);
  const showItems = tpl.showItems && items.length > 0;
  const btnUrl = fillVars(style.buttonUrl, vars);
  const showBtn = !!style.buttonLabel.trim() && /^https?:\/\//.test(btnUrl);
  const logo = /^https:\/\//.test(style.logoUrl) ? style.logoUrl : '';
  const alt = [title, ...lines.slice(0, 2).map((l) => `${l.label} ${l.value}`)].join(' · ');

  const bubble = (
    <View style={[s.bubble, { width: WIDTH[style.size] ?? 300 }]}>
      <View style={[s.header, { backgroundColor: color }]}>
        {logo ? <Image source={{ uri: logo }} style={s.logo} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.title, { color: fg }]}>{title || ' '}</Text>
          {subtitle.trim() ? <Text style={[s.subtitle, { color: fg }]}>{subtitle}</Text> : null}
        </View>
      </View>
      {lines.length || showItems ? (
        <View style={s.body}>
          {lines.map((l, i) => (
            <View key={i} style={s.lineRow}>
              <Text style={[s.small, { color: '#8A8F98', flex: 4 }]}>{l.label}</Text>
              <Text style={[s.small, { color: '#1B1F27', fontWeight: '700', flex: 6, textAlign: 'right' }]}>{l.value}</Text>
            </View>
          ))}
          {showItems ? (
            <>
              {lines.length ? <View style={s.sep} /> : null}
              <Text style={[s.tiny, { fontWeight: '700', color: '#8A8F98', marginTop: lines.length ? 4 : 0 }]}>{fillVars(tpl.itemsTitle, vars)}</Text>
              {items.slice(0, 12).map((it, i) => (
                <View key={i} style={[s.lineRow, { marginTop: 4 }]}>
                  <View style={{ flex: 7 }}>
                    <Text style={[s.small, { color: '#1B1F27' }]}>{it.name}</Text>
                    {it.detail ? <Text style={[s.tiny, { color: '#8A8F98' }]}>{it.detail}</Text> : null}
                  </View>
                  <Text style={[s.small, { color: '#1B1F27', flex: 3, textAlign: 'right', alignSelf: 'center' }]}>{it.value}</Text>
                </View>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
      {footer.trim() || showBtn ? (
        <View style={s.footer}>
          {footer.trim() ? <Text style={[s.tiny, { color: '#A0A6B1', textAlign: 'center' }]}>{footer}</Text> : null}
          {showBtn ? (
            <View style={[s.btn, { backgroundColor: color }]}>
              <Text style={[s.small, { color: fg, fontWeight: '700' }]} numberOfLines={1}>{style.buttonLabel}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (!chat) return bubble;
  return (
    <View style={s.chat}>
      <View style={s.chatTop}>
        <View style={s.avatar}><Text style={{ fontSize: 13 }}>🛍️</Text></View>
        <Text style={[s.tiny, { color: '#fff', fontWeight: '700' }]} numberOfLines={1}>{vars.shop || 'ร้านของคุณ'} · LINE OA</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <View style={s.avatar}><Text style={{ fontSize: 13 }}>🤖</Text></View>
        <View style={{ gap: 4, flexShrink: 1 }}>
          {bubble}
          <Text style={[s.tiny, { color: 'rgba(255,255,255,.85)' }]}>{vars.time || ''}</Text>
        </View>
      </View>
      <Text style={[s.tiny, { color: 'rgba(255,255,255,.85)', textAlign: 'center' }]} numberOfLines={2}>
        ข้อความแจ้งเตือนบนมือถือ: “{alt}”
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  chat: { backgroundColor: '#8CABD9', borderRadius: 16, padding: 12, gap: 12, alignItems: 'stretch' },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.3)' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '100%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.12)' } as object,
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  logo: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.3)' },
  title: { fontFamily: font, fontSize: 17, fontWeight: '700', lineHeight: 24 },
  subtitle: { fontFamily: font, fontSize: 11, marginTop: 4, opacity: 0.92, lineHeight: 16 },
  body: { padding: 16, gap: 6 },
  lineRow: { flexDirection: 'row', gap: 12 },
  sep: { height: 1, backgroundColor: '#EDEFF2', marginVertical: 8 },
  footer: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4, gap: 10 },
  btn: { height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  small: { fontFamily: font, fontSize: 13, lineHeight: 19 },
  tiny: { fontFamily: font, fontSize: 10.5, lineHeight: 15 },
});
