export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

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

    function hasStablecoin(a, b) {
      return stablecoins.has(a) || stablecoins.has(b);
    }

    function getTokenInfo(pool, included) {
      const baseId =
        pool?.relationships?.base_token?.data?.id || "";

      const quoteId =
        pool?.relationships?.quote_token?.data?.id || "";

      const baseToken = included.find(
        item =>
          String(item?.id || "") === String(baseId)
      );

      const quoteToken = included.find(
        item =>
          String(item?.id || "") === String(quoteId)
      );

      return {
        tokenA: cleanSymbol(
          baseToken?.attributes?.symbol
        ),

        tokenB: cleanSymbol(
          quoteToken?.attributes?.symbol
        ),

        tokenAAddress:
          String(
            baseToken?.attributes?.address || ""
          ),

        tokenBAddress:
          String(
            quoteToken?.attributes?.address || ""
          )
      };
    }

    function fallbackTokenInfo(pool) {
      const name =
        pool?.attributes?.name || "";

      const parts = String(name)
        .split("/")
        .map(item => cleanSymbol(item));

      return {
        tokenA: parts[0] || "",
        tokenB: parts[1] || ""
      };
    }

    /*
      ============================================================
      REVIVAL / BUYING STARTED
      ============================================================

      Only OLD markets:
      30+ days

      Buying Started requires:
      - 1H volume above normal hourly average
      - buyers >= sellers
      - positive 1H price movement

      Stronger activity = higher score.
    */

    function calculateRevival(data) {
      const volume1h =
        Number(data.volume1h || 0);

      const volume24h =
        Number(data.volume24h || 0);

      const buys =
        Number(data.buys || 0);

      const sells =
        Number(data.sells || 0);

      const change1h =
        Number(data.change1h || 0);

      const ageDays =
        Number(data.ageDays || 0);

      if (
        ageDays < 30 ||
        volume1h <= 0 ||
        volume24h <= 0
      ) {
        return {
          score: 0,
          status: "Normal",
          revival: false,
          buyPressure: 0
        };
      }

      const hourlyAverage =
        volume24h / 24;

      const acceleration =
        hourlyAverage > 0
          ? volume1h / hourlyAverage
          : 0;

      const totalTrades =
        buys + sells;

      const buyPressure =
        totalTrades > 0
          ? buys / totalTrades
          : 0;

      let score = 0;

      /*
        VOLUME PICKUP
      */

      if (acceleration >= 3) {
        score += 40;
      } else if (acceleration >= 2) {
        score += 30;
      } else if (acceleration >= 1.5) {
        score += 20;
      } else if (acceleration >= 1.2) {
        score += 10;
      }

      /*
        BUY PRESSURE
      */

      if (buyPressure >= 0.65) {
        score += 35;
      } else if (buyPressure >= 0.60) {
        score += 30;
      } else if (buyPressure >= 0.55) {
        score += 20;
      } else if (buyPressure >= 0.52) {
        score += 10;
      }

      /*
        1H PRICE ACTION
      */

      if (change1h >= 10) {
        score += 25;
      } else if (change1h >= 5) {
        score += 20;
      } else if (change1h >= 2) {
        score += 10;
      } else if (change1h > 0) {
        score += 5;
      }

      /*
        BUYING STARTED

        Minimum:
        - 1.2x hourly volume
        - 52% buying pressure
        - positive 1H move
      */

      if (
        acceleration >= 1.2 &&
        buyPressure >= 0.52 &&
        change1h > 0
      ) {
        return {
          score,
          status: "Buying Started",
          revival: true,
          buyPressure
        };
      }

      /*
        REVIVING

        Slightly weaker activity.
      */

      if (
        acceleration >= 1.5 &&
        buyPressure >= 0.50 &&
        change1h >= 0
      ) {
        return {
          score,
          status: "Reviving",
          revival: true,
          buyPressure
        };
      }

      return {
        score,
        status: "Normal",
        revival: false,
        buyPressure
      };
    }

    /*
      ============================================================
      GET TOP POOLS
      ============================================================
    */

    async function getPoolPage(network, page) {
      const url =
        `${BASE}/networks/${network}/pools` +
        `?include=base_token,quote_token` +
        `&sort=h24_volume_usd_desc` +
        `&page=${page}`;

      try {
        const response = await fetch(url, {
          headers
        });

        if (!response.ok) {
          console.log(
            `${network} page ${page} HTTP ${response.status}`
          );

          return {
            network,
            data: [],
            included: []
          };
        }

        const json = await response.json();

        return {
          network,

          data:
            Array.isArray(json?.data)
              ? json.data
              : [],

          included:
            Array.isArray(json?.included)
              ? json.included
              : []
        };
      } catch (error) {
        console.log(
          `${network} page ${page} failed:`,
          error?.message || error
        );

        return {
          network,
          data: [],
          included: []
        };
      }
    }

    /*
      ============================================================
      NEW POOLS
      ============================================================
    */

    async function getNewPools(network) {
      const url =
        `${BASE}/networks/${network}/new_pools` +
        `?include=base_token,quote_token` +
        `&page=1`;

      try {
        const response = await fetch(url, {
          headers
        });

        if (!response.ok) {
          console.log(
            `${network} new pools HTTP ${response.status}`
          );

          return {
            network,
            data: [],
            included: []
          };
        }

        const json = await response.json();

        return {
          network,

          data:
            Array.isArray(json?.data)
              ? json.data
              : [],

          included:
            Array.isArray(json?.included)
              ? json.included
              : []
        };
      } catch (error) {
        console.log(
          `${network} new pools failed:`,
          error?.message || error
        );

        return {
          network,
          data: [],
          included: []
        };
      }
    }

    /*
      ============================================================
      REQUESTS
      ============================================================
    */

    const requests = [];

    for (const network of networks) {
      requests.push(
        getPoolPage(network, 1)
      );

      requests.push(
        getPoolPage(network, 2)
      );

      requests.push(
        getNewPools(network)
      );
    }

    const results =
      await Promise.all(requests);

    /*
      ============================================================
      MARKETS
      ============================================================
    */

    const markets = [];
    const seenPools = new Set();

    /*
      ============================================================
      PROCESS
      ============================================================
    */

    for (const result of results) {
      const network =
        result?.network || "";

      const pools =
        Array.isArray(result?.data)
          ? result.data
          : [];

      const included =
        Array.isArray(result?.included)
          ? result.included
          : [];

      for (const pool of pools) {
        if (!pool?.id) continue;

        const poolId =
          String(pool.id);

        if (seenPools.has(poolId)) {
          continue;
        }

        seenPools.add(poolId);

        const attributes =
          pool.attributes || {};

        /*
          VOLUME
        */

        const volume24h =
          Number(
            attributes.volume_usd?.h24 || 0
          );

        const volume1h =
          Number(
            attributes.volume_usd?.h1 || 0
          );

        /*
          LIQUIDITY
        */

        const liquidity =
          Number(
            attributes.reserve_in_usd || 0
          );

        /*
          BASIC FILTER
        */

        if (
          volume24h < 5000 &&
          liquidity < 50000
        ) {
          continue;
        }

        /*
          TOKEN INFO
        */

        let {
          tokenA,
          tokenB,
          tokenAAddress,
          tokenBAddress
        } =
          getTokenInfo(
            pool,
            included
          );

        if (!tokenA || !tokenB) {
          const fallback =
            fallbackTokenInfo(pool);

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
          STABLECOIN FILTER
        */

        if (
          hasStablecoin(
            tokenA,
            tokenB
          )
        ) {
          continue;
        }

        /*
          TRANSACTIONS
        */

        const transactions =
          attributes.transactions?.h24 ||
          {};

        const buys24h =
          Number(
            transactions.buys || 0
          );

        const sells24h =
          Number(
            transactions.sells || 0
          );

        const transactions24h =
          buys24h +
          sells24h;

        /*
          PRICE CHANGES
        */

        const change1h =
          Number(
            attributes
              .price_change_percentage
              ?.h1 || 0
          );

        const change24h =
          Number(
            attributes
              .price_change_percentage
              ?.h24 || 0
          );

        /*
          MARKET CAP / FDV
        */

        const marketCap =
          Number(
            attributes.market_cap_usd || 0
          );

        const fdv =
          Number(
            attributes.fdv_usd || 0
          );

        const displayValue =
          marketCap > 0
            ? marketCap
            : fdv > 0
            ? fdv
            : 0;

        const valueType =
          marketCap > 0
            ? "Market Cap"
            : fdv > 0
            ? "FDV"
            : "N/A";

        /*
          ========================================================
          CREATED DATE
          ========================================================
        */

        const createdAt =
          attributes.pool_created_at ||
          null;

        let ageDays = 0;

        if (createdAt) {
          const createdTime =
            new Date(createdAt).getTime();

          if (
            Number.isFinite(createdTime) &&
            createdTime > 0
          ) {
            ageDays =
              Math.floor(
                (
                  Date.now() -
                  createdTime
                ) / 86400000
              );
          }
        }

        /*
          ========================================================
          REVIVAL
          ========================================================
        */

        const revival =
          calculateRevival({
            volume1h,
            volume24h,
            buys: buys24h,
            sells: sells24h,
            change1h,
            ageDays
          });

        /*
          ========================================================
          FINAL OBJECT
          ========================================================
        */

        markets.push({
          network,

          pool:
            poolId,

          name:
            `${tokenA} / ${tokenB}`,

          tokenA,

          tokenB,

          tokenAAddress:
            tokenAAddress || "",

          tokenBAddress:
            tokenBAddress || "",

          tokenAddress:
            tokenAAddress || "",

          baseTokenAddress:
            tokenAAddress || "",

          price:
            Number(
              attributes
                .base_token_price_usd || 0
            ),

          volume1h,

          volume24h,

          liquidity,

          marketCap,

          fdv,

          displayValue,

          valueType,

          change1h,

          change24h,

          buys24h,

          sells24h,

          transactions24h,

          createdAt,

          ageDays,

          revival:
            revival.revival,

          revivalScore:
            revival.score,

          revivalStatus:
            revival.status,

          buyPressure:
            Number(
              revival.buyPressure || 0
            ),

          source:
            "GeckoTerminal"
        });
      }
    }

    /*
      ============================================================
      SORT BY 24H VOLUME
      ============================================================
    */

    markets.sort(
      (a, b) =>
        Number(b.volume24h || 0) -
        Number(a.volume24h || 0)
    );

    /*
      ============================================================
      FINAL 500
      ============================================================
    */

    const finalMarkets =
      markets
        .slice(0, 500)
        .map(
          (market, index) => ({
            rank: index + 1,
            ...market
          })
        );

    /*
      ============================================================
      CACHE
      ============================================================
    */

    res.setHeader(
      "Cache-Control",
      "s-maxage=180, stale-while-revalidate=600"
    );

    res.setHeader(
      "Content-Type",
      "application/json"
    );

    /*
      ============================================================
      RESPONSE
      ============================================================
    */

    return res
      .status(200)
      .json(finalMarkets);

  } catch (error) {
    console.error(
      "FlowRank Markets API Error:",
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
