// ============================================================
// KabuMushi 株価取得サーバー（J-Quants API V2 / APIキー方式）
// 配置場所: GitHubリポジトリの  api/prices.js
//
// 【重要】Freeプランは「1分間に5リクエスト」しか叩けない。
// さらに大幅超過すると5分ほど全遮断される。
// そこで、APIを叩くのは原則【1回だけ】にする。
//   - 日付指定で全銘柄を一括取得（公式推奨）
//   - 営業日は「12週間前を起点に、土日なら金曜まで戻す」1回で確定
//   - ページネーションが出た場合のみ追加取得（通常は出ない）
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

// 12週間前を起点に、土日なら直前の金曜へ戻して1営業日を決める
function pickBusinessDate() {
  const d = new Date();
  d.setDate(d.getDate() - 90); // 約12.8週間前（遅延の安全圏）
  const dow = d.getDay(); // 0=日,6=土
  if (dow === 0) d.setDate(d.getDate() - 2); // 日→金
  else if (dow === 6) d.setDate(d.getDate() - 1); // 土→金
  return fmtDate(d);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600'); // 6時間キャッシュ（叩く回数を最小化）

  try {
    const apiKey = process.env.JQUANTS_API_KEY;
    if (!apiKey) throw new Error('環境変数 JQUANTS_API_KEY が未設定です');

    const dateStr = pickBusinessDate();

    // ★APIを叩くのは基本1回だけ
    let url = `https://api.jquants.com/v2/equities/bars/daily?date=${dateStr}`;
    const all = [];
    let pages = 0;
    while (url && pages < 6) {
      pages++;
      const r = await fetch(url, { headers: { 'x-api-key': apiKey } });
      if (!r.ok) {
        const txt = await r.text();
        // 429やその他はそのまま返して、状況を可視化
        return res.status(200).json({
          ok: false,
          stage: 'fetch',
          httpStatus: r.status,
          date: dateStr,
          error: txt,
          hint: r.status === 429
            ? 'Freeプランは1分5回まで。数分待ってから1回だけ開いてください。'
            : undefined,
        });
      }
      const data = await r.json();
      (data.daily_quotes || []).forEach(q => all.push(q));
      if (data.pagination_key) {
        url = `https://api.jquants.com/v2/equities/bars/daily?date=${dateStr}&pagination_key=${encodeURIComponent(data.pagination_key)}`;
      } else {
        url = null;
      }
    }

    const prices = {};
    Object.values(WANT).forEach(n => prices[n] = null);
    let matched = 0;
    for (const q of all) {
      const code = String(q.Code || q.code || '');
      if (WANT[code] && q.Close != null) { prices[WANT[code]] = Number(q.Close); matched++; }
    }

    res.status(200).json({
      ok: true,
      date: dateStr,
      records: all.length,   // その日の全銘柄数（数千件のはず）
      matched,               // 欲しい10社のうち取れた数
      prices,
      updated: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
