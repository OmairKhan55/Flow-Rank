export default async function handler(req, res) {
  try {
    const networks = ["eth", "solana", "base", "bsc", "arbitrum"];

    const results = await Promise.all(
      networks.map(async (network) => {
        const url =
          `https://api.geckoterminal.com/api/v2/networks/${network}/pools` +
          `?include=base_token,quote_token` +
          `&sort=h24_volume_usd_desc&page=1`;

        const response = await fetch(url, {
          headers: {
            accept: "application/json"
          }
        });

        if (!response.ok) return [];

        const json = await response.json();

        return (json.data || []).map((pool) => ({
          network,
          pool: pool.id,
          name: pool.attributes?.name || "Unknown",
          price: Number(pool.attributes?.base_token_price_usd || 0),
          volume24h: Number(pool.attributes?.volume_usd?.h24 || 0),
          liquidity: Number(pool.attributes?.reserve_in_usd || 0),
          change24h: Number(
            pool.attributes?.price_change_percentage?.h24 || 0
          )
        }));
      })
    );

    const markets = results
      .flat()
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 100)
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
    console.error("DEX market error:", error);

    return res.status(500).json({
      error: "DEX market data failed"
    });
  }
}
