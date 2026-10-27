// ตั้งค่า → ใบเสร็จ (ภาษา · แก้คำ · ขนาดกระดาษ · โลโก้ · ข้อความ/รูป/QR ท้ายบิล) + ตัวอย่างใบเสร็จ
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { imageSrc, type AdminSettings } from '../api';
import { QrView } from '../components/QrView';
import type { FooterBlock } from '../appSettings';
import { defaultLabel, RECEIPT_DEFAULT_TEXT, RECEIPT_LABELS, receiptText, type ReceiptLang } from '../receiptText';
import { Icon } from '../components/Icon';
import { Barcode } from '../components/stock/Barcode';
import { colors } from '../theme';
import { AutoImage, Card, Field, Input, Seg, SmallBtn, Stepper, Toggle, type Upd, UploadBtn, s } from './ui';

export function ReceiptSection({ v, shop, vat, set, goPrinter }: { v: AdminSettings['receipt']; shop: AdminSettings['shop']; vat: AdminSettings['payments']['vat']; set: Upd<AdminSettings['receipt']>; goPrinter: () => void }) {
  const fs = v.fontSize === 'small' ? 11 : v.fontSize === 'large' ? 14 : 12;
  const { t, pay, date } = receiptText(v);
  const [showLabels, setShowLabels] = useState(false);
  const paperPx = v.paperWidth === 58 ? 210 : 290;
  const blocks = v.footerBlocks;
  const setBlock = (i: number, x: Partial<FooterBlock>) => set({ footerBlocks: blocks.map((b, j) => (j === i ? { ...b, ...x } : b)) });
  const moveBlock = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set({ footerBlocks: next });
  };
  const addBlock = (type: FooterBlock['type']) =>
    set({
      footerBlocks: [
        ...blocks,
        type === 'qr'
          ? { type, text: 'https://', caption: v.language === 'th' ? 'สแกนเพื่อเข้าเว็บไซต์' : 'Scan for website', size: 'small', align: 'center', bold: false, width: 45 }
          : type === 'image'
            ? { type, text: '', caption: '', size: 'small', align: 'center', bold: false, width: 60 }
            : { type, text: '', caption: '', size: 'small', align: 'center', bold: false, width: 60 },
      ],
    });
  const P = ({ children, size = fs, bold, center, color }: { children: ReactNode; size?: number; bold?: boolean; center?: boolean; color?: string }) => (
    <Text style={[s.pText, { fontSize: size }, bold && { fontWeight: '700' }, center && s.pc, color ? { color } : null]}>{children}</Text>
  );
  const PRow = ({ l, r, size = fs, bold }: { l: string; r: string; size?: number; bold?: boolean }) => (
    <View style={s.pRow}>
      <View style={{ flex: 1 }}><P size={size} bold={bold}>{l}</P></View>
      <P size={size} bold={bold}>{r}</P>
    </View>
  );
  const vatAmt = (580 * vat.rate) / (100 + vat.rate);
  const preview = (
    <View style={[s.paper, { width: paperPx }]}>
      {v.logoUrl ? (
        <View style={{ alignItems: 'center', marginBottom: 2 }}>
          <AutoImage uri={imageSrc(v.logoUrl)} width={(paperPx - 24) * (v.logoWidth / 100)} />
        </View>
      ) : null}
      {!v.logoUrl || v.showShopName ? <P size={fs + 4} bold center>{v.shopName.trim() || shop.name}</P> : null}
      {shop.branchName ? <P center>{shop.branchName}</P> : null}
      {shop.address ? <P size={fs - 1} center>{shop.address}</P> : null}
      {shop.phone ? <P size={fs - 1} center>{t('tel')} {shop.phone}</P> : null}
      {shop.taxId ? <P size={fs - 1} center>{t('taxId')} {shop.taxId}</P> : null}
      {v.header ? <P center>{v.header}</P> : null}
      {v.title ? <P bold center>{v.title}</P> : null}
      <View style={s.dash} />
      <P>{t('orderNo')}: INV-261011-0001</P>
      <P>{t('date')}: {date(new Date())}</P>
      {v.showCustomer ? <P>{t('customer')}: คุณสมใจ</P> : null}
      {v.showSalesperson ? <P>{t('staff')}: มายด์</P> : null}
      <View style={s.dash} />
      <View style={[s.pRow, { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#000', paddingBottom: 3, marginBottom: 3 }]}>
        <View style={{ flex: 1 }}><P bold>{t('colItem')}</P></View>
        <View style={{ width: 44, alignItems: 'center' }}><P bold>{t('colQty')}</P></View>
        <P bold>{t('colAmount')}</P>
      </View>
      <View style={s.pRow}>
        <View style={{ flex: 1 }}>
          <P>เสื้อยืดคอกลม Cotton</P>
          <P size={fs - 1} color="#555">ดำ / M{v.showSku ? ' · TS-001-0002' : ''} · @290.00</P>
        </View>
        <View style={{ width: 44, alignItems: 'center' }}><P>2</P></View>
        <P>580.00</P>
      </View>
      <View style={s.dash} />
      <PRow l={t('subtotal')} r="580.00" />
      <PRow l={t('total')} r="580.00" size={fs + 3} bold />
      {v.showVat && vat.enabled && vat.rate > 0 ? <PRow l={`VAT ${vat.rate}% ${t('vatIncluded')}`} r={vatAmt.toFixed(2)} size={fs - 1} /> : null}
      <PRow l={`${t('paidBy')} ${pay('cash')}`} r="600.00" />
      <PRow l={t('change')} r="20.00" />
      <View style={s.dash} />
      {v.footer ? <P center>{v.footer}</P> : null}
      {v.footerBlocks.map((b, i) => {
        const bs = b.size === 'small' ? fs - 1 : b.size === 'large' ? fs + 3 : fs;
        const ai = b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center';
        const w = (paperPx - 24) * (b.width / 100);
        const cap = b.caption.trim() ? <Text style={[s.pText, { fontSize: bs, textAlign: b.align }, b.bold && { fontWeight: '700' }]}>{b.caption}</Text> : null;
        return (
          <View key={i} style={{ alignItems: ai, marginTop: 6, gap: 2 }}>
            {b.type === 'text' ? <Text style={[s.pText, { fontSize: bs, textAlign: b.align, alignSelf: 'stretch' }, b.bold && { fontWeight: '700' }]}>{b.text}</Text> : null}
            {b.type === 'qr' ? <>{cap}<QrView value={b.text} size={w} /></> : null}
            {b.type === 'image' ? <>{b.text ? <AutoImage uri={imageSrc(b.text)} width={w} /> : null}{cap}</> : null}
          </View>
        );
      })}
      {v.showOrderBarcode ? <Barcode value="INV-261011-0001" height={32} maxWidth={v.paperWidth === 58 ? 180 : 240} /> : null}
    </View>
  );
  // เปลี่ยนภาษา: หัวเรื่อง/ท้ายบิลที่ยังเป็นค่าเริ่มต้น → เปลี่ยนตามภาษาให้ด้วย
  const setLang = (lang: ReceiptLang) => {
    const defs = Object.values(RECEIPT_DEFAULT_TEXT);
    const next: Partial<AdminSettings['receipt']> = { language: lang };
    if (!v.title.trim() || defs.some((d) => d.title === v.title)) next.title = RECEIPT_DEFAULT_TEXT[lang].title;
    if (!v.footer.trim() || defs.some((d) => d.footer === v.footer)) next.footer = RECEIPT_DEFAULT_TEXT[lang].footer;
    set(next);
  };
  const ownCount = Object.values(v.labels).filter((x) => x.trim()).length;
  return (
    <View style={[{ gap: 12 }, Platform.OS === 'web' && { flexDirection: 'row', flexWrap: 'wrap' }]}>
      <View style={{ flex: 1, minWidth: 300, gap: 12 }}>
        <Pressable style={({ hovered }: { hovered?: boolean }) => [s.linkCard, hovered && { backgroundColor: '#E3EBFF' }]} onPress={goPrinter} accessibilityRole="link">
          <Icon name="print-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.linkTitle}>ตั้งค่าเครื่องพิมพ์ใบเสร็จ</Text>
            <Text style={s.hint}>เลือกเครื่องพิมพ์ของคอมพิวเตอร์เครื่องนี้ · USB / LAN · ตัดกระดาษ · ลิ้นชักเงิน · พิมพ์ทดสอบ</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
        <Card title="ภาษาของใบเสร็จ">
          <Seg value={v.language} options={[['th', 'ไทย'], ['en', 'English'], ['both', 'ไทย + English']]} onChange={(x) => setLang(x as ReceiptLang)} />
          <Text style={s.hint}>
            เปลี่ยนคำในบิลทั้งหมด (เลขที่ วันที่ ยอดสุทธิ เงินทอน วิธีชำระ ฯลฯ) และรูปแบบวันที่ · หัวเรื่อง/ข้อความท้ายบิลที่ยังเป็นค่าเริ่มต้นจะเปลี่ยนตามให้ ·
            ชื่อสินค้า สี/ไซซ์ และที่อยู่สาขา แสดงตามที่บันทึกไว้
          </Text>
        </Card>
        <Card title="กระดาษ & ตัวอักษร">
          <Field label="ขนาดกระดาษ"><Seg value={v.paperWidth} options={[[58, '58 มม.'], [80, '80 มม.']]} onChange={(x) => set({ paperWidth: x as 58 | 80 })} /></Field>
          <Field label="ขนาดตัวอักษร"><Seg value={v.fontSize} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => set({ fontSize: x as 'small' | 'medium' | 'large' })} /></Field>
          <Field label="จำนวนสำเนาต่อการพิมพ์"><Seg value={v.copies} options={[[1, '1 ใบ'], [2, '2 ใบ'], [3, '3 ใบ']]} onChange={(x) => set({ copies: Number(x) })} /></Field>
        </Card>
        <Card title="ข้อความ">
          <Field label="ชื่อร้านบนใบเสร็จ" hint={`เว้นว่าง = ใช้ชื่อร้าน "${shop.name}" · ใส่ชื่อภาษาอังกฤษได้ เช่น ABC Clothing`}>
            <Input value={v.shopName} onChange={(x) => set({ shopName: x })} placeholder={shop.name} max={80} />
          </Field>
          <Field label="หัวเรื่อง"><Input value={v.title} onChange={(x) => set({ title: x })} max={80} /></Field>
          <Field label="ข้อความหัวใบเสร็จ" hint="เช่น โปรโมชั่น หรือ Line/IG ร้าน"><Input value={v.header} onChange={(x) => set({ header: x })} max={500} multiline /></Field>
          <Field label="ข้อความท้ายใบเสร็จ" hint="เช่น เงื่อนไขการเปลี่ยนสินค้า"><Input value={v.footer} onChange={(x) => set({ footer: x })} max={500} multiline /></Field>
        </Card>
        <Card title="โลโก้หัวบิล">
          <View style={[s.row, { gap: 12, flexWrap: 'wrap' }]}>
            <View style={[s.logoBox]}>
              {v.logoUrl ? <AutoImage uri={imageSrc(v.logoUrl)} width={110} maxHeight={64} /> : <Icon name="image-outline" size={26} color={colors.faint} />}
            </View>
            <View style={{ gap: 8 }}>
              <View style={s.row}>
                <UploadBtn label={v.logoUrl ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'} onDone={(url) => set({ logoUrl: url })} />
                {v.logoUrl ? <SmallBtn label="ลบ" icon="trash-outline" onPress={() => set({ logoUrl: '' })} /> : null}
              </View>
              <Text style={s.hint}>JPG / PNG · แนะนำโลโก้พื้นขาว ตัวอักษรดำ (เครื่องพิมพ์ความร้อนพิมพ์เป็นขาว-ดำ)</Text>
            </View>
          </View>
          {v.logoUrl ? (
            <>
              <Field label={`ขนาดโลโก้ ${v.logoWidth}% ของความกว้างกระดาษ`}>
                <Stepper value={v.logoWidth} min={15} max={100} step={5} presets={[30, 45, 60, 80, 100]} onChange={(x) => set({ logoWidth: x })} />
              </Field>
              <Toggle label="แสดงชื่อร้านใต้โลโก้" hint="ปิดได้ถ้าโลโก้มีชื่อร้านอยู่แล้ว" value={v.showShopName} onChange={(x) => set({ showShopName: x })} />
            </>
          ) : null}
        </Card>
        <Card title="ส่วนท้ายบิล (เพิ่มเอง)">
          <Text style={s.hint}>ต่อจาก “ข้อความท้ายใบเสร็จ” · เพิ่มข้อความ, QR code (เว็บไซต์ / LINE OA / IG) หรือรูปภาพ · เรียงลำดับได้ สูงสุด 12 ส่วน</Text>
          {blocks.map((b, i) => (
            <View key={i} style={s.blockBox}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <View style={s.row}>
                  <Icon name={b.type === 'qr' ? 'qr-code-outline' : b.type === 'image' ? 'image-outline' : 'text-outline'} size={16} color={colors.primary} />
                  <Text style={s.b}>{i + 1}. {b.type === 'qr' ? 'QR code' : b.type === 'image' ? 'รูปภาพ' : 'ข้อความ'}</Text>
                </View>
                <View style={s.row}>
                  <Pressable onPress={() => moveBlock(i, -1)} style={s.arrow} disabled={i === 0} accessibilityLabel="เลื่อนขึ้น"><Icon name="chevron-up" size={16} color={i === 0 ? colors.line : colors.text} /></Pressable>
                  <Pressable onPress={() => moveBlock(i, 1)} style={s.arrow} disabled={i === blocks.length - 1} accessibilityLabel="เลื่อนลง"><Icon name="chevron-down" size={16} color={i === blocks.length - 1 ? colors.line : colors.text} /></Pressable>
                  <Pressable onPress={() => set({ footerBlocks: blocks.filter((_, j) => j !== i) })} style={s.arrow} accessibilityLabel="ลบส่วนนี้"><Icon name="trash-outline" size={15} color={colors.danger} /></Pressable>
                </View>
              </View>
              {b.type === 'text' ? (
                <Input value={b.text} onChange={(x) => setBlock(i, { text: x })} placeholder="เช่น Thank you for supporting us! ติดตามเราได้ที่ IG @shop" max={1000} multiline />
              ) : null}
              {b.type === 'qr' ? (
                <>
                  <Field label="ลิงก์หรือข้อความใน QR"><Input value={b.text} onChange={(x) => setBlock(i, { text: x.trim() })} placeholder="https://www.yourshop.com" max={500} /></Field>
                  <Field label="ข้อความเหนือ QR"><Input value={b.caption} onChange={(x) => setBlock(i, { caption: x })} placeholder="เช่น Scan for website" max={200} /></Field>
                </>
              ) : null}
              {b.type === 'image' ? (
                <>
                  <View style={[s.row, { flexWrap: 'wrap' }]}>
                    {b.text ? <AutoImage uri={imageSrc(b.text)} width={80} maxHeight={60} /> : null}
                    <UploadBtn label={b.text ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'} onDone={(url) => setBlock(i, { text: url })} />
                  </View>
                  <Field label="ข้อความใต้รูป"><Input value={b.caption} onChange={(x) => setBlock(i, { caption: x })} placeholder="ไม่บังคับ" max={200} /></Field>
                </>
              ) : null}
              <View style={[s.row, { flexWrap: 'wrap', gap: 10 }]}>
                <Seg value={b.align} options={[['left', 'ชิดซ้าย'], ['center', 'กึ่งกลาง'], ['right', 'ชิดขวา']]} onChange={(x) => setBlock(i, { align: x as FooterBlock['align'] })} />
                <Seg value={b.size} options={[['small', 'เล็ก'], ['medium', 'กลาง'], ['large', 'ใหญ่']]} onChange={(x) => setBlock(i, { size: x as FooterBlock['size'] })} />
                <Pressable style={s.row} onPress={() => setBlock(i, { bold: !b.bold })}>
                  <Icon name={b.bold ? 'checkbox' : 'square-outline'} size={18} color={b.bold ? colors.primary : colors.faint} />
                  <Text style={s.hint}>ตัวหนา</Text>
                </Pressable>
              </View>
              {b.type !== 'text' ? (
                <Field label={`ขนาด ${b.width}% ของความกว้างกระดาษ`}>
                  <Stepper value={b.width} min={15} max={100} step={5} presets={b.type === 'qr' ? [30, 40, 50, 65] : [40, 60, 80, 100]} onChange={(x) => setBlock(i, { width: x })} />
                </Field>
              ) : null}
            </View>
          ))}
          {blocks.length < 12 ? (
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <SmallBtn label="ข้อความ" icon="add" onPress={() => addBlock('text')} />
              <SmallBtn label="QR code" icon="qr-code-outline" onPress={() => addBlock('qr')} />
              <SmallBtn label="รูปภาพ" icon="image-outline" onPress={() => addBlock('image')} />
            </View>
          ) : null}
        </Card>
        <Card title="แก้ไขคำในบิล">
          <Pressable style={[s.row, { justifyContent: 'space-between' }]} onPress={() => setShowLabels((o) => !o)}>
            <Text style={[s.sub, { flex: 1 }]}>
              แก้ทุกคำที่พิมพ์ในบิลได้เอง ช่องที่เว้นว่างใช้คำตามภาษาที่เลือก{ownCount ? ` · แก้เองแล้ว ${ownCount} คำ` : ''}
            </Text>
            <SmallBtn label={showLabels ? 'ซ่อน' : 'แก้ไขคำ'} icon={showLabels ? 'chevron-up' : 'create-outline'} onPress={() => setShowLabels((o) => !o)} />
          </Pressable>
          {showLabels ? (
            <>
              {RECEIPT_LABELS.map(([key, name]) => {
                const def = defaultLabel(key, v.language);
                const own = v.labels[key] ?? '';
                return (
                  <View key={key} style={s.labelRow}>
                    <Text style={[s.toggleLabel, { width: 150 }]} numberOfLines={2}>{name}</Text>
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <Input value={own} onChange={(x) => set({ labels: { ...v.labels, [key]: x } })} placeholder={def || '(ใช้ชื่อในวิธีชำระเงิน)'} max={60} />
                    </View>
                    {own ? (
                      <Pressable onPress={() => { const l = { ...v.labels }; delete l[key]; set({ labels: l }); }} style={s.arrow} accessibilityLabel={`คืนค่า ${name}`}>
                        <Icon name="refresh-outline" size={15} color={colors.sub} />
                      </Pressable>
                    ) : <View style={{ width: 30 }} />}
                  </View>
                );
              })}
              <View style={[s.row, { justifyContent: 'flex-end' }]}>
                <SmallBtn label="คืนค่าเริ่มต้นทุกคำ" icon="refresh-outline" disabled={!ownCount} onPress={() => set({ labels: {} })} />
              </View>
            </>
          ) : null}
        </Card>
        <Card title="ข้อมูลที่แสดง">
          <Toggle label="ชื่อลูกค้า" value={v.showCustomer} onChange={(x) => set({ showCustomer: x })} />
          <Toggle label="พนักงานขาย" value={v.showSalesperson} onChange={(x) => set({ showSalesperson: x })} />
          <Toggle label="รหัส SKU ของสินค้า" value={v.showSku} onChange={(x) => set({ showSku: x })} />
          <Toggle label="บรรทัด VAT" hint="อัตรา VAT ตั้งที่ วิธีชำระเงิน & ค่าธรรมเนียม" value={v.showVat} onChange={(x) => set({ showVat: x })} />
          <Toggle label="บาร์โค้ดเลขที่บิล" hint="สแกนเพื่อค้นหาบิลในหน้าประวัติการขาย" value={v.showOrderBarcode} onChange={(x) => set({ showOrderBarcode: x })} />
          <Toggle label="พิมพ์อัตโนมัติหลังขาย" hint="ต้องอนุญาตป๊อปอัปในเบราว์เซอร์" value={v.autoPrint} onChange={(x) => set({ autoPrint: x })} />
        </Card>
      </View>
      <View style={[{ alignItems: 'center', gap: 6, minWidth: 300 }, Platform.OS === 'web' && ({ position: 'sticky', top: 0, alignSelf: 'flex-start' } as object)]}>
        <Text style={s.sub}>ตัวอย่างใบเสร็จ</Text>
        {preview}
      </View>
    </View>
  );
}
