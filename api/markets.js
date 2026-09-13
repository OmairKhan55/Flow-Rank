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

    const markets = [];

    for (const network of networks) {
      try {
        const url =
          `https://api.geckoterminal.com/api/v2/networks/${network}/pools` +
          `?include=base_token,quote_token` +
          `&sort=h24_volume_usd_desc&page=1`;

        const response = await fetch(url, {
          headers: {
            Accept: "application/json;version=20230203"
          }
        });

        if (!response.ok) {
          console.error(
            "GeckoTerminal error:",
            network,
            response.status
          );
          continue;
        }

        const json = await response.json();
        const pools = json.data || [];

        for (const pool of pools) {
          const a = pool.attributes || {};
          const tx = a.transactions?.h24 || {};

          const realMarketCap = Number(
            a.market_cap_usd || 0
          );

          const fdv = Number(
            a.fdv_usd || 0
          );

          const market = {
            network,
            pool: pool.id,

            name:
              a.name ||
              "Unknown",

            price: Number(
              a.base_token_price_usd || 0
            ),

            volume24h: Number(
              a.volume_usd?.h24 || 0
            ),

            liquidity: Number(
              a.reserve_in_usd || 0
            ),

            marketCap: realMarketCap,

            fdv,

            /*
              displayValue:
              Real Market Cap is used when available.
              If Market Cap is unavailable, FDV is shown
              separately so we never pretend FDV is Market Cap.
            */
            displayValue:
              realMarketCap > 0
                ? realMarketCap
                : fdv,

            valueType:
              realMarketCap > 0
                ? "Market Cap"
                : fdv > 0
                  ? "FDV"
                  : "N/A",

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

          if (!market.name) continue;

          if (
            market.liquidity < 100000
          ) {
            continue;
          }

          if (
            market.volume24h < 10000
          ) {
            continue;
          }

          markets.push(market);
        }

        await new Promise(resolve =>
          setTimeout(resolve, 700)
        );

      } catch (error) {
        console.error(
          "Network failed:",
          network,
          error
        );
      }
    }

    const filteredMarkets =
      markets.filter(market => {
        const name =
          String(
            market.name || ""
          ).toUpperCase();

        if (
          name.includes("USDC / USDC") ||
          name.includes("USDT / USDT") ||
          name.includes("DAI / DAI") ||
          name.includes("USDC / USDT") ||
          name.includes("USDT / USDC")
        ) {
          return false;
        }

        return true;
      });

    filteredMarkets.sort(
      (a, b) =>
        Number(b.volume24h || 0) -
        Number(a.volume24h || 0)
    );

    const finalMarkets =
      filteredMarkets
        .slice(0, 500)
        .map((market, index) => ({
          rank: index + 1,
          ...market
        }));

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
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
        "On-chain market data failed"
    });
  }
}
