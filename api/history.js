export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const pool = String(req.query?.pool || "").trim();

    // Frontend timeframe bhej raha hai
    const timeframe = String(
      req.query?.timeframe || req.query?.range || "24h"
    ).trim().toLowerCase();

    if (!pool) {
      return res.status(400).json({ error: "Missing pool" });
    }

    const separator = pool.indexOf("_");

    if (separator === -1) {
      return res.status(400).json({ error: "Invalid pool" });
    }

    const network = pool.slice(0, separator).trim();
    const poolAddress = pool.slice(separator + 1).trim();

    if (!network || !poolAddress) {
      return res.status(400).json({ error: "Invalid pool" });
    }

    const BASE = "https://api.geckoterminal.com/api/v2";

    let aggregate = 1;
    let limit = 24;

    if (timeframe === "1h") {
      aggregate = 1;
      limit = 12;
    } else if (timeframe === "4h") {
      aggregate = 1;
      limit = 24;
    } else if (timeframe === "1d") {
      aggregate = 4;
      limit = 42;
    } else if (timeframe === "7d") {
      aggregate = 4;
      limit = 42;
    } else {
      // 24H
      aggregate = 1;
      limit = 24;
    }

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
      return res.status(200).json([]);
    }

    const json = await response.json();
    const list = json?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(list)) {
      return res.status(200).json([]);
    }

    const points = list
      .map(row => ({
        time: Number(row?.[0] || 0),
        timestamp: Number(row?.[0] || 0),
        open: Number(row?.[1] || 0),
        high: Number(row?.[2] || 0),
        low: Number(row?.[3] || 0),
        close: Number(row?.[4] || 0),
        volume: Number(row?.[5] || 0)
      }))
      .filter(
        p =>
          p.timestamp > 0 &&
          Number.isFinite(p.open) &&
          Number.isFinite(p.high) &&
          Number.isFinite(p.low) &&
          Number.isFinite(p.close) &&
          p.close > 0
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
      "FlowRank History API Error:",
      error?.message || error
    );

    return res.status(200).json([]);
  }
}
