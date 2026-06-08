// ============================================================
// KabuMushi 株価取得サーバー（J-Quants API V2 / APIキー方式）
// 配置場所: GitHubリポジトリの  api/prices.js
//
// 【レート制限対策】銘柄ごとに10回叩くのではなく、
// 「ある営業日の全銘柄株価」を1回のリクエストで取得し、
// その中から欲しい10銘柄を抜き出す方式。これで429を回避する。
//
// Vercelの環境変数（1つ）:
//   JQUANTS_API_KEY … J-Quantsダッシュボードで発行したAPIキー
//
// ※ 個人の検証用途。第三者向けサービスへの組み込み公開は規約確認が必要。
// ============================================================

// 欲しい銘柄（5桁コード = 4桁+0）→ 表示名
const WANT = {
  '72030': 'トヨタ',
  '99840': 'ソフトバンク',
  '83060': '三菱UFJ',
  '79740': '任天堂',
  '68610': 'キーエンス',
  '99830': 'ファーストリテ',
  '94320': 'NTT',
  '72670': 'ホンダ',
  '45230': 'エーザイ',
  '47550': '楽天',
};

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 指定日の「全銘柄」株価を1回で取得（ページネーション対応）
async function fetchAllForDate(dateStr, apiKey) {
  let url = `https://api.jquants.com/v2/equities/bars/daily?date=${dateStr}`;
  const all = [];
  for (let guard = 0; guard < 12; guard++) {
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`${res.status} ${txt}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const quotes = data.daily_quotes || [];
    all.push(...quotes);
    if (data.pagination_key) {
      url = `https://api.jquants.com/v2/equities/bars/daily?date=${dateStr}&pagination_key=${encodeURIComponent(data.pagination_key)}`;
    } else {
      break;
    }
  }
  return all;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // 1時間キャッシュ
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    const apiKey = process.env.JQUANTS_API_KEY;
    if (!apiKey) throw new Error('環境変数 JQUANTS_API_KEY が未設定です');

    // 無料プランは約12週間遅延。少し前の日付から、データが取れる営業日を探す
    let quotes = null;
    let usedDate = null;
    let lastErr = null;
    for (let back = 84; back <= 100; back++) {
      const d = new Date();
      d.setDate(d.getDate() - back);
      const ds = fmtDate(d);
      try {
        const arr = await fetchAllForDate(ds, apiKey);
        if (arr && arr.length > 0) { quotes = arr; usedDate = ds; break; }
      } catch (e) {
        lastErr = e;
        if (e.status === 429) {
          await sleep(2000);
        }
      }
      await sleep(300);
    }

    if (!quotes) {
      throw new Error('株価データを取得できる営業日が見つかりませんでした' + (lastErr ? '（最後のエラー: ' + lastErr.message + '）' : ''));
    }

    // 全銘柄の中から欲しい10銘柄を抜き出す
    const prices = {};
    Object.values(WANT).forEach(n => prices[n] = null);
    for (const q of quotes) {
      const code = String(q.Code || q.code || '');
      if (WANT[code]) {
        const close = q.Close;
        if (close !== undefined && close !== null) {
          prices[WANT[code]] = Number(close);
        }
      }
    }

    res.status(200).json({ ok: true, prices, date: usedDate, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
