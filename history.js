export default async function handler(req, res) {
  try {
    const pool = String(req.query?.pool || "").trim();
    const range = String(req.query?.range || "24h").toLowerCase();

    if (!pool) {
      return res.status(400).json({
        error: "Missing pool"
      });
    }

    const separator = pool.indexOf("_");

    if (separator === -1) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const network = pool.slice(0, separator);
    const poolAddress = pool.slice(separator + 1);

    if (!network || !poolAddress) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const BASE =
      "https://api.geckoterminal.com/api/v2";

    /*
      24H:
      hourly candles, last 24 points

      7D:
      4-hour candles, last 42 points
    */

    const aggregate =
      range === "7d" ? 4 : 1;

    const limit =
      range === "7d" ? 42 : 24;

    const url =
      `${BASE}/networks/${encodeURIComponent(network)}` +
      `/pools/${encodeURIComponent(poolAddress)}` +
      `/ohlcv/hour` +
      `?aggregate=${aggregate}` +
      `&limit=${limit}` +
      `&currency=usd`;

    console.log("History request:", url);

    const response = await fetch(url, {
      headers: {
        Accept:
          "application/json;version=20230203"
      }
    });

    if (!response.ok) {
      const text = await response.text();

      console.log(
        "GeckoTerminal history error:",
        response.status,
        text
      );

      return res.status(200).json([]);
    }

    const json = await response.json();

    const list =
      json?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(list)) {
      console.log("No OHLCV list");
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
      .filter(
        point =>
          point.timestamp > 0 &&
          Number.isFinite(point.close) &&
          point.close > 0
      )
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp
      );

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=180"
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res.status(200).json(points);

  } catch (error) {
    console.error(
      "History API error:",
      error?.message || error
    );

    return res.status(200).json([]);
  }
}
