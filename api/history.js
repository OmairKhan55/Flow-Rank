export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const pool = String(req.query?.pool || "").trim();

    const range = String(
      req.query?.range || "24h"
    ).trim().toLowerCase();

    const timeframe = String(
      req.query?.timeframe || ""
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

    const network = pool
      .slice(0, separator)
      .trim();

    const poolAddress = pool
      .slice(separator + 1)
      .trim();

    if (!network || !poolAddress) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const BASE =
      "https://api.geckoterminal.com/api/v2";

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

      "1month": {
        endpoint: "month",
        aggregate: 1,
        limit: 120
      }
    };

    let selectedTimeframe = timeframe;

    /*
      Old frontend compatibility
    */
    if (!selectedTimeframe) {
      if (range === "7d") {
        selectedTimeframe = "4h";
      } else {
        selectedTimeframe = "1h";
      }
    }

    /*
      Custom timeframe
      Examples:
      2m
      10m
      2h
      6h
      2d
      2w
    */
    if (!timeframeMap[selectedTimeframe]) {
      const custom =
        selectedTimeframe.match(
          /^(\d+)(m|h|d|w)$/
        );

      if (custom) {
        const value =
          Number(custom[1]);

        const unit =
          custom[2];

        if (
          Number.isFinite(value) &&
          value > 0 &&
          value <= 100
        ) {
          if (unit === "m") {
            timeframeMap[selectedTimeframe] = {
              endpoint: "minute",
              aggregate: value,
              limit: 120
            };
          }

          if (unit === "h") {
            timeframeMap[selectedTimeframe] = {
              endpoint: "hour",
              aggregate: value,
              limit: 120
            };
          }

          if (unit === "d") {
            timeframeMap[selectedTimeframe] = {
              endpoint: "day",
              aggregate: value,
              limit: 120
            };
          }

          if (unit === "w") {
            timeframeMap[selectedTimeframe] = {
              endpoint: "day",
              aggregate: value * 7,
              limit: 120
            };
          }
        }
      }
    }

    /*
      Fallback
    */
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
      "FlowRank history:",
      selectedTimeframe,
      network,
      poolAddress
    );

    const response = await fetch(url, {
      headers: {
        Accept:
          "application/json;version=20230203"
      }
    });

    if (!response.ok) {
      const errorText =
        await response.text();

      console.log(
        "GeckoTerminal history error:",
        response.status,
        errorText
      );

      return res
        .status(200)
        .json([]);
    }

    const json =
      await response.json();

    const list =
      json?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(list)) {
      console.log(
        "No OHLCV data:",
        selectedTimeframe
      );

      return res
        .status(200)
        .json([]);
    }

    const points =
      list
        .map((row) => ({
          timestamp:
            Number(row?.[0] || 0),

          open:
            Number(row?.[1] || 0),

          high:
            Number(row?.[2] || 0),

          low:
            Number(row?.[3] || 0),

          close:
            Number(row?.[4] || 0),

          volume:
            Number(row?.[5] || 0)
        }))
        .filter((point) => {
          return (
            Number.isFinite(
              point.timestamp
            ) &&
            point.timestamp > 0 &&

            Number.isFinite(
              point.open
            ) &&
            point.open > 0 &&

            Number.isFinite(
              point.high
            ) &&
            point.high > 0 &&

            Number.isFinite(
              point.low
            ) &&
            point.low > 0 &&

            Number.isFinite(
              point.close
            ) &&
            point.close > 0
          );
        })
        .sort(
          (a, b) =>
            a.timestamp -
            b.timestamp
        );

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=180"
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    /*
      IMPORTANT:
      Return direct array so index.html
      can render the candles immediately.
    */
    return res
      .status(200)
      .json(points);

  } catch (error) {
    console.error(
      "FlowRank history API error:",
      error?.message || error
    );

    return res
      .status(200)
      .json([]);
  }
}
