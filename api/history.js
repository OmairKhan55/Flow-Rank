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
      return res.status(400).json({ error: "Invalid pool" });
    }

    const BASE =
      "https://api.geckoterminal.com/api/v2";

    const headers = {
      Accept: "application/json;version=20230203"
    };

    /*
      TIMEFRAME
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

    /*
      OHLCV REQUEST
    */

    async function getOHLCV(extra = "") {
      const url =
        `${BASE}/networks/${encodeURIComponent(network)}` +
        `/pools/${encodeURIComponent(poolAddress)}` +
        `/${endpoint}` +
        `?aggregate=${aggregate}` +
        `&limit=${limit}` +
        `&currency=usd${extra}`;

      try {
        const response = await fetch(url, {
          headers
        });

        if (!response.ok) {
          console.log(
            "History OHLCV error:",
            response.status,
            network,
            poolAddress
          );

          return [];
        }

        const json = await response.json();

        const list =
          json?.data?.attributes?.ohlcv_list;

        return Array.isArray(list) ? list : [];

      } catch (error) {
        console.log(
          "History OHLCV request failed:",
          error?.message || error
        );

        return [];
      }
    }

    /*
      Try normal OHLCV first.
    */

    let list = await getOHLCV("");

    /*
      Try base token.
    */

    if (!list.length) {
      list = await getOHLCV("&token=base");
    }

    /*
      Try quote token.
    */

    if (!list.length) {
      list = await getOHLCV("&token=quote");
    }

    /*
      Convert OHLCV.
    */

    function convertRows(rows) {
      return rows
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
    }

    let points = convertRows(list);

    /*
      ==================================================
      FALLBACK
      BUILD CANDLES FROM GECKOTERMINAL TRADES
      ==================================================
    */

    if (!points.length) {

      const tradesUrl =
        `${BASE}/networks/${encodeURIComponent(network)}` +
        `/pools/${encodeURIComponent(poolAddress)}` +
        `/trades?page=1`;

      let trades = [];

      try {
        const response = await fetch(
          tradesUrl,
          {
            headers
          }
        );

        if (response.ok) {
          const json = await response.json();

          trades = Array.isArray(json?.data)
            ? json.data
            : [];
        }

      } catch (error) {
        console.log(
          "History trades fallback failed:",
          error?.message || error
        );
      }

      /*
        Convert trades to price points.
      */

      const tradePoints = trades
        .map(item => {
          const a = item?.attributes || {};

          const rawTimestamp =
            a.block_timestamp ||
            a.blockTimestamp ||
            "";

          let timestamp = 0;

          if (
            typeof rawTimestamp === "number"
          ) {
            timestamp =
              rawTimestamp > 100000000000
                ? Math.floor(rawTimestamp / 1000)
                : rawTimestamp;
          } else {
            const parsed =
              Date.parse(String(rawTimestamp));

            if (Number.isFinite(parsed)) {
              timestamp =
                Math.floor(parsed / 1000);
            }
          }

          /*
            GeckoTerminal trade price fields.
          */

          let price =
            Number(
              a.price_to_in_usd || 0
            );

          if (
            !Number.isFinite(price) ||
            price <= 0
          ) {
            price =
              Number(
                a.price_from_in_usd || 0
              );
          }

          if (
            !Number.isFinite(price) ||
            price <= 0
          ) {
            price =
              Number(
                a.price_usd || 0
              );
          }

          /*
            Trade volume.
          */

          let volume =
            Number(
              a.volume_in_usd || 0
            );

          if (
            !Number.isFinite(volume)
          ) {
            volume = 0;
          }

          return {
            timestamp,
            price,
            volume
          };
        })
        .filter(x =>
          x.timestamp > 0 &&
          Number.isFinite(x.price) &&
          x.price > 0
        )
        .sort(
          (a, b) =>
            a.timestamp - b.timestamp
        );

      /*
        If there are no usable trade prices,
        return empty array.
      */

      if (!tradePoints.length) {
        res.setHeader(
          "Cache-Control",
          "s-maxage=30, stale-while-revalidate=120"
        );

        return res.status(200).json([]);
      }

      /*
        Candle size.
      */

      let candleSeconds = 3600;

      if (timeframe === "1h") {
        candleSeconds = 60;
      }

      else if (timeframe === "4h") {
        candleSeconds = 300;
      }

      else if (timeframe === "7d") {
        candleSeconds = 14400;
      }

      /*
        Build candles.
      */

      const candles = new Map();

      for (const trade of tradePoints) {

        const bucket =
          Math.floor(
            trade.timestamp /
            candleSeconds
          ) *
          candleSeconds;

        if (!candles.has(bucket)) {

          candles.set(bucket, {
            time: bucket,
            timestamp: bucket,
            open: trade.price,
            high: trade.price,
            low: trade.price,
            close: trade.price,
            volume: trade.volume
          });

        } else {

          const candle =
            candles.get(bucket);

          candle.high =
            Math.max(
              candle.high,
              trade.price
            );

          candle.low =
            Math.min(
              candle.low,
              trade.price
            );

          candle.close =
            trade.price;

          candle.volume +=
            trade.volume;
        }
      }

      points =
        Array.from(candles.values())
          .sort(
            (a, b) =>
              a.timestamp -
              b.timestamp
          );

      /*
        Limit candles.
      */

      if (timeframe === "1h") {
        points = points.slice(-60);
      }

      else if (timeframe === "4h") {
        points = points.slice(-48);
      }

      else if (
        timeframe === "24h" ||
        timeframe === "1d"
      ) {
        points = points.slice(-24);
      }

      else if (timeframe === "7d") {
        points = points.slice(-42);
      }
    }

    /*
      RESPONSE
    */

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
