export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const rawPool = String(
      req.query?.pool || ""
    ).trim();

    const suppliedNetwork = String(
      req.query?.network || ""
    ).trim();

    const timeframe = String(
      req.query?.timeframe ||
      req.query?.range ||
      "24h"
    ).trim().toLowerCase();

    if (!rawPool) {
      return res.status(400).json({
        error: "Missing pool"
      });
    }

    let network = suppliedNetwork;
    let poolAddress = rawPool;

    if (!network) {
      const separator = rawPool.indexOf("_");

      if (separator > 0) {
        network =
          rawPool.slice(0, separator).trim();

        poolAddress =
          rawPool.slice(separator + 1).trim();
      }
    }

    if (!network || !poolAddress) {
      return res.status(400).json({
        error: "Invalid pool"
      });
    }

    const BASE =
      "https://api.geckoterminal.com/api/v2";

    const headers = {
      Accept:
        "application/json;version=20230203"
    };

    /*
      -----------------------------------------
      TIMEFRAME
      -----------------------------------------
    */

    let timeframePath = "hour";
    let aggregate = 1;
    let limit = 24;

    if (timeframe === "1h") {
      timeframePath = "minute";
      aggregate = 1;
      limit = 60;
    }

    else if (timeframe === "4h") {
      timeframePath = "minute";
      aggregate = 5;
      limit = 48;
    }

    else if (
      timeframe === "24h" ||
      timeframe === "1d"
    ) {
      timeframePath = "hour";
      aggregate = 1;
      limit = 24;
    }

    else if (timeframe === "7d") {
      timeframePath = "hour";
      aggregate = 4;
      limit = 42;
    }

    /*
      -----------------------------------------
      HELPERS
      -----------------------------------------
    */

    function convertRows(list) {
      if (!Array.isArray(list)) {
        return [];
      }

      return list
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

    async function fetchJSON(url) {
      try {
        const response =
          await fetch(url, {
            headers
          });

        if (!response.ok) {
          console.log(
            "FlowRank API:",
            response.status,
            url
          );

          return null;
        }

        return await response.json();

      } catch (error) {
        console.log(
          "FlowRank fetch failed:",
          error?.message || error
        );

        return null;
      }
    }

    /*
      -----------------------------------------
      1. NORMAL POOL OHLCV
      -----------------------------------------
    */

    async function getPoolHistory(extra = "") {
      const url =
        `${BASE}/networks/` +
        `${encodeURIComponent(network)}` +
        `/pools/` +
        `${encodeURIComponent(poolAddress)}` +
        `/ohlcv/${timeframePath}` +
        `?aggregate=${aggregate}` +
        `&limit=${limit}` +
        `&currency=usd` +
        extra;

      const json =
        await fetchJSON(url);

      return convertRows(
        json?.data?.attributes?.ohlcv_list
      );
    }

    let points =
      await getPoolHistory("");

    /*
      Try base / quote modes.
    */

    if (!points.length) {
      points =
        await getPoolHistory(
          "&token=base"
        );
    }

    if (!points.length) {
      points =
        await getPoolHistory(
          "&token=quote"
        );
    }

    /*
      -----------------------------------------
      2. GET POOL INFO
      -----------------------------------------
      If pool OHLCV is empty, find the actual
      token address from the pool.
    */

    if (!points.length) {

      const poolInfoUrl =
        `${BASE}/networks/` +
        `${encodeURIComponent(network)}` +
        `/pools/` +
        `${encodeURIComponent(poolAddress)}` +
        `?include=base_token,quote_token`;

      const poolJSON =
        await fetchJSON(poolInfoUrl);

      let baseTokenAddress = "";
      let quoteTokenAddress = "";

      const included =
        Array.isArray(
          poolJSON?.included
        )
          ? poolJSON.included
          : [];

      const poolData =
        poolJSON?.data;

      const baseRelationship =
        poolData?.relationships?.base_token?.data;

      const quoteRelationship =
        poolData?.relationships?.quote_token?.data;

      if (baseRelationship?.id) {
        baseTokenAddress =
          String(
            baseRelationship.id
          )
            .replace(
              `${network}_`,
              ""
            )
            .trim();
      }

      if (quoteRelationship?.id) {
        quoteTokenAddress =
          String(
            quoteRelationship.id
          )
            .replace(
              `${network}_`,
              ""
            )
            .trim();
      }

      /*
        Also inspect included token objects.
      */

      for (const item of included) {
        const id =
          String(item?.id || "");

        const address =
          String(
            item?.attributes?.address || ""
          ).trim();

        if (!address) {
          continue;
        }

        if (
          baseRelationship?.id === id &&
          !baseTokenAddress
        ) {
          baseTokenAddress = address;
        }

        if (
          quoteRelationship?.id === id &&
          !quoteTokenAddress
        ) {
          quoteTokenAddress = address;
        }
      }

      /*
        -----------------------------------------
        3. TOKEN OHLCV
        -----------------------------------------
      */

      async function getTokenHistory(
        tokenAddress
      ) {
        if (!tokenAddress) {
          return [];
        }

        const url =
          `${BASE}/networks/` +
          `${encodeURIComponent(network)}` +
          `/tokens/` +
          `${encodeURIComponent(tokenAddress)}` +
          `/ohlcv/${timeframePath}` +
          `?aggregate=${aggregate}` +
          `&limit=${limit}` +
          `&currency=usd`;

        const json =
          await fetchJSON(url);

        return convertRows(
          json?.data?.attributes?.ohlcv_list
        );
      }

      /*
        Base token first.
      */

      points =
        await getTokenHistory(
          baseTokenAddress
        );

      /*
        Quote token fallback.
      */

      if (!points.length) {
        points =
          await getTokenHistory(
            quoteTokenAddress
          );
      }
    }

    /*
      -----------------------------------------
      FINAL RESPONSE
      -----------------------------------------
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
