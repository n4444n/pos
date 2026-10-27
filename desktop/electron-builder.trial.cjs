// ตัวติดตั้ง "ชุดทดลอง" — ตัวเดียวกันทุกร้าน · เปิดครั้งแรกให้กรอก license (ดู license-server/ และ deploy/license-setup.sh)
//   npm run dist:trial   →  release-trial/ClothingPOS-Trial-Setup-<เวอร์ชัน>.exe + latest.yml
// ต่างจากตัวหลัก: มี trial.json (ที่อยู่เซิร์ฟเวอร์ license) · appId/ชื่อแยก (ลงคู่กับตัวหลักได้) · อัปเดตจาก <license>/updates/
const base = require('./package.json').build;
const trial = require('./trial.json');

module.exports = {
  ...base,
  appId: 'com.n4444n.clothingpos.trial',
  productName: 'Clothing POS Trial',
  directories: { output: 'release-trial' },
  files: [...base.files.filter((f) => f !== 'app-key.txt'), 'trial.json'],
  publish: [{ provider: 'generic', url: `${trial.licenseServer.replace(/\/+$/, '')}/updates/` }],
  nsis: { ...base.nsis, shortcutName: 'Clothing POS (ทดลอง)', artifactName: 'ClothingPOS-Trial-Setup-${version}.exe' },
};
