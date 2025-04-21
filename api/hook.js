export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const body = req.body;
    console.log('✅ Webhook Received:', body);

    const record = body.record;
    const userName = record.user_name.value;
    const employeeCode = record.kviewer_lookup.value;
    const type = record.type.value;
    const timestamp = record.timestamp.value;
    const latitude = record.latitude.value;
    const longitude = record.longitude.value;
    const date = timestamp.split('T')[0];

    const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

    const CHECK_APP_ID = '102';
    const API_TOKEN = 'UoPIPpmmYpVx23QMMOqhSzb69wTfTNvvxpr7Phr9';

    const query = `kviewer_lookup = "${employeeCode}" and date like "${date}"`;

    const getResp = await fetch(`https://rsg5nfiqkddo.cybozu.com/k/v1/records.json?app=${CHECK_APP_ID}&query=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'X-Cybozu-API-Token': API_TOKEN,
        'Content-Type': 'application/json',
      }
    });

    const found = await getResp.json();
    console.log('🧾 検索結果:', found);

    const existing = found.records && found.records.length > 0 ? found.records[0] : null;

    const updateFields = {};

    if (type === '出勤') {
      updateFields.clock_in = { value: timestamp };
      updateFields.clock_in_lat = { value: Number(latitude) };
      updateFields.clock_in_lon = { value: Number(longitude) };
      updateFields.clock_in_map = { value: mapUrl };
    } else if (type === '退勤') {
      updateFields.clock_out = { value: timestamp };
      updateFields.clock_out_lat = { value: Number(latitude) };
      updateFields.clock_out_lon = { value: Number(longitude) };
      updateFields.clock_out_map = { value: mapUrl };
    }

    const hasIn = type === '出勤' || (existing && existing.clock_in && existing.clock_in.value);
    const hasOut = type === '退勤' || (existing && existing.clock_out && existing.clock_out.value);

    if (hasIn && hasOut) {
      updateFields.status = { value: '正常' };
    } else if (hasIn && !hasOut) {
      updateFields.status = { value: '退勤漏れ' };
    } else if (!hasIn && hasOut) {
      updateFields.status = { value: '出勤漏れ' };
    }

    if (existing) {
      // 🔄 更新処理（ログ付き）
      const updateResp = await fetch('https://rsg5nfiqkddo.cybozu.com/k/v1/record.json', {
        method: 'PUT',
        headers: {
          'X-Cybozu-API-Token': API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app: CHECK_APP_ID,
          id: existing.$id.value,
          record: updateFields
        })
      });

      const updateResult = await updateResp.json();
      console.log('🔄 更新結果:', updateResult);

      if (updateResp.ok) {
        console.log('✅ チェックボードレコードを更新しました');
      } else {
        console.error('❌ 更新失敗！新規作成にフォールバック:', updateResult);
        throw new Error('Update failed');
      }
    } else {
      // 🆕 新規作成
      const postResp = await fetch('https://rsg5nfiqkddo.cybozu.com/k/v1/record.json', {
        method: 'POST',
        headers: {
          'X-Cybozu-API-Token': API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app: CHECK_APP_ID,
          record: {
            user_name: { value: userName },
            kviewer_lookup: { value: employeeCode },
            date: { value: date },
            ...updateFields
          }
        })
      });

      const postResult = await postResp.json();
      console.log('🆕 チェックボードレコードを作成しました:', postResult);
    }

    res.status(200).json({ message: 'Check board updated successfully!' });
  } catch (error) {
    console.error('❌ 処理中にエラーが発生しました:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.toString() });
  }
}
