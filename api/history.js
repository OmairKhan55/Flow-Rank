export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const pool = String(req.query?.pool || "").trim();
    const range = String(req.query?.range || "24h").trim().toLowerCase();
    const timeframe = String(
      req.query?.timeframe || "1h"
    ).trim().toLowerCase();

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

    const network = pool.slice(0, separator).trim();
    const poolAddress = pool.slice(separator + 1).trim();

    if (!network || !poolAddress) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const BASE = "https://api.geckoterminal.com/api/v2";

    /*
      Supported FlowRank timeframes:

      1m  = 1 minute
      5m  = 5 minutes
      15m = 15 minutes
      30m = 30 minutes
      1h  = 1 hour
      4h  = 4 hours
      12h = 12 hours
      1d  = 1 day
      1w  = 1 week
      1M  = 1 month

      GeckoTerminal uses:
      - minute
      - hour
      - day
      - week
      - month

      Aggregate controls the candle size.
    */

    const timeframeMap = {
      "1m": {
        endpoint: "minute",
        aggregate: 1,
        limit: 120
      },

      "5m": {
        endpoint: "minute",
        aggregate: 5,
        limit: 120
      },

      "15m": {
        endpoint: "minute",
        aggregate: 15,
        limit: 120
      },

      "30m": {
        endpoint: "minute",
        aggregate: 30,
        limit: 120
      },

      "1h": {
        endpoint: "hour",
        aggregate: 1,
        limit: 120
      },

      "4h": {
        endpoint: "hour",
        aggregate: 4,
        limit: 120
      },

      "12h": {
        endpoint: "hour",
        aggregate: 12,
        limit: 120
      },

      "1d": {
        endpoint: "day",
        aggregate: 1,
        limit: 120
      },

      "1w": {
        endpoint: "day",
        aggregate: 7,
        limit: 120
      },

      "1mth": {
        endpoint: "month",
        aggregate: 1,
        limit: 120
      },

      "1month": {
        endpoint: "month",
        aggregate: 1,
        limit: 120
      }
    };

    /*
      Backward compatibility:

      Existing frontend sends:
      range=24h
      range=7d

      If no timeframe is supplied, use:
      24h -> 1h candles
      7d  -> 4h candles
    */

    let selectedTimeframe = timeframe;

    if (!req.query?.timeframe) {
      if (range === "7d") {
        selectedTimeframe = "4h";
      } else {
        selectedTimeframe = "1h";
      }
    }

    const config =
      timeframeMap[selectedTimeframe] ||
      timeframeMap["1h"];

    const url =
      `${BASE}/networks/${encodeURIComponent(network)}` +
      `/pools/${encodeURIComponent(poolAddress)}` +
      `/ohlcv/${config.endpoint}` +
      `?aggregate=${config.aggregate}` +
      `&limit=${config.limit}` +
      `&currency=usd`;

    console.log(
      "FlowRank history request:",
      selectedTimeframe,
      url
    );

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

    const list =
      json?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(list)) {
      console.log(
        "No OHLCV list returned for:",
        selectedTimeframe
      );

      return res.status(200).json([]);
    }

    /*
      GeckoTerminal OHLCV format:

      [
        timestamp,
        open,
        high,
        low,
        close,
        volume
      ]
    */

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
          Number.isFinite(point.open) &&
          point.open > 0 &&
          Number.isFinite(point.high) &&
          point.high > 0 &&
          Number.isFinite(point.low) &&
          point.low > 0 &&
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

    return res.status(200).json({
      timeframe: selectedTimeframe,
      network,
      pool: poolAddress,
      candles: points
    });

  } catch (error) {
    console.error(
      "FlowRank history API error:",
      error?.message || error
    );

    return res.status(200).json({
      timeframe: "1h",
      candles: []
    });
  }
}
