// ============================================================
// KabutoMushi 株価取得サーバー（J-Quants API V2 / APIキー方式）
// 配置場所: GitHubリポジトリの  api/prices.js
//
// V2の正しい仕様（実データで確認済み）:
//   - エンドポイント: https://api.jquants.com/v2/equities/bars/daily
//   - 認証: ヘッダー x-api-key
//   - 日付指定 ?date=YYYY-MM-DD で全銘柄を1回で取得
//   - レスポンスは { "data": [ {...}, ... ] }
//   - 各レコード: Code=銘柄コード(5桁), C=終値, AdjC=調整後終値
//   - Freeプランは1分5回制限・データは数ヶ月遅延
//
// Vercel環境変数（1つ）: JQUANTS_API_KEY
// ※ 個人の検証用途。第三者向けサービス組み込み公開は規約確認が必要。
// ============================================================

const WANT = {
  '72030': 'トヨタ', '99840': 'ソフトバンク', '83060': '三菱UFJ',
  '79740': '任天堂', '68610': 'キーエンス', '99830': 'ファーストリテ',
  '94320': 'NTT', '72670': 'ホンダ', '45230': 'エーザイ', '47550': '楽天',
};

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 約150日前を起点に、祝日リスクの低い水曜へ寄せる
function pickBusinessDate() {
  const d = new Date();
  d.setDate(d.getDate() - 150);
  const dow = d.getDay();
  const diff = (dow - 3 + 7) % 7; // 直近の水曜まで戻す
  d.setDate(d.getDate() - diff);
  return fmtDate(d);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600'); // 6時間キャッシュ

  try {
    const apiKey = process.env.JQUANTS_API_KEY;
    if (!apiKey) throw new Error('環境変数 JQUANTS_API_KEY が未設定です');

    const dateStr = pickBusinessDate();

    // 全銘柄を取得（基本1回。ページネーションがあれば続きも）
    let url = `https://api.jquants.com/v2/equities/bars/daily?date=${dateStr}`;
    const all = [];
    let pages = 0;
    while (url && pages < 6) {
      pages++;
      const r = await fetch(url, { headers: { 'x-api-key': apiKey } });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(200).json({
          ok: false, httpStatus: r.status, date: dateStr, error: txt,
          hint: r.status === 429 ? 'Freeプランは1分5回まで。数分待って再度開いてください。' : undefined,
        });
      }
      const data = await r.json();
      const arr = data.data || [];           // ★V2は "data" キー
      arr.forEach(q => all.push(q));
      if (data.pagination_key) {
        url = `https://api.jquants.com/v2/equities/bars/daily?date=${dateStr}&pagination_key=${encodeURIComponent(data.pagination_key)}`;
      } else {
        url = null;
      }
    }

    // 欲しい10社を抜き出す（終値は AdjC優先、なければ C）
    const prices = {};
    Object.values(WANT).forEach(n => prices[n] = null);
    let matched = 0;
    for (const q of all) {
      const code = String(q.Code || '');
      if (WANT[code]) {
        const close = (q.AdjC != null) ? q.AdjC : q.C;  // ★終値は C / AdjC
        if (close != null) { prices[WANT[code]] = Number(close); matched++; }
      }
    }

    res.status(200).json({
      ok: true,
      date: dateStr,
      records: all.length,
      matched,
      prices,
      updated: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
