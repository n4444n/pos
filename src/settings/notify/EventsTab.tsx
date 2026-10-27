// การแจ้งเตือน → แท็บเหตุการณ์ (เลือกเหตุการณ์ที่จะแจ้ง ต่อช่องทาง)
import { Pressable, Text, View } from 'react-native';
import type { AdminSettings, NotifyEventInfo, NotifyEventKey } from '../../api';
import { Icon } from '../../components/Icon';
import { colors } from '../../theme';
import { Card, Input, Switch, type Upd, s } from '../ui';
import { ChannelChip } from './ChannelsTab';

export function EventsTab({ v, set, catalog, lineOn, waOn, hookOn, goChannels }: {
  v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; catalog: NotifyEventInfo[]; lineOn: boolean; waOn: boolean; hookOn: boolean; goChannels: () => void;
}) {
  const setEv = (k: NotifyEventKey, x: Partial<AdminSettings['notify']['events'][NotifyEventKey]>) => set({ events: { ...v.events, [k]: { ...v.events[k], ...x } } });
  const opt = v.options;
  const missing = [!lineOn && 'LINE', !waOn && 'WhatsApp', !hookOn && 'Webhook'].filter(Boolean) as string[];
  return (
    <Card title="แจ้งเตือนเมื่อ…">
      {missing.length ? (
        <Pressable onPress={goChannels} style={[s.infoBox, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          <Icon name="information-circle-outline" size={18} color={colors.sub} />
          <Text style={[s.sub, { flex: 1 }]}>ยังไม่ได้ตั้งค่า {missing.join(', ')} — ช่องทางที่ยังไม่ตั้งจะไม่ถูกส่ง (สีส้ม) · แตะเพื่อไปตั้งค่า</Text>
        </Pressable>
      ) : null}
      {catalog.map((e) => {
        const ev = v.events[e.key];
        if (!ev) return null;
        const tpl = v.templates[e.key];
        return (
          <View key={e.key} style={[s.evRow, !ev.on && { opacity: 0.6 }]}>
            <View style={[s.evIcon, { backgroundColor: (tpl?.color || v.style.color) + '1A' }]}>
              <Text style={{ fontSize: 18 }}>{tpl?.emoji || '🔔'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 180, gap: 6 }}>
              <View>
                <Text style={s.toggleLabel}>{e.label} <Text style={[s.hint, s.code]}>{e.name}</Text></Text>
                <Text style={s.hint}>{e.desc}</Text>
              </View>
              {ev.on ? (
                <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                  <ChannelChip label="LINE" value={ev.line} ready={lineOn} onChange={(x) => setEv(e.key, { line: x })} />
                  <ChannelChip label="WhatsApp" value={ev.whatsapp} ready={waOn} onChange={(x) => setEv(e.key, { whatsapp: x })} />
                  <ChannelChip label="Webhook" value={ev.webhook} ready={hookOn} onChange={(x) => setEv(e.key, { webhook: x })} />
                </View>
              ) : null}
              {ev.on && e.key === 'sale' ? (
                <View style={[s.row, { flexWrap: 'wrap' }]}>
                  <Text style={s.hint}>แจ้งเฉพาะบิลตั้งแต่</Text>
                  <Input compact value={String(opt.saleMin || '')} placeholder="0" onChange={(t) => set({ options: { ...opt, saleMin: Number(t.replace(/[^0-9]/g, '')) || 0 } })} keyboard="number-pad" max={8} />
                  <Text style={s.hint}>บาท (0 = ทุกบิล)</Text>
                </View>
              ) : null}
              {ev.on && e.key === 'shiftClose' ? (
                <Pressable style={[s.row, { alignSelf: 'flex-start' }]} onPress={() => set({ options: { ...opt, shiftMismatchOnly: !opt.shiftMismatchOnly } })}>
                  <Icon name={opt.shiftMismatchOnly ? 'checkbox' : 'square-outline'} size={18} color={opt.shiftMismatchOnly ? colors.primary : colors.faint} />
                  <Text style={s.hint}>แจ้งเฉพาะเมื่อเงินขาด/เกิน</Text>
                </Pressable>
              ) : null}
              {ev.on && e.key === 'daily' ? (
                <View style={[s.row, { flexWrap: 'wrap' }]}>
                  <Text style={s.hint}>ส่งทุกวันเวลา</Text>
                  <Input compact value={opt.dailyTime} placeholder="21:00" onChange={(t) => set({ options: { ...opt, dailyTime: t.replace(/[^0-9:]/g, '').slice(0, 5) } })} max={5} />
                  <Text style={s.hint}>น. (รูปแบบ 24 ชม. เช่น 21:30)</Text>
                </View>
              ) : null}
            </View>
            <Switch value={ev.on} onChange={(x) => setEv(e.key, { on: x })} label={e.label} />
          </View>
        );
      })}
    </Card>
  );
}
