export default async function handler(req, res) {
  if (req.method === 'POST') {
    console.log('✅ Webhook Received:', req.body);

    // 今はログだけ出力。ここでkintone APIを呼び出す処理を追加できる！
    res.status(200).json({ message: 'Webhook received successfully!' });
  } else {
    res.status(405).json({ message: 'Method Not Allowed' });
  }
}
