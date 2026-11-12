// รูปวาดเสื้อผ้าแทนรูปสินค้า (เมื่อสินค้ายังไม่มีรูป)
import { memo } from 'react';
import Svg, { Path, G } from 'react-native-svg';

/**
 * ภาพสินค้าแบบเวกเตอร์ (ไม่ต้องโหลดรูป → เร็ว/ใช้งาน offline ได้)
 * เมื่อมีรูปจริง (imageUrl) ค่อยใช้ <Image> แทน
 */
type Shape = { body: string; details?: string };

const SHAPES: Record<string, Shape> = {
  tshirt: {
    body: 'M35 14 L43 11 Q50 19 57 11 L65 14 L86 28 L78 42 L69 37 L69 89 L31 89 L31 37 L22 42 L14 28 Z',
    details: 'M43 11 Q50 22 57 11',
  },
  polo: {
    body: 'M35 14 L43 11 L50 20 L57 11 L65 14 L86 28 L78 42 L69 37 L69 89 L31 89 L31 37 L22 42 L14 28 Z',
    details: 'M43 11 L50 26 L57 11 M50 20 L50 34',
  },
  longsleeve: {
    body: 'M35 13 L43 10 Q50 18 57 10 L65 13 L80 22 L90 76 L80 79 L69 40 L69 89 L31 89 L31 40 L20 79 L10 76 L20 22 Z',
    details: 'M43 10 Q50 21 57 10 M12 70 L21 73 M88 70 L79 73',
  },
  tank: {
    body: 'M36 10 L42 10 Q44 30 50 30 Q56 30 58 10 L64 10 Q66 28 72 34 L72 89 L28 89 L28 34 Q34 28 36 10 Z',
  },
  shirt: {
    body: 'M35 13 L44 10 L50 18 L56 10 L65 13 L80 22 L90 76 L80 79 L69 40 L69 89 L31 89 L31 40 L20 79 L10 76 L20 22 Z',
    details: 'M44 10 L42 20 L50 18 L58 20 L56 10 M50 18 L50 89 M47 30 h0.1 M47 44 h0.1 M47 58 h0.1 M47 72 h0.1 M58 34 h7 v6 h-7 Z',
  },
  blouse: {
    body: 'M36 13 L44 10 Q50 20 56 10 L64 13 L80 24 L86 58 L76 60 L68 38 Q70 64 72 89 L28 89 Q30 64 32 38 L24 60 L14 58 L20 24 Z',
    details: 'M44 10 Q50 26 56 10 M46 16 Q50 22 54 16',
  },
  pants: {
    body: 'M29 10 L71 10 L77 90 L56 90 L50 36 L44 90 L23 90 Z',
    details: 'M29 18 L71 18 M50 18 L50 30 M36 18 Q38 26 33 28 M64 18 Q62 26 67 28',
  },
  shorts: {
    body: 'M26 22 L74 22 L80 70 L56 72 L50 46 L44 72 L20 70 Z',
    details: 'M26 30 L74 30 M50 30 L50 42',
  },
  dress: {
    body: 'M39 8 L45 8 Q50 15 55 8 L61 8 L62 24 Q67 32 63 40 L84 91 L16 91 L37 40 Q33 32 38 24 Z',
    details: 'M37 40 Q50 46 63 40',
  },
  slipdress: {
    body: 'M38 8 L40 8 L42 26 Q50 30 58 26 L60 8 L62 8 L64 30 L76 91 L24 91 L36 30 Z',
  },
  skirt: {
    body: 'M32 18 L68 18 L86 86 L14 86 Z',
    details: 'M32 26 L68 26 M42 26 L34 86 M50 26 L50 86 M58 26 L66 86',
  },
  hoodie: {
    body: 'M36 18 Q38 4 50 4 Q62 4 64 18 L80 24 L90 78 L80 81 L70 42 L70 90 L30 90 L30 42 L20 81 L10 78 L20 24 Z',
    details: 'M40 20 Q50 30 60 20 M46 26 L45 40 M54 26 L55 40 M36 64 L64 64 L60 78 L40 78 Z',
  },
  jacket: {
    body: 'M35 13 L44 9 L50 16 L56 9 L65 13 L80 22 L90 76 L80 79 L69 40 L69 89 L31 89 L31 40 L20 79 L10 76 L20 22 Z',
    details: 'M44 9 L40 30 L50 40 L60 30 L56 9 M50 40 L50 89 M35 60 L45 60 M55 60 L65 60 M31 84 L69 84',
  },
  sweater: {
    body: 'M35 14 L43 10 Q50 17 57 10 L65 14 L80 22 L90 76 L80 79 L69 40 L69 89 L31 89 L31 40 L20 79 L10 76 L20 22 Z',
    details: 'M43 10 Q50 20 57 10 M31 82 L69 82 M12 70 L21 73 M88 70 L79 73',
  },
  bag: {
    body: 'M20 36 L80 36 L84 90 L16 90 Z',
    details: 'M36 36 Q36 12 50 12 Q64 12 64 36',
  },
  cap: {
    body: 'M20 58 Q20 26 50 26 Q80 26 80 58 Z M50 58 L94 64 Q92 72 76 70 L50 66 Z',
    details: 'M50 26 L50 58 M50 24 h0.1',
  },
  socks: {
    body: 'M30 10 L52 10 L52 58 Q52 64 58 68 L74 76 Q84 82 78 90 L44 90 Q30 90 30 74 Z',
    details: 'M30 18 L52 18 M30 24 L52 24',
  },
  belt: {
    body: 'M8 42 L70 42 L70 58 L8 58 Z M70 36 L92 36 L92 64 L70 64 Z',
    details: 'M76 42 L86 42 L86 58 L76 58 Z M81 50 L64 50 M20 50 h0.1 M30 50 h0.1 M40 50 h0.1',
  },
  scarf: {
    body: 'M30 10 L70 10 L70 30 Q60 40 64 50 L66 90 L52 90 L50 54 Q40 46 30 30 Z',
    details: 'M54 84 L54 90 M58 84 L58 90 M62 84 L62 90 M34 18 L66 18',
  },
};

function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function luminance(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

interface Props {
  art: string;
  color: string;
  size?: number;
  outline?: boolean;
}

function GarmentArtImpl({ art, color, size = 96, outline }: Props) {
  const shape = SHAPES[art] ?? SHAPES.tshirt;
  const light = luminance(color) > 0.8;
  const stroke = outline ? color : light ? '#B9BEC7' : shade(color, -0.18);
  const detail = outline ? color : light ? '#C9CDD4' : luminance(color) < 0.3 ? shade(color, 0.25) : shade(color, -0.22);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <G strokeLinejoin="round" strokeLinecap="round">
        <Path d={shape.body} fill={outline ? 'none' : color} stroke={stroke} strokeWidth={outline ? 6 : 2} />
        {shape.details ? (
          <Path d={shape.details} fill="none" stroke={detail} strokeWidth={outline ? 4.5 : 2} />
        ) : null}
      </G>
    </Svg>
  );
}

export const GarmentArt = memo(GarmentArtImpl);
