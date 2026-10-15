// ตัวอย่างป้ายบาร์โค้ด — ใช้ HTML ชุดเดียวกับตอนพิมพ์จริง (iframe) จึงเห็นตรงกับที่จะพิมพ์ออกมา
import { createElement, useMemo } from 'react';
import { Platform, View } from 'react-native';
import type { LabelProfile } from '../../appSettings';
import { labelPreviewHtml, SAMPLE_LABEL, type LabelItem } from '../../labels';

const PX_PER_MM = 96 / 25.4;

export function LabelPreview({ profile, sample = SAMPLE_LABEL, maxWidth = 340 }: { profile: LabelProfile; sample?: LabelItem; maxWidth?: number }) {
  const rowMm = profile.paper === 'a4' ? 210 : profile.marginLeft + profile.cols * profile.width + (profile.cols - 1) * profile.gapX;
  const rows = profile.paper === 'a4' ? Math.min(2, profile.rows) : 1;
  const heightMm = profile.paper === 'a4' ? profile.marginTop + rows * profile.height + (rows - 1) * profile.gapY + 2 : profile.marginTop + profile.height;
  // ขยายให้พอดีกรอบ (ป้ายเล็กขยายได้ถึง 3 เท่า)
  const zoom = Math.max(0.5, Math.min(3, (maxWidth - 24) / (rowMm * PX_PER_MM)));
  const html = useMemo(() => labelPreviewHtml(profile, sample, Math.round(zoom * 100) / 100), [profile, sample, zoom]);
  if (Platform.OS !== 'web') return null;
  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      {createElement('iframe', {
        srcDoc: html,
        title: 'ตัวอย่างป้ายบาร์โค้ด',
        sandbox: '',
        style: { border: 0, width: Math.min(maxWidth, rowMm * PX_PER_MM * zoom + 24), height: heightMm * PX_PER_MM * zoom + 26, background: 'transparent' },
      })}
    </View>
  );
}
