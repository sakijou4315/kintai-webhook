/*  =====  kintone 勤怠 Webhook (安定版)  =====  */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  /* ■■■ １. 定数  ■■■ */
  const KINTONE_DOMAIN       = 'rsg5nfiqkddo.cybozu.com';
  const CHECK_APP_ID         = '102';
  const API_TOKEN            = 'UoPIPpmmYpVx23QMMOqhSzb69wTfTNvvxpr7Phr9';
  const DEFAULT_TIMEZONE     = 'Asia/Tokyo';
  const MAX_RETRY            = 3;             // 409 衝突時リトライ

  const STATUS_ALLOWED = [
    '正常', '稼働中', '出勤漏れ', '退勤漏れ',
    '遅刻', '早退', '公休',
    '有休(全日)', '有休(半日)', '欠勤', '未打刻'
  ];

  /* ■■■ ２. ユーティリティ  ■■■ */
  const toJstDate = iso =>
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(iso)).replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3');       // yyyy-mm-dd

  const toJstTime = iso =>
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(iso));                                                       // HH:MM

  const isNum = v => typeof v === 'number' && !isNaN(v);

  /* ■■■ ３. メイン処理  ■■■ */
  try {
    /* 3-1. リクエスト解析 */
    const body         = req.body;
    const r            = body.record || {};
    const userName     = r.user_name?.value || '';
    const employeeCode = r.kviewer_lookup?.value?.trim?.() || '';
    const type         = r.type?.value;                // '出勤'|'退勤'
    const timestamp    = r.timestamp?.value;
    const latRaw       = Number(r.latitude?.value);
    const lonRaw       = Number(r.longitude?.value);
    const classValue   = r.class?.value || '';

    if (!employeeCode || !type || !timestamp) {
      console.error('🚫 必須値不足', { employeeCode, type, timestamp });
      return res.status(400).json({ message: 'Bad Request – missing fields' });
    }

    const date = toJstDate(timestamp);
    const time = toJstTime(timestamp);
    const latitude  = isNum(latRaw) ? latRaw : null;
    const longitude = isNum(lonRaw) ? lonRaw : null;
    const mapUrl    = latitude && longitude
      ? `https://www.google.com/maps?q=${latitude},${longitude}` : '';

    /* 3-2. 既存レコード検索 */
    const query = `kviewer_lookup = "${employeeCode}" and date = "${date}" order by $id desc limit 1`;
    const searchUrl = `https://${KINTONE_DOMAIN}/k/v1/records.json?app=${CHECK_APP_ID}&query=${encodeURIComponent(query)}`;
    const searchRsp = await fetch(searchUrl, { headers: { 'X-Cybozu-API-Token': API_TOKEN }});
    if (!searchRsp.ok) throw new Error(`search error ${searchRsp.status}`);
    const { records = [] } = await searchRsp.json();
    const existing = records[0];

    /* 3-3. 更新フィールド構築 */
    const updateFields = {};

    if (type === '出勤') {
      Object.assign(updateFields, {
        clock_in_time: { value: time },
        ...(latitude  && { clock_in_lat: { value: latitude } }),
        ...(longitude && { clock_in_lon: { value: longitude } }),
        ...(mapUrl    && { clock_in_map: { value: mapUrl } })
      });
    }
    if (type === '退勤') {
      Object.assign(updateFields, {
        clock_out_time: { value: time },
        ...(latitude  && { clock_out_lat: { value: latitude } }),
        ...(longitude && { clock_out_lon: { value: longitude } }),
        ...(mapUrl    && { clock_out_map: { value: mapUrl } })
      });
    }

    /* 3-4. ステータス判定 */
    const hasIn  = type === '出勤' || !!existing?.clock_in_time?.value;
    const hasOut = type === '退勤' || !!existing?.clock_out_time?.value;
    let status;
    if (hasIn && hasOut)           status = '正常';
    else if (hasIn && !hasOut)     status = '稼働中';
    else if (!hasIn && hasOut)     status = '出勤漏れ';

    if (status && STATUS_ALLOWED.includes(status)) {
      updateFields.status = { value: status };
    }

    /* 3-5. 部署は常に同期 */
    updateFields.class = { value: classValue };

    /* 3-6. Upsert 関数 (PUT は revision & リトライ) */
    const upsert = async (retry = 0) => {
      if (existing) {
        const putBody = {
          app: CHECK_APP_ID,
          id:  existing.$id.value,
          revision: Number(existing.$revision.value),
          record: updateFields
        };
        const rsp = await fetch(`https://${KINTONE_DOMAIN}/k/v1/record.json`, {
          method:'PUT',
          headers:{
            'X-Cybozu-API-Token':API_TOKEN,
            'Content-Type':'application/json'
          },
          body: JSON.stringify(putBody)
        });
        if (rsp.status === 409 && retry < MAX_RETRY) {
          console.warn('↻ 409 retry', retry + 1);
          /* 最新 revision 取得 */
          const latest = await fetch(`https://${KINTONE_DOMAIN}/k/v1/record.json?app=${CHECK_APP_ID}&id=${existing.$id.value}`,{
            headers:{'X-Cybozu-API-Token':API_TOKEN}
          }).then(r=>r.json());
          existing.$revision.value = latest.record.$revision.value;
          return upsert(retry + 1);
        }
        return rsp;
      } else {
        const postBody = {
          app: CHECK_APP_ID,
          record: {
            user_name:      { value: userName },
            kviewer_lookup: { value: employeeCode },
            date:           { value: date },
            class:          { value: classValue },
            ...updateFields
          }
        };
        return fetch(`https://${KINTONE_DOMAIN}/k/v1/record.json`,{
          method:'POST',
          headers:{
            'X-Cybozu-API-Token':API_TOKEN,
            'Content-Type':'application/json'
          },
          body: JSON.stringify(postBody)
        });
      }
    };

    /* 3-7. 保存処理 */
    const saveRsp  = await upsert();
    const saveJson = await saveRsp.json();
    if (!saveRsp.ok) {
      console.error('❌ kintone error', saveJson);
      throw new Error(`kintone ${saveJson.code}`);
    }

    /* 3-8. 完了 */
    return res.status(200).json({ message:'Check board updated!', result:saveJson });
  } catch (err) {
    console.error('❌ webhook error', err);
    return res.status(500).json({ message:'Internal Server Error', error:String(err) });
  }
}
