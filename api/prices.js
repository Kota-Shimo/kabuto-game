// ============================================================
// 【デバッグ専用】J-Quants V2 が実際に何を返すか生で確認する
// 配置場所: api/prices.js （※確認後に本番版へ戻す）
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.JQUANTS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ ok: false, error: 'JQUANTS_API_KEY未設定' });
  }

  // URLの ?date=YYYY-MM-DD や ?code=72030 で自由に試せるようにする
  const q = req.query || {};
  const date = q.date || '2026-01-07';
  const code = q.code || null;

  // codeがあればcode指定、なければdate指定
  let url;
  if (code) {
    url = `https://api.jquants.com/v2/equities/bars/daily?code=${code}`;
  } else {
    url = `https://api.jquants.com/v2/equities/bars/daily?date=${date}`;
  }

  try {
    const r = await fetch(url, { headers: { 'x-api-key': apiKey } });
    const status = r.status;
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}

    // レスポンスの「キー一覧」と「最初の1件」を見せる（中身を理解するため）
    let topKeys = null, firstItem = null, arrayKey = null, arrayLen = null;
    if (parsed && typeof parsed === 'object') {
      topKeys = Object.keys(parsed);
      // 配列が入っているキーを探す
      for (const k of topKeys) {
        if (Array.isArray(parsed[k])) {
          arrayKey = k; arrayLen = parsed[k].length;
          if (parsed[k].length > 0) firstItem = parsed[k][0];
          break;
        }
      }
    }

    res.status(200).json({
      requestedUrl: url,
      httpStatus: status,
      topLevelKeys: topKeys,     // レスポンス直下のキー名（daily_quotesかどうか確認）
      arrayKey,                  // 実際に配列が入っていたキー名
      arrayLength: arrayLen,     // その件数
      firstItem,                 // 最初の1件（項目名・値の確認）
      rawHead: text.slice(0, 500), // 生テキストの先頭500文字
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
