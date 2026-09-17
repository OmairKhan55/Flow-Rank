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

    function cleanSymbol(value) {
      if (!value) return "";
      return String(value)
        .replace(/\$/g, "")
        .trim()
        .toUpperCase();
    }

    function getSymbols(pool) {
      const included = Array.isArray(pool.included)
        ? pool.included
        : [];

      const tokens = included.filter(
        item => item && item.type === "token"
      );

      const symbols = tokens
        .map(token =>
          cleanSymbol(token.attributes?.symbol)
        )
        .filter(Boolean);

      return {
        tokenA: symbols[0] || "",
        tokenB: symbols[1] || ""
      };
    }

    function isStablePair(a, b) {
      return stablecoins.has(a) && stablecoins.has(b);
    }

    function revivalScore(data) {
      const volume1h = Number(data.volume1h || 0);
      const volume24h = Number(data.volume24h || 0);
      const buys = Number(data.buys24h || 0);
      const sells = Number(data.sells24h || 0);
      const change1h = Number(data.change1h || 0);

      if (volume1h <= 0 || volume24h <= 0) {
        return 0;
      }

      const averageHourly = volume24h / 24;

      const acceleration =
        averageHourly > 0
          ? volume1h / averageHourly
          : 0;

      const buyRatio =
        buys + sells > 0
          ? buys / (buys + sells)
          : 0;

      let score = 0;

      if (acceleration >= 2) {
        score += 40;
      } else if (acceleration >= 1.5) {
        score += 25;
      } else if (acceleration >= 1.2) {
        score += 15;
      }

      if (buyRatio >= 0.65) {
        score += 35;
      } else if (buyRatio >= 0.58) {
        score += 25;
      } else if (buyRatio >= 0.52) {
        score += 10;
      }

      if (change1h >= 5) {
        score += 15;
      } else if (change1h >= 2) {
        score += 10;
      }

      return score;
    }

    /*
      IMPORTANT:
      GeckoTerminal public API is rate-limited.
      We fetch networks SEQUENTIALLY instead of 7 requests
      at the exact same time.
    */

    async function getPools(network) {
      const url =
        `${BASE}/networks/${network}/pools` +
        `?include=base_token,quote_token` +
        `&sort=h24_volume_usd_desc` +
        `&page=1`;

      try {
        const response = await fetch(url, {
          headers
        });

        if (response.status === 429) {
          console.log(`${network} rate limited`);
          return [];
        }

        if (!response.ok) {
          console.log(
            `${network} HTTP ${response.status}`
          );
          return [];
        }

        const json = await response.json();

        return Array.isArray(json.data)
          ? json.data
          : [];
      } catch (error) {
        console.log(
          `${network} request failed`,
          error?.message || error
        );

        return [];
      }
    }

    const markets = [];
    const seenPools = new Set();

    /*
      Small delay between networks.
      This reduces burst traffic.
    */
    function sleep(ms) {
      return new Promise(resolve =>
        setTimeout(resolve, ms)
      );
    }

    for (const network of networks) {
      const pools = await getPools(network);

      for (const pool of pools) {
        if (!pool || !pool.id) continue;

        const poolId = String(pool.id);

        if (seenPools.has(poolId)) {
          continue;
        }

        seenPools.add(poolId);

        const a = pool.attributes || {};

        const tx =
          a.transactions?.h24 || {};

        const volume24h =
          Number(a.volume_usd?.h24 || 0);

        const volume1h =
          Number(a.volume_usd?.h1 || 0);

        const liquidity =
          Number(a.reserve_in_usd || 0);

        /*
          Ignore extremely small pools.
        */
        if (
          volume24h < 5000 ||
          liquidity < 50000
        ) {
          continue;
        }

        let { tokenA, tokenB } =
          getSymbols(pool);

        if (!tokenA || !tokenB) {
          const parts =
            String(a.name || "")
              .split("/")
              .map(x => cleanSymbol(x));

          tokenA =
            tokenA || parts[0] || "";

          tokenB =
            tokenB || parts[1] || "";
        }

        if (!tokenA || !tokenB) {
          continue;
        }

        /*
          Remove stablecoin/stablecoin pairs.
        */
        if (isStablePair(tokenA, tokenB)) {
          continue;
        }

        const marketCap =
          Number(a.market_cap_usd || 0);

        const fdv =
          Number(a.fdv_usd || 0);

        const buys24h =
          Number(tx.buys || 0);

        const sells24h =
          Number(tx.sells || 0);

        const transactions24h =
          buys24h + sells24h;

        const change1h =
          Number(
            a.price_change_percentage?.h1 || 0
          );

        const change24h =
          Number(
            a.price_change_percentage?.h24 || 0
          );

        const score = revivalScore({
          volume1h,
          volume24h,
          buys24h,
          sells24h,
          change1h
        });

        let revivalStatus = "Normal";

        if (score >= 65) {
          revivalStatus = "Buying Started";
        } else if (score >= 45) {
          revivalStatus = "Reviving";
        }

        markets.push({
          network,
          pool: poolId,

          name:
            a.name ||
            `${tokenA} / ${tokenB}`,

          tokenA,
          tokenB,

          price:
            Number(
              a.base_token_price_usd || 0
            ),

          volume1h,
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

          change1h,
          change24h,

          buys24h,
          sells24h,
          transactions24h,

          createdAt:
            a.pool_created_at || null,

          revival:
            score >= 45,

          revivalScore:
            score,

          revivalStatus,

          source:
            "GeckoTerminal"
        });
      }

      /*
        Give the API a small breathing gap
        before the next network.
      */
      await sleep(700);
    }

    /*
      Highest 24H volume first.
    */
    markets.sort(
      (a, b) =>
        Number(b.volume24h || 0) -
        Number(a.volume24h || 0)
    );

    /*
      Keep maximum 500 markets.
    */
    const finalMarkets =
      markets
        .slice(0, 500)
        .map((market, index) => ({
          rank: index + 1,
          ...market
        }));

    /*
      CDN cache.
      This is very important because the data
      does not need a fresh API call every second.
    */
    res.setHeader(
      "Cache-Control",
      "s-maxage=120, stale-while-revalidate=300"
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res
      .status(200)
      .json(finalMarkets);

  } catch (error) {
    console.error(
      "Markets API error:",
      error
    );

    return res
      .status(500)
      .json({
        error:
          "On-chain market data failed"
      });
  }
}
