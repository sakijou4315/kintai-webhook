export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    // 1. リクエストボディ取得
    const body = req.body;
    console.log('✅ Webhook Received:', body);

    // 2. kintone から送信されたレコード情報
    const record        = body.record;
    const userName      = record.user_name.value;
    const employeeCode  = record.kviewer_lookup.value.trim();
    const type          = record.type.value;        // '出勤' or '退勤'
    const timestamp     = record.timestamp.value;    // ISO文字列
    const latitude      = record.latitude.value;
    const longitude     = record.longitude.value;
    const classValue    = record.class.value;       // 所属部署
    const date          = timestamp.split('T')[0];  // yyyy-mm-dd

    // 3. GoogleマップURL
    const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

    // 4. kintone API 情報
    const CHECK_APP_ID = '102';
    const API_TOKEN    = 'UoPIPpmmYpVx23QMMOqhSzb69wTfTNvvxpr7Phr9';

    // 5. 同日・同社員の既存レコード検索
    const query = `kviewer_lookup = "${employeeCode}" and date = "${date}" order by $id desc limit 1`;
    console.log('🔍 クエリ:', query);
    const getResp = await fetch(
      `https://rsg5nfiqkddo.cybozu.com/k/v1/records.json?app=${CHECK_APP_ID}&query=${encodeURIComponent(query)}`,
      { method: 'GET', headers: { 'X-Cybozu-API-Token': API_TOKEN } }
    );
    const { records = [] } = await getResp.json();
    const existing        = records[0];

    // 6. 時刻文字列を JST で生成 (HH:MM)
    const jstDate = new Date(new Date(timestamp).getTime() + 9 * 60 * 60 * 1000);
    const timeOnly = jstDate.toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    // 7. updateFields に打刻情報をセット
    const updateFields = {};
    if (type === '出勤') {
      updateFields.clock_in_time = { value: timeOnly };
      updateFields.clock_in_lat  = { value: Number(latitude) };
      updateFields.clock_in_lon  = { value: Number(longitude) };
      updateFields.clock_in_map  = { value: mapUrl };
    } else if (type === '退勤') {
      updateFields.clock_out_time = { value: timeOnly };
      updateFields.clock_out_lat  = { value: Number(latitude) };
      updateFields.clock_out_lon  = { value: Number(longitude) };
      updateFields.clock_out_map  = { value: mapUrl };
    }

    // 8. ステータス判定
    const hasIn  = (type === '出勤') || (existing && existing.clock_in_time && existing.clock_in_time.value);
    const hasOut = (type === '退勤') || (existing && existing.clock_out_time && existing.clock_out_time.value);
    if (hasIn && hasOut) {
      updateFields.status = { value: '正常' };
    } else if (hasIn && !hasOut) {
      updateFields.status = { value: '稼働中' }; // 新ステータス
    } else if (!hasIn && hasOut) {
      updateFields.status = { value: '出勤漏れ' };
    }

    // 9. 所属部署を常に反映
    updateFields.class = { value: classValue };

    // 10. kintone レコード更新 or 新規作成
    if (existing) {
      const updateResp = await fetch('https://rsg5nfiqkddo.cybozu.com/k/v1/record.json', {
        method: 'PUT',
        headers: {
          'X-Cybozu-API-Token': API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app: CHECK_APP_ID,
          id:  existing.$id.value,
          record: updateFields
        })
      });
      console.log('✅ 更新結果:', await updateResp.json());
    } else {
      const postResp = await fetch('https://rsg5nfiqkddo.cybozu.com/k/v1/record.json', {
        method: 'POST',
        headers: {
          'X-Cybozu-API-Token': API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app: CHECK_APP_ID,
          record: {
            user_name:      { value: userName },
            kviewer_lookup: { value: employeeCode },
            date:           { value: date },
            class:          { value: classValue },
            ...updateFields
          }
        })
      });
      console.log('🆕 新規作成結果:', await postResp.json());
    }

    // 11. レスポンス
    res.status(200).json({ message: 'Check board updated successfully!' });
  } catch (error) {
    console.error('❌ 処理中にエラーが発生しました:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.toString() });
  }
}
