export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const BASE =
      "https://api.geckoterminal.com/api/v2";

    const headers = {
      Accept: "application/json;version=20230203"
    };

    /*
      ============================================================
      NETWORKS
      ============================================================
    */

    const networks = [
      "eth",
      "solana",
      "base",
      "bsc",
      "arbitrum",
      "polygon_pos",
      "avalanche"
    ];

    /*
      ============================================================
      STABLECOINS
      ============================================================
    */

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

    function hasStablecoin(tokenA, tokenB) {
      return (
        stablecoins.has(tokenA) ||
        stablecoins.has(tokenB)
      );
    }

    /*
      ============================================================
      TOKEN INFORMATION
      ============================================================
    */

    function getTokenInfo(pool, included) {
      const baseId =
        pool?.relationships?.base_token?.data?.id || "";

      const quoteId =
        pool?.relationships?.quote_token?.data?.id || "";

      const baseToken =
        included.find(
          item =>
            String(item?.id || "") ===
            String(baseId)
        );

      const quoteToken =
        included.find(
          item =>
            String(item?.id || "") ===
            String(quoteId)
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

    /*
      ============================================================
      FALLBACK TOKEN INFORMATION
      ============================================================
    */

    function fallbackTokenInfo(pool) {
      const name =
        pool?.attributes?.name || "";

      const parts =
        String(name)
          .split("/")
          .map(item =>
            cleanSymbol(item)
          );

      return {
        tokenA: parts[0] || "",
        tokenB: parts[1] || ""
      };
    }

    /*
      ============================================================
      REVIVAL / BUYING ACTIVITY
      ============================================================
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

      /*
        Revival is only for OLD markets.

        Minimum age:
        30 days
      */

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

      /*
        ==========================================================
        1H VOLUME ACCELERATION
        ==========================================================
      */

      const hourlyAverage =
        volume24h / 24;

      const acceleration =
        hourlyAverage > 0
          ? volume1h / hourlyAverage
          : 0;

      /*
        ==========================================================
        BUY PRESSURE
        ==========================================================
      */

      const totalTrades =
        buys + sells;

      const buyPressure =
        totalTrades > 0
          ? buys / totalTrades
          : 0;

      let score = 0;

      /*
        ==========================================================
        VOLUME SCORE
        ==========================================================
      */

      if (acceleration >= 4) {
        score += 40;
      } else if (acceleration >= 3) {
        score += 30;
      } else if (acceleration >= 2) {
        score += 20;
      } else {
        return {
          score: 0,
          status: "Normal",
          revival: false,
          buyPressure
        };
      }

      /*
        ==========================================================
        BUYING SCORE
        ==========================================================
      */

      if (buyPressure >= 0.65) {
        score += 35;
      } else if (buyPressure >= 0.60) {
        score += 30;
      } else if (buyPressure >= 0.55) {
        score += 20;
      } else {
        return {
          score: 0,
          status: "Normal",
          revival: false,
          buyPressure
        };
      }

      /*
        ==========================================================
        1H PRICE MOVE
        ==========================================================
      */

      if (change1h >= 10) {
        score += 25;
      } else if (change1h >= 5) {
        score += 20;
      } else if (change1h >= 3) {
        score += 15;
      } else {
        return {
          score: 0,
          status: "Normal",
          revival: false,
          buyPressure
        };
      }

      /*
        ==========================================================
        BUYING STARTED
        ==========================================================
      */

      return {
        score,
        status: "Buying Started",
        revival: true,
        buyPressure
      };
    }

    /*
      ============================================================
      FETCH ONE PAGE OF TOP POOLS
      ============================================================
    */

    async function getPoolPage(
      network,
      page
    ) {
      const url =
        `${BASE}/networks/${network}/pools` +
        `?include=base_token,quote_token` +
        `&sort=h24_volume_usd_desc` +
        `&page=${page}`;

      try {
        const response =
          await fetch(url, {
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

        const json =
          await response.json();

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
      FETCH NEW POOLS
      ============================================================
    */

    async function getNewPools(network) {
      const url =
        `${BASE}/networks/${network}/new_pools` +
        `?include=base_token,quote_token` +
        `&page=1`;

      try {
        const response =
          await fetch(url, {
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

        const json =
          await response.json();

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
      LOAD MULTIPLE PAGES
      ============================================================

      2 pages per network
      + new pools
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
      MARKET STORAGE
      ============================================================
    */

    const markets = [];

    const seenPools =
      new Set();

    /*
      ============================================================
      PROCESS ALL RESULTS
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

        if (!pool?.id) {
          continue;
        }

        const poolId =
          String(pool.id);

        /*
          ========================================================
          REMOVE DUPLICATES
          ========================================================
        */

        if (
          seenPools.has(poolId)
        ) {
          continue;
        }

        seenPools.add(poolId);

        const attributes =
          pool.attributes || {};

        /*
          ========================================================
          VOLUME
          ========================================================
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
          ========================================================
          LIQUIDITY
          ========================================================
        */

        const liquidity =
          Number(
            attributes.reserve_in_usd || 0
          );

        /*
          ========================================================
          BASIC FILTER
          ========================================================
        */

        if (
          volume24h < 5000 &&
          liquidity < 50000
        ) {
          continue;
        }

        /*
          ========================================================
          TOKEN INFO
          ========================================================
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

        /*
          ========================================================
          FALLBACK
          ========================================================
        */

        if (
          !tokenA ||
          !tokenB
        ) {
          const fallback =
            fallbackTokenInfo(
              pool
            );

          tokenA =
            tokenA ||
            fallback.tokenA;

          tokenB =
            tokenB ||
            fallback.tokenB;
        }

        /*
          ========================================================
          MISSING TOKEN
          ========================================================
        */

        if (
          !tokenA ||
          !tokenB
        ) {
          continue;
        }

        /*
          ========================================================
          STABLECOIN FILTER
          ========================================================
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
          ========================================================
          TRANSACTIONS
          ========================================================
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
          ========================================================
          PRICE CHANGES
          ========================================================
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
          ========================================================
          MARKET CAP / FDV
          ========================================================
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
          POOL CREATED TIME
          ========================================================
        */

        const createdAt =
          attributes.pool_created_at ||
          null;

        /*
          ========================================================
          MARKET AGE
          ========================================================
        */

        const ageDays =
          createdAt
            ? Math.floor(
                (Date.now() -
                  new Date(createdAt).getTime()) /
                86400000
              )
            : 0;

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
          FINAL MARKET OBJECT
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
      SORT
      ============================================================
    */

    markets.sort(
      (a, b) =>
        Number(
          b.volume24h || 0
        ) -
        Number(
          a.volume24h || 0
        )
    );

    /*
      ============================================================
      FINAL 500 MARKETS
      ============================================================
    */

    const finalMarkets =
      markets
        .slice(0, 500)
        .map(
          (market, index) => ({
            rank:
              index + 1,

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
