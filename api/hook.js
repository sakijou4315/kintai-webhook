export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const body = req.body;
  console.log('✅ Webhook Received:', body);

  // 1. 情報を抽出
  const record = body.record;
  const userName = record.user_name.value;
  const type = record.type.value;
  const timestamp = record.timestamp.value;
  const latitude = record.latitude.value;
  const longitude = record.longitude.value;
  const date = timestamp.split('T')[0]; // 日付だけ

  // 2. マップURL生成
  const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

  // 3. チェックボードのアプリID & APIキー（←必要ならここでトークン設定）
  const CHECK_APP_ID = '102';
  const API_TOKEN = 'UoPIPpmmYpVx23QMMOqhSzb69wTfTNvvxpr7Phr9';

  // 4. 既存レコードを探す（user_name & date）
  const query = `user_name = "${userName}" and date = "${date}"`;
  const searchResp = await fetch(`https://rsg5nfiqkddo.cybozu.com/k/v1/records.json?app=${CHECK_APP_ID}&query=${encodeURIComponent(query)}`, {
    method: 'GET',
    headers: {
      'X-Cybozu-API-Token': API_TOKEN,
      'Content-Type': 'application/json',
    }
  });
  const found = await searchResp.json();
  const existing = found.records[0];

  // 5. 更新フィールド構成
  const recordUpdate = {};

  if (type === '出勤') {
    recordUpdate.clock_in = { value: timestamp };
    recordUpdate.clock_in_lat = { value: Number(latitude) };
    recordUpdate.clock_in_lon = { value: Number(longitude) };
    recordUpdate.clock_in_map = { value: mapUrl };
  } else if (type === '退勤') {
    recordUpdate.clock_out = { value: timestamp };
    recordUpdate.clock_out_lat = { value: Number(latitude) };
    recordUpdate.clock_out_lon = { value: Number(longitude) };
    recordUpdate.clock_out_map = { value: mapUrl };
  }

  // ステータス判定
  const hasIn = type === '出勤' || (existing && existing.clock_in?.value);
  const hasOut = type === '退勤' || (existing && existing.clock_out?.value);
  if (hasIn && hasOut) {
    recordUpdate.status = { value: '正常' };
  } else if (hasIn && !hasOut) {
    recordUpdate.status = { value: '退勤漏れ' };
  } else if (!hasIn && hasOut) {
    recordUpdate.status = { value: '出勤漏れ' };
  }

  // 6. 更新 or 作成
  if (existing) {
    await fetch('https://rsg5nfiqkddo.cybozu.com/k/v1/record.json', {
      method: 'PUT',
      headers: {
        'X-Cybozu-API-Token': API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app: CHECK_APP_ID,
        id: existing.$id.value,
        record: recordUpdate
      })
    });
  } else {
    await fetch('https://rsg5nfiqkddo.cybozu.com/k/v1/record.json', {
      method: 'POST',
      headers: {
        'X-Cybozu-API-Token': API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app: CHECK_APP_ID,
        record: {
          user_name: { value: userName },
          date: { value: date },
          ...recordUpdate
        }
      })
    });
  }

  res.status(200).json({ message: 'Record updated in check board!' });
}
