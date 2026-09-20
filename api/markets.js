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

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function cleanSymbol(value) {
      if (!value) return "";

      return String(value)
        .replace(/\$/g, "")
        .trim()
        .toUpperCase();
    }

    function getIncludedMap(json) {
      const included = Array.isArray(json?.included)
        ? json.included
        : [];

      const map = new Map();

      for (const item of included) {
        if (item?.id) {
          map.set(String(item.id), item);
        }
      }

      return map;
    }

    function getTokenInfo(pool, includedMap) {
      const baseId =
        pool?.relationships?.base_token?.data?.id || "";

      const quoteId =
        pool?.relationships?.quote_token?.data?.id || "";

      const baseToken =
        includedMap.get(String(baseId));

      const quoteToken =
        includedMap.get(String(quoteId));

      const tokenA =
        cleanSymbol(
          baseToken?.attributes?.symbol
        );

      const tokenB =
        cleanSymbol(
          quoteToken?.attributes?.symbol
        );

      const tokenAAddress =
        String(
          baseToken?.attributes?.address || ""
        );

      const tokenBAddress =
        String(
          quoteToken?.attributes?.address || ""
        );

      return {
        tokenA,
        tokenB,
        tokenAAddress,
        tokenBAddress
      };
    }

    function getNameFallback(pool) {
      const name =
        pool?.attributes?.name || "";

      const parts = String(name)
        .split("/")
        .map(x => cleanSymbol(x));

      return {
        tokenA: parts[0] || "",
        tokenB: parts[1] || ""
      };
    }

    function isStablePair(a, b) {
      return (
        stablecoins.has(a) &&
        stablecoins.has(b)
      );
    }

    function revivalScore(data) {
      const volume1h =
        Number(data.volume1h || 0);

      const volume24h =
        Number(data.volume24h || 0);

      const buys =
        Number(data.buys24h || 0);

      const sells =
        Number(data.sells24h || 0);

      const change1h =
        Number(data.change1h || 0);

      if (
        volume1h <= 0 ||
        volume24h <= 0
      ) {
        return 0;
      }

      const averageHourly =
        volume24h / 24;

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
          console.log(
            `${network} rate limited`
          );

          /*
            Wait before one retry.
            Public API is rate limited, so
            we don't spam repeated requests.
          */
          await sleep(4000);

          const retry = await fetch(url, {
            headers
          });

          if (!retry.ok) {
            console.log(
              `${network} retry HTTP ${retry.status}`
            );

            return {
              data: [],
              included: []
            };
          }

          const retryJson =
            await retry.json();

          return {
            data: Array.isArray(retryJson?.data)
              ? retryJson.data
              : [],

            included: Array.isArray(
              retryJson?.included
            )
              ? retryJson.included
              : []
          };
        }

        if (!response.ok) {
          console.log(
            `${network} HTTP ${response.status}`
          );

          return {
            data: [],
            included: []
          };
        }

        const json =
          await response.json();

        return {
          data: Array.isArray(json?.data)
            ? json.data
            : [],

          included: Array.isArray(json?.included)
            ? json.included
            : []
        };

      } catch (error) {
        console.log(
          `${network} request failed`,
          error?.message || error
        );

        return {
          data: [],
          included: []
        };
      }
    }

    const markets = [];
    const seenPools = new Set();

    for (const network of networks) {
      const result =
        await getPools(network);

      const pools =
        Array.isArray(result.data)
          ? result.data
          : [];

      const includedMap =
        new Map();

      for (const item of result.included || []) {
        if (item?.id) {
          includedMap.set(
            String(item.id),
            item
          );
        }
      }

      for (const pool of pools) {
        if (!pool?.id) continue;

        const poolId =
          String(pool.id);

        if (seenPools.has(poolId)) {
          continue;
        }

        seenPools.add(poolId);

        const a =
          pool.attributes || {};

        const tx =
          a.transactions?.h24 || {};

        const volume24h =
          Number(
            a.volume_usd?.h24 || 0
          );

        const volume1h =
          Number(
            a.volume_usd?.h1 || 0
          );

        const liquidity =
          Number(
            a.reserve_in_usd || 0
          );

        /*
          Ignore tiny pools.
        */
        if (
          volume24h < 5000 ||
          liquidity < 50000
        ) {
          continue;
        }

        let {
          tokenA,
          tokenB,
          tokenAAddress,
          tokenBAddress
        } = getTokenInfo(
          pool,
          includedMap
        );

        /*
          Fallback to pool name.
        */
        if (!tokenA || !tokenB) {
          const fallback =
            getNameFallback(pool);

          tokenA =
            tokenA ||
            fallback.tokenA;

          tokenB =
            tokenB ||
            fallback.tokenB;
        }

        if (!tokenA || !tokenB) {
          continue;
        }

        /*
          Remove stablecoin/stablecoin
          markets.
        */
        if (
          isStablePair(
            tokenA,
            tokenB
          )
        ) {
          continue;
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
          Number(
            tx.buys || 0
          );

        const sells24h =
          Number(
            tx.sells || 0
          );

        const transactions24h =
          buys24h +
          sells24h;

        const change1h =
          Number(
            a.price_change_percentage?.h1 ||
              0
          );

        const change24h =
          Number(
            a.price_change_percentage?.h24 ||
              0
          );

        const score =
          revivalScore({
            volume1h,
            volume24h,
            buys24h,
            sells24h,
            change1h
          });

        let revivalStatus =
          "Normal";

        if (score >= 65) {
          revivalStatus =
            "Buying Started";
        } else if (score >= 45) {
          revivalStatus =
            "Reviving";
        }

        markets.push({
          network,

          pool: poolId,

          name:
            a.name ||
            `${tokenA} / ${tokenB}`,

          tokenA,
          tokenB,

          /*
            Contract / Mint addresses
          */
          tokenAAddress,
          tokenBAddress,

          /*
            Frontend can use this as
            the main token address.
          */
          tokenAddress:
            tokenAAddress || "",

          baseTokenAddress:
            tokenAAddress || "",

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
            a.pool_created_at ||
            null,

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
        Small gap between networks
        to reduce API burst.
      */
      await sleep(1200);
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
      Maximum 500 markets.
    */
    const finalMarkets =
      markets
        .slice(0, 500)
        .map((market, index) => ({
          rank: index + 1,
          ...market
        }));

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
      error?.message || error
    );

    return res
      .status(500)
      .json({
        error:
          "On-chain market data failed"
      });
  }
}
