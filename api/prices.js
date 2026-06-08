// ============================================================
// KabuMushi 株価取得サーバー（J-Quants API V2 / APIキー方式）
// 配置場所: GitHubリポジトリの  api/prices.js
// 役割: J-Quants V2から主要10銘柄の最新株価を取得してゲームに返す
//
// Vercelの環境変数に登録するもの（1つだけ）:
//   JQUANTS_API_KEY … J-Quantsのダッシュボードで発行したAPIキー
//
// ※ 個人の検証用途。Freeプランのデータを第三者向けサービスに
//    組み込んで公開する場合は利用規約の確認・商用契約が必要。
// ============================================================

// 主要10銘柄（4桁コード）。V2でも5桁（末尾0付き）で問い合わせる
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

// 日付を YYYY-MM-DD 形式にする
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 1銘柄の最新終値を取得（V2 / APIキー方式）
// Freeプランは約12週間遅延なので、過去90〜120日の範囲を見る
async function fetchLatestClose(code5, apiKey) {
  const to = new Date();
  to.setDate(to.getDate() - 84);     // 約12週間前
  const from = new Date();
  from.setDate(from.getDate() - 120); // さらに前から
  const url = `https://api.jquants.com/v2/equities/bars/daily?code=${code5}&from=${fmtDate(from)}&to=${fmtDate(to)}`;

  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`株価取得失敗(${code5}): ${res.status} ${txt}`);
  }
  const data = await res.json();
  const quotes = data.daily_quotes;
  if (!quotes || quotes.length === 0) return null;

  // 新しい順にして、終値が入っている最新レコードを探す
  quotes.reverse();
  for (const q of quotes) {
    const close = q.Close;
    if (close !== undefined && close !== null) return Number(close);
  }
  return null;
}

// メイン処理（Vercelがこの関数を呼ぶ）
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1時間サーバー側キャッシュ

  try {
    const apiKey = process.env.JQUANTS_API_KEY;
    if (!apiKey) {
      throw new Error('環境変数 JQUANTS_API_KEY が未設定です');
    }

    const results = {};
    let firstError = null;
    for (const c of COMPANIES) {
      const code5 = c.code + '0'; // 4桁→5桁
      try {
        results[c.name] = await fetchLatestClose(code5, apiKey);
      } catch (e) {
        results[c.name] = null;
        if (!firstError) firstError = String(e.message || e);
      }
    }

    res.status(200).json({
      ok: true,
      prices: results,
      note: firstError ? ('一部取得に問題: ' + firstError) : undefined,
      updated: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}