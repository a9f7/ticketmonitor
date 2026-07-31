// 日本全境目的地清单（供机票监控与枫叶监控共用）
// area: 九大地方，用于枫叶物候时间表（koyo.js）
// region 统一为 'japan'，与国内/亚洲等区分开。
module.exports = [
  // ===== 北海道 =====
  { code: 'CTS', city: '札幌', area: 'hokkaido', region: 'japan', lat: 42.7882, lng: 141.6455, tz: 9 },
  { code: 'AKJ', city: '旭川', area: 'hokkaido', region: 'japan', lat: 43.6703, lng: 142.4448, tz: 9 },
  { code: 'HKD', city: '函馆', area: 'hokkaido', region: 'japan', lat: 41.7712, lng: 140.7293, tz: 9 },
  // ===== 东北 =====
  { code: 'AOJ', city: '青森', area: 'tohoku', region: 'japan', lat: 40.8214, lng: 140.7899, tz: 9 },
  { code: 'AXT', city: '秋田', area: 'tohoku', region: 'japan', lat: 39.6179, lng: 140.0879, tz: 9 },
  { code: 'SDJ', city: '仙台', area: 'tohoku', region: 'japan', lat: 38.1375, lng: 140.9233, tz: 9 },
  { code: 'HNA', city: '花卷(盛冈)', area: 'tohoku', region: 'japan', lat: 39.6421, lng: 141.3516, tz: 9 },
  // ===== 关东 =====
  { code: 'TYO', city: '东京', area: 'kanto', region: 'japan', lat: 35.6762, lng: 139.6503, tz: 9, alt: 'HND' },
  { code: 'NRT', city: '成田(东京)', area: 'kanto', region: 'japan', lat: 35.7647, lng: 140.3863, tz: 9 },
  // ===== 中部 =====
  { code: 'NGO', city: '名古屋', area: 'chubu', region: 'japan', lat: 34.8588, lng: 136.8055, tz: 9, alt: 'NKM' },
  { code: 'FSZ', city: '静冈', area: 'chubu', region: 'japan', lat: 34.7896, lng: 138.1953, tz: 9 },
  { code: 'TOY', city: '富山', area: 'chubu', region: 'japan', lat: 36.6710, lng: 137.2270, tz: 9 },
  { code: 'KMQ', city: '金泽(小松)', area: 'chubu', region: 'japan', lat: 36.3948, lng: 136.4064, tz: 9 },
  { code: 'KIJ', city: '新潟', area: 'chubu', region: 'japan', lat: 37.3988, lng: 138.4432, tz: 9 },
  // ===== 关西 =====
  { code: 'OSA', city: '大阪', area: 'kansai', region: 'japan', lat: 34.6937, lng: 135.5023, tz: 9, alt: 'ITM' },
  { code: 'KIX', city: '关西(大阪)', area: 'kansai', region: 'japan', lat: 34.4347, lng: 135.2440, tz: 9 },
  { code: 'UKB', city: '神户', area: 'kansai', region: 'japan', lat: 34.6324, lng: 135.2189, tz: 9 },
  // ===== 中国 =====
  { code: 'HIJ', city: '广岛', area: 'chugoku', region: 'japan', lat: 34.4432, lng: 132.5594, tz: 9 },
  { code: 'OKJ', city: '冈山', area: 'chugoku', region: 'japan', lat: 34.6687, lng: 133.9357, tz: 9 },
  { code: 'YGJ', city: '米子(鸟取)', area: 'chugoku', region: 'japan', lat: 35.4930, lng: 133.3267, tz: 9 },
  // ===== 四国 =====
  { code: 'TAK', city: '高松', area: 'shikoku', region: 'japan', lat: 34.4234, lng: 134.0910, tz: 9 },
  { code: 'MYJ', city: '松山', area: 'shikoku', region: 'japan', lat: 33.8272, lng: 132.6983, tz: 9 },
  { code: 'KCZ', city: '高知', area: 'shikoku', region: 'japan', lat: 33.5967, lng: 133.6590, tz: 9 },
  { code: 'TCY', city: '德岛', area: 'shikoku', region: 'japan', lat: 34.0669, lng: 134.5550, tz: 9 },
  // ===== 九州 =====
  { code: 'FUK', city: '福冈', area: 'kyushu', region: 'japan', lat: 33.5904, lng: 130.4017, tz: 9 },
  { code: 'KMJ', city: '熊本', area: 'kyushu', region: 'japan', lat: 32.8338, lng: 130.6909, tz: 9 },
  { code: 'NGS', city: '长崎', area: 'kyushu', region: 'japan', lat: 32.7538, lng: 129.8732, tz: 9 },
  { code: 'KOJ', city: '鹿儿岛', area: 'kyushu', region: 'japan', lat: 31.8014, lng: 130.3024, tz: 9 },
  { code: 'OIT', city: '大分', area: 'kyushu', region: 'japan', lat: 33.2382, lng: 131.6207, tz: 9 },
  { code: 'KMI', city: '宫崎', area: 'kyushu', region: 'japan', lat: 31.9108, lng: 131.6453, tz: 9 },
  { code: 'KKJ', city: '北九州', area: 'kyushu', region: 'japan', lat: 33.8469, lng: 130.9667, tz: 9 },
  // ===== 冲绳 =====
  { code: 'OKA', city: '冲绳', area: 'okinawa', region: 'japan', lat: 26.2124, lng: 127.6809, tz: 9 },
  { code: 'ISG', city: '石垣岛', area: 'okinawa', region: 'japan', lat: 24.3345, lng: 124.1555, tz: 9 },
  { code: 'MMY', city: '宫古岛', area: 'okinawa', region: 'japan', lat: 24.7823, lng: 125.2794, tz: 9 },
];
