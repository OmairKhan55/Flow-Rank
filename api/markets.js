export default async function handler(req, res) {
  try {
    const BASE =
      "https://api.geckoterminal.com/api/v2";

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

    async function wait(ms) {
      return new Promise(resolve =>
        setTimeout(resolve, ms)
      );
    }

    async function getPools(url, source) {
      try {
        const response = await fetch(url, {
          headers
        });

        if (!response.ok) {
          console.error(
            "GeckoTerminal error:",
            source,
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
          "Request failed:",
          source,
          error
        );

        return [];
      }
    }

    function addPool(pool, fallbackNetwork = null) {
      if (!pool) return;

      const poolId = String(
        pool.id || ""
      );

      if (!poolId) return;

      if (seenPools.has(poolId)) {
        return;
      }

      seenPools.add(poolId);

      const a = pool.attributes || {};

      const network =
        fallbackNetwork ||
        poolId.split("_")[0] ||
        "unknown";

      const tx =
        a.transactions?.h24 || {};

      const marketCap = Number(
        a.market_cap_usd || 0
      );

      const fdv = Number(
        a.fdv_usd || 0
      );

      const volume24h = Number(
        a.volume_usd?.h24 || 0
      );

      const liquidity = Number(
        a.reserve_in_usd || 0
      );

      const change24h = Number(
        a.price_change_percentage?.h24 || 0
      );

      const buys24h = Number(
        tx.buys || 0
      );

      const sells24h = Number(
        tx.sells || 0
      );

      const transactions24h =
        buys24h + sells24h;

      const createdAt =
        a.pool_created_at || null;

      const market = {
        network,

        pool: poolId,

        name:
          a.name ||
          "Unknown",

        price: Number(
          a.base_token_price_usd || 0
        ),

        volume24h,

        liquidity,

        marketCap,

        fdv,

        displayValue:
          marketCap > 0
            ? marketCap
            : fdv,

        valueType:
          marketCap > 0
            ? "Market Cap"
            : fdv > 0
              ? "FDV"
              : "N/A",

        change24h,

        change1h: Number(
          a.price_change_percentage?.h1 || 0
        ),

        buys24h,

        sells24h,

        transactions24h,

        createdAt,

        source:
          "GeckoTerminal"
      };

      if (
        market.name ===
        "Unknown"
      ) {
        return;
      }

      /*
        Remove extremely small pools.
        This keeps the screener cleaner.
      */
      if (
        liquidity < 50000
      ) {
        return;
      }

      if (
        volume24h < 5000
      ) {
        return;
      }

      markets.push(market);
    }

    /*
      --------------------------------------------------
      1. GLOBAL TRENDING POOLS
      --------------------------------------------------
    */

    const globalTrending =
      await getPools(
        `${BASE}/networks/trending_pools`,
        "global-trending"
      );

    for (const pool of globalTrending) {
      addPool(pool);
    }

    await wait(700);

    /*
      --------------------------------------------------
      2. GLOBAL NEW POOLS
      --------------------------------------------------
    */

    const globalNew =
      await getPools(
        `${BASE}/networks/new_pools`,
        "global-new"
      );

    for (const pool of globalNew) {
      addPool(pool);
    }

    await wait(700);

    /*
      --------------------------------------------------
      3. TOP POOLS FOR EACH MAJOR NETWORK
      --------------------------------------------------
    */

    for (const network of networks) {
      const url =
        `${BASE}/networks/${network}/pools` +
        `?include=base_token,quote_token` +
        `&sort=h24_volume_usd_desc` +
        `&page=1`;

      const pools =
        await getPools(
          url,
          `${network}-top`
        );

      for (const pool of pools) {
        addPool(
          pool,
          network
        );
      }

      /*
        Public API is limited to approximately
        10 calls/minute, so keep requests spaced.
      */
      await wait(900);
    }

    /*
      --------------------------------------------------
      4. REMOVE STABLECOIN / INVALID PAIRS
      --------------------------------------------------
    */

    const filteredMarkets =
      markets.filter(market => {
        const name =
          String(
            market.name || ""
          ).toUpperCase();

        const blockedPairs = [
          "USDC / USDC",
          "USDT / USDT",
          "DAI / DAI",
          "USDC / USDT",
          "USDT / USDC",
          "USDC/USDC",
          "USDT/USDT",
          "DAI/DAI"
        ];

        for (
          const blocked of blockedPairs
        ) {
          if (
            name.includes(blocked)
          ) {
            return false;
          }
        }

        return true;
      });

    /*
      --------------------------------------------------
      5. SORT BY 24H VOLUME
      --------------------------------------------------
    */

    filteredMarkets.sort(
      (a, b) =>
        Number(
          b.volume24h || 0
        ) -
        Number(
          a.volume24h || 0
        )
    );

    /*
      --------------------------------------------------
      6. FINAL RANKING
      --------------------------------------------------
    */

    const finalMarkets =
      filteredMarkets
        .slice(0, 500)
        .map(
          (market, index) => ({
            rank:
              index + 1,

            ...market
          })
        );

    /*
      Cache for 60 seconds.
      GeckoTerminal itself caches public
      endpoint data for around 1 minute.
    */
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
      "On-chain market error:",
      error
    );

    return res.status(500).json({
      error:
        "On-chain market data failed",

      message:
        error?.message ||
        "Unknown error"
    });
  }
}
