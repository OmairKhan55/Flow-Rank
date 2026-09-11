export default async function handler(req, res) {
  const key = process.env.CG_API_KEY;
  if (!key) return res.status(500).json({ error: "CG_API_KEY missing" });

  const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1&sparkline=false";

  try {
    const r = await fetch(url, {
      headers: { "x-cg-demo-api-key": key }
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: "CoinGecko request failed" });
  }
}
