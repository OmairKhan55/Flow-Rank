export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const rawPool = String(req.query?.pool || "").trim();
    const suppliedNetwork = String(req.query?.network || "").trim();

    const timeframe = String(
      req.query?.timeframe ||
      req.query?.range ||
      "24h"
    ).trim().toLowerCase();

    if (!rawPool) {
      return res.status(400).json({ error: "Missing pool" });
    }

    /*
      GeckoTerminal pool IDs normally look like:

      solana_POOL_ADDRESS
      eth_0xPOOL_ADDRESS
      base_0xPOOL_ADDRESS

      Also support:
      ?network=solana&pool=POOL_ADDRESS
    */

    let network = suppliedNetwork;
    let poolAddress = rawPool;

    if (!network) {
      const separator = rawPool.indexOf("_");

      if (separator > 0) {
        network = rawPool.slice(0, separator).trim();
        poolAddress = rawPool.slice(separator + 1).trim();
      }
    }

    if (!network || !poolAddress) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const BASE =
      "https://api.geckoterminal.com/api/v2";

    /*
      Timeframe configuration
    */

    let endpoint = "ohlcv/hour";
    let aggregate = 1;
    let limit = 24;

    if (timeframe === "1h") {
      endpoint = "ohlcv/minute";
      aggregate = 1;
      limit = 60;
    }

    else if (timeframe === "4h") {
      endpoint = "ohlcv/minute";
      aggregate = 5;
      limit = 48;
    }

    else if (
      timeframe === "24h" ||
      timeframe === "1d"
    ) {
      endpoint = "ohlcv/hour";
      aggregate = 1;
      limit = 24;
    }

    else if (timeframe === "7d") {
      endpoint = "ohlcv/hour";
      aggregate = 4;
      limit = 42;
    }

    else {
      endpoint = "ohlcv/hour";
      aggregate = 1;
      limit = 24;
    }

    /*
      Fetch GeckoTerminal OHLCV.

      Try base-token pricing first.
      If unavailable, try quote-token pricing.
    */

    async function fetchHistory(token) {
      const url =
        `${BASE}/networks/${encodeURIComponent(network)}` +
        `/pools/${encodeURIComponent(poolAddress)}` +
        `/${endpoint}` +
        `?aggregate=${aggregate}` +
        `&limit=${limit}` +
        `&currency=usd` +
        `&token=${token}`;

      const response = await fetch(url, {
        headers: {
          Accept:
            "application/json;version=20230203"
        }
      });

      if (!response.ok) {
        console.log(
          "GeckoTerminal history:",
          response.status,
          network,
          poolAddress,
          token
        );

        return [];
      }

      const json = await response.json();

      const list =
        json?.data?.attributes?.ohlcv_list;

      return Array.isArray(list)
        ? list
        : [];
    }

    let list = await fetchHistory("base");

    /*
      Some pools may expose history against
      the quote token instead.
    */

    if (!list.length) {
      list = await fetchHistory("quote");
    }

    if (!list.length) {
      return res.status(200).json([]);
    }

    /*
      Convert GeckoTerminal rows:

      [timestamp, open, high, low, close, volume]
    */

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
      .filter(point =>
        point.timestamp > 0 &&
        Number.isFinite(point.open) &&
        Number.isFinite(point.high) &&
        Number.isFinite(point.low) &&
        Number.isFinite(point.close) &&
        Number.isFinite(point.volume) &&
        point.close > 0
      )
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp
      );

    res.setHeader(
      "Cache-Control",
      "s-maxage=30, stale-while-revalidate=120"
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res
      .status(200)
      .json(points);

  } catch (error) {
    console.error(
      "FlowRank History API Error:",
      error?.message || error
    );

    return res
      .status(200)
      .json([]);
  }
}
