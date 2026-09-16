export default async function handler(req, res) {
  try {
    const BASE = "https://api.geckoterminal.com/api/v2";

    const headers = {
      Accept: "application/json;version=20230203"
    };

    const networks = [
      "eth",
      "solana",
      "base",
      "bsc",
      "arbitrum",
      "polygon_pos",
      "avalanche"
    ];

    const markets = [];
    const seenPools = new Set();
    const seenPairs = new Set();

    const stablecoins = new Set([
      "USDT",
      "USDC",
      "DAI",
      "FDUSD",
      "USDE",
      "PYUSD",
      "USDS",
      "USDP",
      "TUSD",
      "BUSD",
      "FRAX",
      "USDG",
      "RLUSD",
      "USDD",
      "GUSD",
      "LUSD",
      "SUSD",
      "EURC",
      "EURI",
      "USDC.E",
      "USDT.E"
    ]);

    async function getPools(url) {
      try {
        const response = await fetch(url, {
          headers
        });

        if (!response.ok) {
          console.error(
            "GeckoTerminal:",
            response.status
          );
          return [];
        }

        const json = await response.json();

        return Array.isArray(json.data)
          ? json.data
          : [];
      } catch (error) {
        console.error(
          "Fetch error:",
          error
        );

        return [];
      }
    }

    function cleanSymbol(value) {
      if (!value) return "";

      return String(value)
        .replace(/\$/g, "")
        .trim()
        .toUpperCase();
    }

    function getTokenSymbols(pool) {
      const included =
        pool.included || [];

      let baseSymbol = "";
      let quoteSymbol = "";

      for (const item of included) {
        if (item.type !== "token") {
          continue;
        }

        const symbol =
          item.attributes?.symbol || "";

        if (!baseSymbol) {
          baseSymbol =
            cleanSymbol(symbol);
        } else if (!quoteSymbol) {
          quoteSymbol =
            cleanSymbol(symbol);
        }
      }

      return {
        baseSymbol,
        quoteSymbol
      };
    }

    function calculateRevival(
      volume1h,
      volume24h,
      buys24h,
      sells24h,
      change1h,
      change24h
    ) {
      const v1h =
        Number(volume1h || 0);

      const v24h =
        Number(volume24h || 0);

      const buys =
        Number(buys24h || 0);

      const sells =
        Number(sells24h || 0);

      const totalTx =
        buys + sells;

      if (v1h <= 0 || v24h <= 0) {
        return {
          revival: false,
          revivalScore: 0,
          revivalStatus: "Normal"
        };
      }

      /*
       * Compare the latest 1H volume
       * with the average hourly volume
       * over the last 24H.
       */
      const averageHourly =
        v24h / 24;

      const volumeAcceleration =
        averageHourly > 0
          ? v1h / averageHourly
          : 0;

      const buyRatio =
        totalTx > 0
          ? buys / totalTx
          : 0;

      let score = 0;

      // Strong recent volume
      if (volumeAcceleration >= 2) {
        score += 40;
      } else if (volumeAcceleration >= 1.5) {
        score += 25;
      } else if (volumeAcceleration >= 1.2) {
        score += 15;
      }

      // Buying activity
      if (buyRatio >= 0.65) {
        score += 35;
      } else if (buyRatio >= 0.58) {
        score += 25;
      } else if (buyRatio >= 0.52) {
        score += 10;
      }

      // Recent positive movement
      if (Number(change1
