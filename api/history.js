export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const pool = String(req.query?.pool || "").trim();
    const range = String(req.query?.range || "24h").trim().toLowerCase();

    if (!pool) {
      return res.status(400).json({
        error: "Missing pool"
      });
    }

    // Expected format: network_poolAddress
    const separator = pool.indexOf("_");

    if (separator === -1) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const network = pool.slice(0, separator).trim();
    const poolAddress = pool.slice(separator + 1).trim();

    if (!network || !poolAddress) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const BASE = "https://api.geckoterminal.com/api/v2";

    // 24H = 1-hour candles
    // 7D = 4-hour candles
    const aggregate = range === "7d" ? 4 : 1;
    const limit = range === "7d" ? 42 : 24;

    const url =
      `${BASE}/networks/${encodeURIComponent(network)}` +
      `/pools/${encodeURIComponent(poolAddress)}` +
      `/ohlcv/hour` +
      `?aggregate=${aggregate}` +
      `&limit=${limit}` +
      `&currency=usd`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json;version=20230203"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.log(
        "GeckoTerminal history error:",
        response.status,
        errorText
      );

      return res.status(200).json([]);
    }

    const json = await response.json();

    const list = json?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(list)) {
      console.log("No OHLCV list returned");
      return res.status(200).json([]);
    }

    const points = list
      .map((row) => ({
        timestamp: Number(row?.[0] || 0),
        open: Number(row?.[1] || 0),
        high: Number(row?.[2] || 0),
        low: Number(row?.[3] || 0),
        close: Number(row?.[4] || 0),
        volume: Number(row?.[5] || 0)
      }))
      .filter(
        (point) =>
          Number.isFinite(point.timestamp) &&
          point.timestamp > 0 &&
          Number.isFinite(point.close) &&
          point.close > 0
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=180"
    );

    res.setHeader("Content-Type", "application/json");

    return res.status(200).json(points);

  } catch (error) {
    console.error(
      "History API error:",
      error?.message || error
    );

    return res.status(200).json([]);
  }
}
