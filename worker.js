// 翊の生物 · 同步碼服務（Cloudflare Worker + KV）
// 用途：學生在舊裝置產生一組六位同步碼，新裝置輸入同一組碼把學習進度帶過去。
// 存的內容只有刷題進度、錯題本、已讀講義、手寫筆記，沒有姓名或任何個資。

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉 0O1I 之類容易看錯的字
const CODE_LEN = 6;
const TTL = 60 * 60 * 24 * 180;      // 180 天沒用到就自動清掉
const MAX_BYTES = 900 * 1024;         // 單筆上限，避免被灌爆

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}
function newCode() {
  const a = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += ALPHABET[b % ALPHABET.length];
  return s;
}
function clean(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LEN);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

    // 健康檢查：瀏覽器直接開這個網址會看到
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: '翊の生物 同步碼', time: new Date().toISOString() }, 200, origin);
    }

    // 取回：GET /load?code=XXXXXX
    if (url.pathname === '/load' && request.method === 'GET') {
      const code = clean(url.searchParams.get('code'));
      if (code.length !== CODE_LEN) return json({ error: '同步碼格式不對' }, 400, origin);
      const raw = await env.SYNC.get('c:' + code);
      if (!raw) return json({ error: '查不到這組同步碼，可能已過期或打錯了' }, 404, origin);
      return json({ ok: true, code, data: JSON.parse(raw) }, 200, origin);
    }

    // 存檔：POST /save  body {data, code?}
    if (url.pathname === '/save' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: '資料格式不對' }, 400, origin); }
      if (!body || typeof body.data !== 'object' || body.data === null) {
        return json({ error: '沒有收到進度資料' }, 400, origin);
      }
      const payload = JSON.stringify(body.data);
      if (payload.length > MAX_BYTES) {
        return json({ error: '資料太大，請先在「清除紀錄」把手寫筆記整理過再同步' }, 413, origin);
      }
      let code = clean(body.code);
      if (code.length !== CODE_LEN) {
        // 產生新碼，最多試五次避開已存在的
        for (let i = 0; i < 5; i++) {
          const c = newCode();
          if (!(await env.SYNC.get('c:' + c))) { code = c; break; }
        }
        if (code.length !== CODE_LEN) return json({ error: '請再試一次' }, 503, origin);
      }
      await env.SYNC.put('c:' + code, payload, { expirationTtl: TTL });
      return json({ ok: true, code, at: new Date().toISOString() }, 200, origin);
    }

    return json({ error: 'not found' }, 404, origin);
  },
};
