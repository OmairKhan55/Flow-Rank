export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const pool = String(req.query?.pool || "").trim();
    const timeframe = String(req.query?.timeframe || "1h")
      .trim()
      .toLowerCase();

    if (!pool) return res.status(400).json({ error: "Missing pool" });

    const separator = pool.indexOf("_");
    if (separator === -1) {
      return res.status(400).json({ error: "Invalid pool" });
    }

    const network = pool.slice(0, separator);
    const poolAddress = pool.slice(separator + 1);

    const settings = {
      "1m": ["minute", 1],
      "5m": ["minute", 5],
      "15m": ["minute", 15],
      "30m": ["minute", 30],
      "1h": ["hour", 1],
      "4h": ["hour", 4],
      "12h": ["hour", 12],
      "1d": ["day", 1],
      "1w": ["day", 7],
      "1month": ["month", 1]
    };

    const config = settings[timeframe] || settings["1h"];

    const url =
      `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}` +
      `/pools/${encodeURIComponent(poolAddress)}/ohlcv/${config[0]}` +
      `?aggregate=${config[1]}&limit=120&currency=usd`;

    console.log("FlowRank history URL:", url);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json;version=20230203"
      }
    });

    if (!response.ok) {
      console.log("History API:", response.status);
      return res.status(200).json([]);
    }

    const json = await response.json();

    const list = json?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(list)) {
      return res.status(200).json([]);
    }

    const points = list
      .map(row => ({
        timestamp: Number(row?.[0]),
        open: Number(row?.[1]),
        high: Number(row?.[2]),
        low: Number(row?.[3]),
        close: Number(row?.[4]),
        volume: Number(row?.[5] || 0)
      }))
      .filter(x =>
        x.timestamp > 0 &&
        x.open > 0 &&
        x.high > 0 &&
        x.low > 0 &&
        x.close > 0
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=180"
    );

    return res.status(200).json(points);

  } catch (error) {
    console.error("History error:", error?.message || error);
    return res.status(200).json([]);
  }
}
