// การแจ้งเตือน → แท็บ API key สำหรับระบบภายนอก
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { api, BASE, type ApiKeyRow } from '../../api';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { thaiDateTime } from '../../format';
import { colors, font, radius } from '../../theme';
import { Card, Input, type Notify, Seg, SmallBtn, Toggle, s } from '../ui';

const SCOPE_LABEL = { read: 'อ่านอย่างเดียว', write: 'อ่าน + เขียน', sync: 'เชื่อมสาขา' } as const;

export function ApiTab({ keys, setKeys, enabled, setEnabled, notify }: {
  keys: ApiKeyRow[]; setKeys: (k: ApiKeyRow[]) => void; enabled: boolean; setEnabled: (x: boolean) => Promise<void>; notify: Notify;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<ApiKeyRow | null>(null);
  const origin = BASE || (Platform.OS === 'web' ? globalThis.location?.origin ?? '' : '');
  const list = keys.filter((k) => k.scope !== 'sync');

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createKey(name.trim(), scope);
      setCreated({ name: r.name, key: r.key });
      setKeys([{ id: r.id, name: r.name, prefix: r.prefix, scope: r.scope, createdAt: new Date().toISOString() }, ...keys]);
      setName('');
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doRevoke = async () => {
    if (!revoke) return;
    try {
      await api.revokeKey(revoke.id);
      setKeys(keys.filter((k) => k.id !== revoke.id));
      notify('success', `ยกเลิก key "${revoke.name}" แล้ว`);
    } catch (e) {
      notify('error', (e as Error).message);
    }
    setRevoke(null);
  };
  const copy = (t: string) => {
    try {
      navigator.clipboard?.writeText(t).then(() => notify('success', 'คัดลอกแล้ว'));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <Card title="API สำหรับระบบภายนอก">
        <Toggle label="อนุญาตให้ระบบภายนอกเชื่อมต่อด้วย API key" hint="บันทึกทันทีเมื่อกด · ใช้ดึงยอดขาย/สต็อก ไปทำรายงาน หรือให้ระบบอื่นเรียกดูข้อมูล" value={enabled} onChange={(x) => void setEnabled(x)} />
        <Text style={s.p}>ส่ง key ใน header: <Text style={s.code}>X-API-Key: pos_…</Text> (หรือ Authorization: Bearer pos_…) · เลือกสาขาด้วย <Text style={s.code}>X-Branch: B02</Text> (ไม่ส่ง = สาขาหลัก)</Text>
        <Text style={s.p}>Base URL: <Text selectable style={s.code}>{origin}/api</Text></Text>
      </Card>

      <Card title="API keys">
        <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Input value={name} onChange={setName} placeholder="ชื่อ เช่น Google Sheets, เว็บไซต์, n8n" max={60} />
          </View>
          <Seg value={scope} options={[['read', SCOPE_LABEL.read], ['write', SCOPE_LABEL.write]]} onChange={(x) => setScope(x as 'read' | 'write')} />
          <SmallBtn label="สร้าง key" icon="key-outline" busy={busy} disabled={!name.trim()} onPress={create} />
        </View>
        {list.length === 0 ? <Text style={s.sub}>ยังไม่มี API key</Text> : null}
        {list.map((k) => (
          <View key={k.id} style={s.keyRow}>
            <Icon name="key-outline" size={16} color={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.b} numberOfLines={1}>{k.name} <Text style={s.sub}>· {SCOPE_LABEL[k.scope]}</Text></Text>
              <Text style={s.sub} numberOfLines={1}>{k.prefix}… · สร้าง {k.createdAt ? thaiDateTime(k.createdAt.replace('T', ' ').slice(0, 19)) : '-'} · ใช้ล่าสุด {k.lastUsedAt ? thaiDateTime(k.lastUsedAt) : 'ยังไม่เคย'}</Text>
            </View>
            <Pressable onPress={() => setRevoke(k)} style={s.revoke} accessibilityLabel={`ยกเลิก key ${k.name}`}>
              <Text style={{ fontFamily: font, fontSize: 12, color: colors.danger }}>ยกเลิก</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      <Card title="API ที่ใช้บ่อย">
        {[
          ['GET', '/api/dashboard?from=&to=', 'รายงานยอดขาย'],
          ['GET', '/api/history?from=&to=', 'ประวัติการขาย'],
          ['GET', '/api/stock/alerts', 'สินค้าใกล้หมด / หมด'],
          ['GET', '/api/stock/skus?q=&page=', 'สินค้า + SKU + สต็อก'],
          ['POST', '/api/stock/command', 'เช็ค/เพิ่ม/ปรับสต็อก { mode, lines:[{code,qty}], apply }'],
          ['POST', '/api/orders', 'สร้างบิลขาย (ต้องเปิดกะ)'],
        ].map(([m, p, d]) => (
          <View key={p} style={s.apiRow}>
            <Text style={[s.method, m === 'POST' && { backgroundColor: '#FFF4E0', color: '#B26A00' }]}>{m}</Text>
            <Text style={[s.code, { flexShrink: 1 }]} selectable>{p}</Text>
            <Text style={[s.sub, { flex: 1, minWidth: 140 }]}>{d}</Text>
          </View>
        ))}
        <Text style={s.sub}>ดูรายการ API ทั้งหมดได้ในไฟล์ README.md ของโปรเจกต์</Text>
      </Card>

      <Sheet visible={!!created} onClose={() => setCreated(null)} title={`API key: ${created?.name ?? ''}`} width={520}
        footer={
          <Pressable style={[s.primaryBtn, { flexGrow: 1, justifyContent: 'center' }]} onPress={() => created && copy(created.key)}>
            <Icon name="copy-outline" size={16} color="#fff" />
            <Text style={s.primaryText}>คัดลอก key</Text>
          </Pressable>
        }
      >
        <View style={{ gap: 8 }}>
          <Text selectable style={[s.code, { padding: 10, backgroundColor: colors.surface, borderRadius: radius.sm }]}>{created?.key}</Text>
          <Text style={[s.p, { color: '#8A5300' }]}>⚠️ key จะแสดงครั้งนี้ครั้งเดียว กรุณาคัดลอกเก็บไว้ (ระบบเก็บเฉพาะค่าที่เข้ารหัสแล้ว)</Text>
        </View>
      </Sheet>
      <Sheet visible={!!revoke} onClose={() => setRevoke(null)} title={`ยกเลิก key "${revoke?.name ?? ''}"?`} width={420}
        footer={
          <View style={[s.row, { flex: 1, justifyContent: 'flex-end' }]}>
            <Pressable style={s.ghostBtn} onPress={() => setRevoke(null)}><Text style={s.ghostText}>ไม่ใช่</Text></Pressable>
            <Pressable style={[s.primaryBtn, { backgroundColor: colors.danger }]} onPress={doRevoke}><Text style={s.primaryText}>ยกเลิก key</Text></Pressable>
          </View>
        }
      >
        <Text style={s.p}>ระบบที่ใช้ key นี้จะเชื่อมต่อไม่ได้ทันที</Text>
      </Sheet>
    </>
  );
}
