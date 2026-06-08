// ============================================================
// KabuMushi 株価取得サーバー（J-Quants API版）
// 配置場所: GitHubリポジトリの  api/prices.js
// 役割: J-Quantsから主要10銘柄の最新株価を取得してゲームに返す
//
// メール&パスワードは Vercel の環境変数に登録する（コードには書かない）:
//   JQUANTS_MAIL     … J-Quants登録メールアドレス
//   JQUANTS_PASSWORD … J-Quantsログインパスワード
// ============================================================

// 主要10銘柄（4桁コード）。J-Quantsでは末尾に0を付けた5桁で問い合わせる
const COMPANIES = [
  { name: 'トヨタ',        code: '7203' },
  { name: 'ソフトバンク',  code: '9984' },
  { name: '三菱UFJ',       code: '8306' },
  { name: '任天堂',        code: '7974' },
  { name: 'キーエンス',    code: '6861' },
  { name: 'ファーストリテ', code: '9983' },
  { name: 'NTT',           code: '9432' },
  { name: 'ホンダ',        code: '7267' },
  { name: 'エーザイ',      code: '4523' },
  { name: '楽天',          code: '4755' },
];

// トークンをメモリにキャッシュ（毎回取り直さないように）
let cachedIdToken = null;
let cachedAt = 0;
const ID_TOKEN_TTL = 20 * 60 * 60 * 1000; // 20時間（IDトークンは24時間有効）

// 日付を YYYY-MM-DD 形式にする
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// メール&パスワード → リフレッシュトークン → IDトークン を取得
async function getIdToken() {
  // キャッシュが有効ならそれを使う
  if (cachedIdToken && (Date.now() - cachedAt) < ID_TOKEN_TTL) {
    return cachedIdToken;
  }

  const mail = process.env.JQUANTS_MAIL;
  const password = process.env.JQUANTS_PASSWORD;
  if (!mail || !password) {
    throw new Error('環境変数 JQUANTS_MAIL / JQUANTS_PASSWORD が未設定です');
  }

  // 1) リフレッシュトークン取得
  const refRes = await fetch('https://api.jquants.com/v1/token/auth_user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mailaddress: mail, password: password }),
  });
  if (!refRes.ok) {
    const txt = await refRes.text();
    throw new Error('リフレッシュトークン取得失敗: ' + txt);
  }
  const refData = await refRes.json();
  const refreshToken = refData.refreshToken;

  // 2) IDトークン取得
  const idRes = await fetch(
    'https://api.jquants.com/v1/token/auth_refresh?refreshtoken=' + encodeURIComponent(refreshToken),
    { method: 'POST' }
  );
  if (!idRes.ok) {
    const txt = await idRes.text();
    throw new Error('IDトークン取得失敗: ' + txt);
  }
  const idData = await idRes.json();
  cachedIdToken = idData.idToken;
  cachedAt = Date.now();
  return cachedIdToken;
}

// 1銘柄の最新終値を取得（無料プランは12週間遅延なので過去90〜120日を見る）
async function fetchLatestClose(code5, idToken) {
  const to = new Date();
  to.setDate(to.getDate() - 84);    // 約12週間前
  const from = new Date();
  from.setDate(from.getDate() - 120); // さらに前から
  const url = `https://api.jquants.com/v1/prices/daily_quotes?code=${code5}&from=${fmtDate(from)}&to=${fmtDate(to)}`;

  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + idToken } });
  if (!res.ok) return null;
  const data = await res.json();
  const quotes = data.daily_quotes;
  if (!quotes || quotes.length === 0) return null;

  // 新しい順に並べ替えて、終値が入っている最新レコードを探す
  quotes.reverse();
  for (const q of quotes) {
    const close = q.AdjustmentClose || q.Close;
    if (close) return Number(close);
  }
  return null;
}

// メイン処理（Vercelがこの関数を呼ぶ）
export default async function handler(req, res) {
  // ゲーム（ブラウザ）からの呼び出しを許可
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1時間サーバー側キャッシュ

  try {
    const idToken = await getIdToken();

    // 10銘柄を順番に取得
    const results = {};
    for (const c of COMPANIES) {
      const code5 = c.code + '0'; // 4桁→5桁
      const price = await fetchLatestClose(code5, idToken);
      results[c.name] = price; // 取れなければ null
    }

    res.status(200).json({ ok: true, prices: results, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
