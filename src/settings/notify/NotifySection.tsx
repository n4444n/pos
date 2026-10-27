// ตั้งค่า → การแจ้งเตือน & API: แท็บ ช่องทาง / เหตุการณ์ / หน้าตาการ์ด / API key
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type AdminSettings, type ApiKeyRow, type NotifyEventInfo, type NotifyEventKey } from '../../api';
import { Icon, type IconName } from '../../components/Icon';
import { colors } from '../../theme';
import { type Notify, type Upd, s } from '../ui';
import { ChannelsTab } from './ChannelsTab';
import { EventsTab } from './EventsTab';
import { DesignTab } from './DesignTab';
import { ApiTab } from './ApiTab';

// ======================= การแจ้งเตือน & API =======================
type NotifyTab = 'channels' | 'events' | 'design' | 'api';

const NOTIFY_TABS: { id: NotifyTab; label: string; icon: IconName }[] = [
  { id: 'channels', label: 'ช่องทาง', icon: 'git-network-outline' },
  { id: 'events', label: 'เหตุการณ์', icon: 'notifications-outline' },
  { id: 'design', label: 'ออกแบบการ์ด LINE', icon: 'color-palette-outline' },
  { id: 'api', label: 'API key', icon: 'key-outline' },
];

export function NotifySection({ v, set, dirty, notify, keys, setKeys, apiEnabled, setApiEnabled }: {
  v: AdminSettings['notify']; set: Upd<AdminSettings['notify']>; dirty: boolean; notify: Notify;
  keys: ApiKeyRow[]; setKeys: (k: ApiKeyRow[]) => void; apiEnabled: boolean; setApiEnabled: (x: boolean) => Promise<void>;
}) {
  const [tab, setTab] = useState<NotifyTab>(() => {
    try {
      const t = globalThis.localStorage?.getItem('pos.notifyTab') as NotifyTab | null;
      return t && NOTIFY_TABS.some((x) => x.id === t) ? t : 'channels';
    } catch {
      return 'channels';
    }
  });
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem('pos.notifyTab', tab);
    } catch {
      /* ignore */
    }
  }, [tab]);
  const [catalog, setCatalog] = useState<NotifyEventInfo[]>([]);
  useEffect(() => {
    api.notifyCatalog().then(setCatalog).catch((e) => notify('error', (e as Error).message));
  }, [notify]);

  const [testing, setTesting] = useState<string | null>(null);
  const test = async (ch: 'line' | 'whatsapp' | 'webhook', event?: NotifyEventKey) => {
    if (dirty) return notify('info', 'กรุณากด “บันทึก” ก่อนทดสอบส่ง');
    setTesting(ch + (event ?? ''));
    try {
      const r = await api.testNotify(ch, event);
      notify(
        r.ok ? 'success' : 'error',
        r.ok ? (ch === 'webhook' ? `Webhook ตอบกลับ HTTP ${r.status}` : 'ส่งตัวอย่างแล้ว — ตรวจสอบในแอป') : `ส่งไม่สำเร็จ: ${r.body || `HTTP ${r.status}`}`,
      );
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const lineOn = v.line.enabled && !!v.line.token && !!v.line.to;
  const waOn = v.whatsapp.enabled && !!v.whatsapp.token && !!v.whatsapp.phoneNumberId && !!v.whatsapp.to;
  const hookOn = v.webhook.enabled && !!v.webhook.url;
  const activeEvents = catalog.filter((e) => v.events[e.key]?.on).length;

  return (
    <>
      <View style={s.summary}>
        <StatusPill icon="chatbubble-ellipses-outline" label="LINE" on={lineOn} />
        <StatusPill icon="logo-whatsapp" label="WhatsApp" on={waOn} />
        <StatusPill icon="flash-outline" label="Webhook" on={hookOn} />
        <StatusPill icon="key-outline" label={`API ${apiEnabled ? 'เปิด' : 'ปิด'}`} on={apiEnabled} />
        <Text style={[s.sub, { marginLeft: 'auto' }]}>แจ้งเตือน {activeEvents}/{catalog.length || 9} เหตุการณ์</Text>
      </View>
      <View style={s.tabs}>
        {NOTIFY_TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={[s.tab, on && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Icon name={t.icon} size={16} color={on ? colors.primary : colors.sub} />
              <Text style={[s.tabText, on && { color: colors.primary, fontWeight: '700' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'channels' ? <ChannelsTab v={v} set={set} test={test} testing={testing} /> : null}
      {tab === 'events' ? <EventsTab v={v} set={set} catalog={catalog} lineOn={lineOn} waOn={waOn} hookOn={hookOn} goChannels={() => setTab('channels')} /> : null}
      {tab === 'design' ? <DesignTab v={v} set={set} catalog={catalog} test={test} testing={testing} lineOn={lineOn} /> : null}
      {tab === 'api' ? <ApiTab keys={keys} setKeys={setKeys} enabled={apiEnabled} setEnabled={setApiEnabled} notify={notify} /> : null}
    </>
  );
}

function StatusPill({ icon, label, on }: { icon: IconName; label: string; on: boolean }) {
  return (
    <View style={[s.pill, on ? { backgroundColor: colors.successSoft } : { backgroundColor: colors.surface }]}>
      <Icon name={icon} size={14} color={on ? colors.success : colors.faint} />
      <Text style={[s.pillText, { color: on ? colors.success : colors.sub }]}>{label}</Text>
      <View style={[s.dot, { width: 7, height: 7, backgroundColor: on ? colors.success : colors.line }]} />
    </View>
  );
}

export type TestFn = (ch: 'line' | 'whatsapp' | 'webhook', event?: NotifyEventKey) => void;
