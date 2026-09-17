export default async function handler(req, res) {
  try {
    const pool = String(req.query?.pool || "").trim();
    const range = String(req.query?.range || "24h").toLowerCase();

    if (!pool) {
      return res.status(400).json({ error: "Missing pool" });
    }

    const parts = pool.split("_");
    const network = parts.shift();
    const poolAddress = parts.join("_");

    if (!network || !poolAddress) {
      return res.status(400).json({ error: "Invalid pool" });
    }

    const base = "https://api.geckoterminal.com/api/v2";

    const url =
      `${base}/networks/${encodeURIComponent(network)}/pools/` +
      `${encodeURIComponent(poolAddress)}/ohlcv/hour` +
      `?aggregate=${range === "7d" ? 4 : 1}&limit=${range === "7d" ? 42 : 30}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json;version=20230203"
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Pool history unavailable"
      });
    }

    const json = await response.json();
    const list = json?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(list)) {
      return res.status(200).json([]);
    }

    const points = list
      .map(row => ({
        timestamp: Number(row?.[0] || 0),
        open: Number(row?.[1] || 0),
        high: Number(row?.[2] || 0),
        low: Number(row?.[3] || 0),
        close: Number(row?.[4] || 0),
        volume: Number(row?.[5] || 0)
      }))
      .filter(p => p.timestamp > 0 && Number.isFinite(p.close))
      .sort((a, b) => a.timestamp - b.timestamp);

    res.setHeader(
      "Cache-Control",
      "s-maxage=30, stale-while-revalidate=120"
    );
    res.setHeader("Content-Type", "application/json");

    return res.status(200).json(points);
  } catch (error) {
    console.error("History API error:", error);
    return res.status(500).json({
      error: "Price history failed"
    });
  }
}
