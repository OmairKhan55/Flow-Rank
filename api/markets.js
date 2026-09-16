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

    // Stablecoins we don't want as the main token
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
        const response = await fetch(url, { headers });

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
      const included = pool.included || [];

      let baseSymbol = "";
      let quoteSymbol = "";

      for (const item of included) {
        const type = item.type;
        const symbol =
          item.attributes?.symbol || "";

        if (type === "token") {
          if (!baseSymbol) {
            baseSymbol = cleanSymbol(symbol);
          } else if (!quoteSymbol) {
            quoteSymbol = cleanSymbol(symbol);
          }
        }
      }

      return {
        baseSymbol,
        quoteSymbol
      };
    }

    function addPool(pool, network) {
      if (!pool || !pool.id) return;

      const poolId = String(pool.id);

      if (seenPools.has(poolId)) {
        return;
      }

      seenPools.add(poolId);

      const a = pool.attributes || {};
      const tx = a.transactions?.h24 || {};

      const volume24h =
        Number(a.volume_usd?.h24 || 0);

      const liquidity =
        Number(a.reserve_in_usd || 0);

      if (volume24h < 5000) return;
      if (liquidity < 50000) return;

      const {
        baseSymbol,
        quoteSymbol
      } = getTokenSymbols(pool);

      const pairName =
        a.name || "Unknown";

      /*
       * Try to get symbols from pair name
       * when included token data is unavailable.
       */
      let symbols = [
        baseSymbol,
        quoteSymbol
      ].filter(Boolean);

      if (symbols.length < 2) {
        const parts = pairName
          .split("/")
          .map(x => cleanSymbol(x));

        if (parts.length >= 2) {
          symbols = [
            parts[0],
            parts[1]
          ];
        }
      }

      const tokenA = symbols[0] || "";
      const tokenB = symbols[1] || "";

      /*
       * Remove pairs where BOTH sides
       * are stablecoins.
       */
      if (
        stablecoins.has(tokenA) &&
        stablecoins.has(tokenB)
      ) {
        return;
      }

      /*
       * Remove duplicate token pairs.
       *
       * Example:
       * SOL / USDC
       * SOL / USDC
       *
       * Only the highest-volume pool remains.
       */
      const pairKey = [
        network,
        tokenA,
        tokenB
      ]
        .sort()
        .join("_");

      if (
        tokenA &&
        tokenB &&
        seenPairs.has(pairKey)
      ) {
        return;
      }

      if (
        tokenA &&
        tokenB
      ) {
        seenPairs.add(pairKey);
      }

      const marketCap =
        Number(
          a.market_cap_usd || 0
        );

      const fdv =
        Number(
          a.fdv_usd || 0
        );

      const buys24h =
        Number(tx.buys || 0);

      const sells24h =
        Number(tx.sells || 0);

      markets.push({
        network,

        pool: poolId,

        name: pairName,

        tokenA,

        tokenB,

        price:
          Number(
            a.base_token_price_usd || 0
          ),

        volume24h,

        liquidity,

        marketCap,

        fdv,

        displayValue:
          marketCap > 0
            ? marketCap
            : fdv > 0
              ? fdv
              : 0,

        valueType:
          marketCap > 0
            ? "Market Cap"
            : fdv > 0
              ? "FDV"
              : "N/A",

        change24h:
          Number(
            a.price_change_percentage?.h24 || 0
          ),

        change1h:
          Number(
            a.price_change_percentage?.h1 || 0
          ),

        buys24h,

        sells24h,

        transactions24h:
          buys24h + sells24h,

        createdAt:
          a.pool_created_at || null,

        source:
          "GeckoTerminal"
      });
    }

    // Get pools from each major chain
    for (const network of networks) {
      const url =
        `${BASE}/networks/${network}/pools` +
        `?include=base_token,quote_token` +
        `&sort=h24_volume_usd_desc` +
        `&page=1`;

      const pools =
        await getPools(url);

      for (const pool of pools) {
        addPool(
          pool,
          network
        );
      }

      await new Promise(resolve =>
        setTimeout(
          resolve,
          800
        )
      );
    }

    // Highest 24H DEX volume first
    markets.sort(
      (a, b) =>
        Number(
          b.volume24h || 0
        ) -
        Number(
          a.volume24h || 0
        )
    );

    // Final ranking
    const finalMarkets =
      markets
        .slice(0, 500)
        .map(
          (market, index) => ({
            rank: index + 1,
            ...market
          })
        );

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res.status(200).json(
      finalMarkets
    );

  } catch (error) {
    console.error(
      "Markets API error:",
      error
    );

    return res.status(500).json({
      error:
        "On-chain market data failed"
    });
  }
}
