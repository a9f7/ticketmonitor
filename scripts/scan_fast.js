// 快速扫描 trip.com ?city={id} -> 城市 slug/名称
// 关键优化: <title>/canonical 都在 head, 拿到后立刻 destroy 连接, 不下载 1-3MB 正文
// 用法: node scan_fast.js <start> <end> <concurrency> <outFile>
const fs = require('fs');
const path = require('path');
const https = require('https');

const start = parseInt(process.argv[2] || '1', 10);
const end = parseInt(process.argv[3] || '900', 10);
const conc = parseInt(process.argv[4] || '8', 10);
const out = path.join(__dirname, process.argv[5] || '_fastscan.json');

let map = {};
try { map = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { map = {}; }

const agent = new https.Agent({ keepAlive: true, maxSockets: conc * 2 });

function fetchOne(id) {
  return new Promise((resolve) => {
    const req = https.get(`https://www.trip.com/hotels/list?city=${id}`, {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Encoding': 'identity',
      },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { res.destroy(); req.destroy(); } catch (e) {}
        const tm = buf.match(/<title>([^<]*)<\/title>/i);
        const title = tm ? tm[1].trim() : '';
        const cm = buf.match(/canonical"?\s+href="https:\/\/www\.trip\.com\/hotels\/([a-z0-9-]+)-hotels-list-(\d+)\//i);
        resolve({
          status: res.statusCode,
          title,
          slug: cm ? cm[1] : '',
          canonId: cm ? parseInt(cm[2], 10) : 0,
        });
      };
      res.on('data', (d) => {
        buf += d;
        // canonical 出现即可停; 兜底 200KB 强停
        if (/canonical"?\s+href="https:\/\/www\.trip\.com\/hotels\/[a-z0-9-]+-hotels-list-\d+\//i.test(buf)) finish();
        else if (buf.length > 200000) finish();
      });
      res.on('end', finish);
      res.on('error', finish);
    });
    req.on('error', () => resolve({ status: 0, title: '', slug: '', canonId: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, title: '', slug: '', canonId: 0 }); });
  });
}

(async () => {
  const ids = [];
  for (let i = start; i <= end; i++) if (!(map[i] && map[i].slug)) ids.push(i);
  console.log(`todo=${ids.length} conc=${conc} out=${path.basename(out)}`);

  let idx = 0, finished = 0, blocked = 0;
  const t0 = Date.now();
  let lastSave = Date.now();

  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++];
      const r = await fetchOne(id);
      map[id] = r;
      finished++;
      if (r.status === 403 || r.status === 429) blocked++;
      if (finished % 50 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${finished}/${ids.length} ${el.toFixed(0)}s (${(finished / el).toFixed(1)}/s) last id=${id} slug="${r.slug}"`);
      }
      // 周期性写盘, 防中断丢数据
      if (Date.now() - lastSave > 5000) {
        lastSave = Date.now();
        try { fs.writeFileSync(out, JSON.stringify(map)); } catch (e) {}
      }
    }
  }

  await Promise.all(Array.from({ length: conc }, worker));
  fs.writeFileSync(out, JSON.stringify(map));
  const el = (Date.now() - t0) / 1000;
  const good = Object.values(map).filter((v) => v && v.slug).length;
  console.log(`DONE ${finished} in ${el.toFixed(0)}s | withSlug=${good} | blocked=${blocked} | saved ${out}`);
})();
