// 校验 city_trip_id.js 的国际城市 ID：抓 ?city={id} 的 <title>，判断是否正确解析到该城市
const fs = require('fs');
const path = require('path');
const https = require('https');

const CT = require('./city_trip_id.js');

// IATA -> 期望英文城市名（用于比对 title）
const EN = {
  ICN: 'Seoul', PUS: 'Busan', CJU: 'Jeju',
  TYO: 'Tokyo', OSA: 'Osaka', KYO: 'Kyoto', NGO: 'Nagoya', CTS: 'Sapporo', SPK: 'Sapporo',
  FUK: 'Fukuoka', OKA: 'Okinawa', HKD: 'Hakodate', HIJ: 'Hiroshima', SDJ: 'Sendai',
  BKK: 'Bangkok', HKT: 'Phuket', CNX: 'Chiang',
  HAN: 'Hanoi', SGN: 'Ho', CXR: 'Nha', PQC: 'Phu',
  KUL: 'Kuala', DPS: 'Bali', SIN: 'Singapore', MNL: 'Manila',
  DXB: 'Dubai', DOH: 'Doha',
  SYD: 'Sydney', MEL: 'Melbourne', BNE: 'Brisbane', AKL: 'Auckland',
  LON: 'London', PAR: 'Paris', ROM: 'Rome', MIL: 'Milan', MAD: 'Madrid', BCN: 'Barcelona',
  FRA: 'Frankfurt', AMS: 'Amsterdam', ZRH: 'Zurich', VIE: 'Vienna', MOW: 'Moscow',
  NYC: 'New', LAX: 'Los', SFO: 'San', SEA: 'Seattle', YVR: 'Vancouver', YTO: 'Toronto',
};

function fetchTitle(id) {
  return new Promise((resolve) => {
    const url = `https://www.trip.com/hotels/list?city=${id}`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow one redirect
        const r2 = https.get(res.headers.location.startsWith('http') ? res.headers.location : 'https://www.trip.com' + res.headers.location, {
          headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000,
        }, (res2) => {
          let buf = '';
          res2.on('data', (d) => (buf += d));
          res2.on('end', () => resolve(extractTitle(buf)));
        });
        r2.on('error', () => resolve(''));
        r2.on('timeout', () => { r2.destroy(); resolve(''); });
        return;
      }
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => resolve(extractTitle(buf)));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}
function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

(async () => {
  const intl = Object.entries(CT).filter(([k, v]) => !['PEK','BJS','SHA','CAN','SZX','HGH','CTU','CSX','XIY','CKG','WUH','KMG','TAO','DLC','SHE','HRB','CGQ','TSN','TYN','HET','INC','LHW','XNN','URC','LXA','SYX','HAK','XMN','FOC','NKG','HFE','KHN','TNA','NNG','KWL','LJG','DYG','JJN','WNZ','YNT','KWE','CGO','FUO','ZUH','HKG','MFM','TPE'].includes(k));
  const results = [];
  for (const [code, v] of intl) {
    const title = await fetchTitle(v.city);
    const en = EN[code] || '';
    const ok = en && title.toLowerCase().includes(en.toLowerCase());
    results.push({ code, name: v.name, id: v.city, title, ok });
    console.log(`${ok ? 'OK ' : 'BAD'} ${code} ${v.name} id=${v.city} | ${title}`);
    await new Promise((r) => setTimeout(r, 700));
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n=== 共 ${results.length} 个，正确 ${results.length - bad.length}，错误 ${bad.length} ===`);
  if (bad.length) console.log('错误列表:', bad.map((b) => `${b.code}(${b.name}):${b.id}`).join(', '));
})();
