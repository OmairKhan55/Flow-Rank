export default async function handler(req, res) {
  try {
    const BASE = "https://api.geckoterminal.com/api/v2";

    const headers = {
      Accept: "application/json;version=20230203"
    };

    // Major chains
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

    async function getPools(url) {
      try {
        const response = await fetch(url, { headers });

        if (!response.ok) {
          console.error("GeckoTerminal status:", response.status);
          return [];
        }

        const json = await response.json();

        return Array.isArray(json.data) ? json.data : [];
      } catch (error) {
        console.error("Fetch error:", error);
        return [];
      }
    }

    function addPool(pool, network) {
      if (!pool || !pool.id) return;

      const poolId = String(pool.id);

      // Remove duplicates
      if (seenPools.has(poolId)) return;
      seenPools.add(poolId);

      const a = pool.attributes || {};
      const tx = a.transactions?.h24 || {};

      const volume24h = Number(a.volume_usd?.h24 || 0);
      const liquidity = Number(a.reserve_in_usd || 0);

      // Ignore extremely small pools
      if (volume24h < 5000) return;
      if (liquidity < 50000) return;

      const marketCap = Number(a.market_cap_usd || 0);
      const fdv = Number(a.fdv_usd || 0);

      const buys24h = Number(tx.buys || 0);
      const sells24h = Number(tx.sells || 0);

      const name = a.name || "Unknown";
      const upperName = name.toUpperCase();

      // Remove obvious stablecoin-vs-stablecoin pools
      const blocked = [
        "USDC / USDC",
        "USDT / USDT",
        "DAI / DAI",
        "USDC / USDT",
        "USDT / USDC",
        "USDC/USDC",
        "USDT/USDT",
        "USDC/USDT",
        "USDT/USDC"
      ];

      if (blocked.some(item => upperName.includes(item))) {
        return;
      }

      markets.push({
        network,
        pool: poolId,
        name,

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
            : fdv > 0
              ? fdv
              : 0,

        valueType:
          marketCap > 0
            ? "Market Cap"
            : fdv > 0
              ? "FDV"
              : "N/A",

        change24h: Number(
          a.price_change_percentage?.h24 || 0
        ),

        change1h: Number(
          a.price_change_percentage?.h1 || 0
        ),

        buys24h,
        sells24h,

        transactions24h:
          buys24h + sells24h,

        createdAt:
          a.pool_created_at || null,

        source: "GeckoTerminal"
      });
    }

    // Get highest-volume pools from every selected chain
    for (const network of networks) {
      const url =
        `${BASE}/networks/${network}/pools` +
        `?include=base_token,quote_token` +
        `&sort=h24_volume_usd_desc` +
        `&page=1`;

      const pools = await getPools(url);

      for (const pool of pools) {
        addPool(pool, network);
      }

      // Small delay between requests
      await new Promise(resolve =>
        setTimeout(resolve, 800)
      );
    }

    // IMPORTANT:
    // Highest 24H volume comes first.
    markets.sort(
      (a, b) =>
        Number(b.volume24h || 0) -
        Number(a.volume24h || 0)
    );

    // Return top 500
    const finalMarkets = markets
      .slice(0, 500)
      .map((market, index) => ({
        rank: index + 1,
        ...market
      }));

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res.status(200).json(finalMarkets);

  } catch (error) {
    console.error("Markets API error:", error);

    return res.status(500).json({
      error: "On-chain market data failed"
    });
  }
}
