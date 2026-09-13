export default async function handler(req, res) {
  try {
    const networks = [
      "eth",
      "solana",
      "base",
      "bsc",
      "arbitrum",
      "polygon_pos",
      "avalanche"
    ];

    const results = await Promise.all(
      networks.map(async (network) => {
        try {
          const url =
            `https://api.geckoterminal.com/api/v2/networks/${network}/pools` +
            `?include=base_token,quote_token` +
            `&sort=h24_volume_usd_desc&page=1`;

          const response = await fetch(url, {
            headers: {
              accept: "application/json"
            }
          });

          if (!response.ok) {
            console.error(
              "GeckoTerminal error:",
              network,
              response.status
            );

            return [];
          }

          const json = await response.json();

          return (json.data || []).map((pool) => {
            const a = pool.attributes || {};
            const tx = a.transactions?.h24 || {};

            return {
              network,
              pool: pool.id,

              name: a.name || "Unknown",

              price: Number(
                a.base_token_price_usd || 0
              ),

              volume24h: Number(
                a.volume_usd?.h24 || 0
              ),

              liquidity: Number(
                a.reserve_in_usd || 0
              ),

              marketCap: Number(
                a.market_cap_usd || 0
              ),

              fdv: Number(
                a.fdv_usd || 0
              ),

              change24h: Number(
                a.price_change_percentage?.h24 || 0
              ),

              buys24h: Number(
                tx.buys || 0
              ),

              sells24h: Number(
                tx.sells || 0
              ),

              transactions24h:
                Number(tx.buys || 0) +
                Number(tx.sells || 0),

              createdAt:
                a.pool_created_at || null
            };
          });
        } catch (error) {
          console.error(
            "Network error:",
            network,
            error
          );

          return [];
        }
      })
    );

    const markets = results
      .flat()
      .filter((market) => {
        const name = String(
          market.name || ""
        ).toUpperCase();

        const liquidity =
          Number(market.liquidity || 0);

        const volume =
          Number(market.volume24h || 0);

        const transactions =
          Number(
            market.transactions24h || 0
          );

        if (!market.name) {
          return false;
        }

        if (liquidity < 100000) {
          return false;
        }

        if (volume < 10000) {
          return false;
        }

        /*
         * Remove only obvious stablecoin-only
         * pools.
         */

        if (
          name.includes("USDC / USDC") ||
          name.includes("USDT / USDT") ||
          name.includes("DAI / DAI") ||
          name.includes("USDC / USDT") ||
          name.includes("USDT / USDC")
        ) {
          return false;
        }

        /*
         * Basic suspicious-volume filter.
         */

        const volumeToLiquidity =
          liquidity > 0
            ? volume / liquidity
            : 0;

        if (
          volumeToLiquidity > 1000 &&
          transactions < 100
        ) {
          return false;
        }

        return true;
      })
      .sort(
        (a, b) =>
          Number(b.volume24h || 0) -
          Number(a.volume24h || 0)
      )
      .slice(0, 500)
      .map((market, index) => ({
        rank: index + 1,
        ...market
      }));

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    return res.status(200).json(markets);

  } catch (error) {
    console.error(
      "On-chain market error:",
      error
    );

    return res.status(500).json({
      error: "On-chain market data failed"
    });
  }
}
