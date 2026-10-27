// ใบลดหนี้ (รับคืนสินค้า) ในรายงานยอดขาย — หักตามวันที่ออกใบลดหนี้ (บิลเดิมไม่เปลี่ยน)
// ใช้ร่วมกัน: รายงานรวม (dashboard.ts) · รายงานยอดขาย / สินค้า / รายบิล (reports.ts) — ให้ตัวเลขตรงกับรายงานภาษีขาย
// ตาราง credit_notes / credit_note_items สร้างใน taxDocs.ts (เรียกใช้หลังเซิร์ฟเวอร์โหลดครบแล้ว)

/** ใบลดหนี้ของสาขาที่เลือก (0 = ทุกสาขา) ในช่วงวันที่ — args: [from, to] */
export const CN_RANGE = `((SELECT branch_id FROM temp.ctx) = 0 OR cn.branch_id = (SELECT branch_id FROM temp.ctx))
  AND date(cn.issued_at) BETWEEN ? AND ?`;

/** รายการสินค้าในใบลดหนี้ + ต้นทุนต่อชิ้น (v / p ชื่อเดียวกับที่รายงานใช้) */
export const CNI_FROM = `FROM credit_note_items ci
  JOIN credit_notes cn ON cn.id = ci.credit_note_id
  LEFT JOIN variants_all v ON v.id = ci.variant_id
  LEFT JOIN products p ON p.id = v.product_id`;

/** ต้นทุนของสินค้าที่คืน */
export const CNI_COST = 'ci.qty * COALESCE(v.cost, p.cost, 0)';

/** ยอดก่อน VAT ของรายการที่คืน (สัดส่วนจากยอดคืนของใบลดหนี้) */
export const CNI_EXVAT = 'CASE WHEN cn.gross > 0 THEN ci.line_total * (cn.total - cn.vat) / cn.gross ELSE 0 END';

/** ยอดคืนต่อบิล (รายงานรายบิล — ทุกใบลดหนี้ของบิลนั้น) */
export const CN_PER_BILL = `LEFT JOIN (SELECT order_id, SUM(total) AS refund, SUM(vat) AS vat FROM credit_notes GROUP BY order_id) cr ON cr.order_id = o.id
  LEFT JOIN (SELECT cn.order_id, SUM(ci.qty) AS units, SUM(${CNI_COST}) AS cost ${CNI_FROM} GROUP BY cn.order_id) ri ON ri.order_id = o.id`;
