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
      return (
        stablecoins.has(a) ||
        stablecoins.has(b)
      );
    }

    function getTokenInfo(pool, included) {
      const baseId =
        pool?.relationships?.base_token?.data?.id || "";

      const quoteId =
        pool?.relationships?.quote_token?.data?.id || "";

      const baseToken = included.find(
        item =>
          String(item?.id || "") ===
          String(baseId)
      );

      const quoteToken = included.find(
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

    function fallbackTokenInfo(pool) {
      const name =
        pool?.attributes?.name || "";

      const parts =
        String(name)
          .split("/")
          .map(item => cleanSymbol(item));

      return {
        tokenA: parts[0] || "",
        tokenB: parts[1] || ""
      };
    }

    /*
      ============================================================
      HISTORICAL 1H CANDLES
      ============================================================
    */

    async function getHourlyCandles(network, poolId) {
      try {
        const prefix = `${network}_`;

        if (!String(poolId).startsWith(prefix)) {
          return [];
        }

        const poolAddress =
          String(poolId).slice(prefix.length);

        if (!poolAddress) {
          return [];
        }

        const url =
          `${BASE}/networks/${network}/pools/${poolAddress}/ohlcv/hour` +
          `?aggregate=1&limit=48`;

        const response =
          await fetch(url, {
            headers
          });

        if (!response.ok) {
          return [];
        }

        const json =
          await response.json();

        const list =
          json?.data?.attributes?.ohlcv_list;

        if (!Array.isArray(list)) {
          return [];
        }

        return list
          .map(c => {
            if (!Array.isArray(c) || c.length < 6) {
              return null;
            }

            return {
              time: Number(c[0] || 0),
              open: Number(c[1] || 0),
              high: Number(c[2] || 0),
              low: Number(c[3] || 0),
              close: Number(c[4] || 0),
              volume: Number(c[5] || 0)
            };
          })
          .filter(
            c =>
              c &&
              c.open > 0 &&
              c.high > 0 &&
              c.low > 0 &&
              c.close > 0
          )
          .sort(
            (a, b) => a.time - b.time
          );

      } catch (error) {
        return [];
      }
    }

    /*
      ============================================================
      HISTORICAL REVIVAL DETECTION
      ============================================================

      Looks for:

      OLD MARKET
          ↓
      WEAKNESS / DIP
          ↓
      BASE / STABILIZATION
          ↓
      RECENT BULLISH RECOVERY
          ↓
      BUYING STARTED
    */

    function detectHistoricalRevival(candles) {
      if (
        !Array.isArray(candles) ||
        candles.length < 18
      ) {
        return {
          historical: false,
          dip: false,
          base: false,
          recovery: false,
          score: 0
        };
      }

      const recent =
        candles.slice(-6);

      const previous =
        candles.slice(-18, -6);

      if (
        recent.length < 4 ||
        previous.length < 6
      ) {
        return {
          historical: false,
          dip: false,
          base: false,
          recovery: false,
          score: 0
        };
      }

      const previousHigh =
        Math.max(
          ...previous.map(c => c.high)
        );

      const previousLow =
        Math.min(
          ...previous.map(c => c.low)
        );

      const recentLow =
        Math.min(
          ...recent.map(c => c.low)
        );

      const recentHigh =
        Math.max(
          ...recent.map(c => c.high)
        );

      const last =
        candles[candles.length - 1];

      const beforeLast =
        candles[candles.length - 2];

      /*
        DIP

        Price must have moved meaningfully
        below the previous high.
      */

      const dipPercent =
        previousHigh > 0
          ? (
              (previousHigh - recentLow) /
              previousHigh
            ) * 100
          : 0;

      const dip =
        dipPercent >= 8;

      /*
        BASE

        Recent candles should stop falling
        and stay relatively close together.
      */

      const baseRange =
        recentLow > 0
          ? (
              (recentHigh - recentLow) /
              recentLow
            ) * 100
          : 999;

      const base =
        baseRange <= 25;

      /*
        RECOVERY

        Current price should recover
        from the recent low.
      */

      const recoveryPercent =
        recentLow > 0
          ? (
              (last.close - recentLow) /
              recentLow
            ) * 100
          : 0;

      const recovery =
        recoveryPercent >= 3;

      /*
        BULLISH LAST CANDLE
      */

      const bullishCandle =
        last.close > last.open &&
        last.close > beforeLast.close;

      /*
        VOLUME RETURN

        Last candle should have more volume
        than the recent average.
      */

      const earlierRecent =
        recent.slice(0, -1);

      const averageVolume =
        earlierRecent.length
          ? earlierRecent.reduce(
              (sum, c) =>
                sum + Number(c.volume || 0),
              0
            ) /
            earlierRecent.length
          : 0;

      const volumeReturn =
        averageVolume > 0
          ? last.volume / averageVolume
          : 0;

      const volumeConfirmed =
        volumeReturn >= 1.2;

      let score = 0;

      if (dip) score += 25;
      if (base) score += 20;
      if (recovery) score += 20;
      if (bullishCandle) score += 20;
      if (volumeConfirmed) score += 15;

      /*
        Require the important parts:
        dip + base/recovery + bullish recovery
      */

      const historical =
        dip &&
        base &&
        recovery &&
        bullishCandle;

      return {
        historical,
        dip,
        base,
        recovery,
        bullishCandle,
        volumeConfirmed,
        recoveryPercent,
        volumeReturn,
        score
      };
    }

    /*
      ============================================================
      CURRENT REVIVAL DATA
      ============================================================
    */

    function calculateCurrentActivity(data) {
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
          candidate: false,
          score: 0,
          buyPressure: 0,
          acceleration: 0
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

      /*
        Candidate threshold intentionally
        remains moderate so valid markets
        can reach historical analysis.
      */

      const candidate =
        acceleration >= 1.1 &&
        buyPressure >= 0.50 &&
        change1h > 0;

      let score = 0;

      if (acceleration >= 3) {
        score += 40;
      } else if (acceleration >= 2) {
        score += 30;
      } else if (acceleration >= 1.5) {
        score += 20;
      } else if (acceleration >= 1.1) {
        score += 10;
      }

      if (buyPressure >= 0.65) {
        score += 35;
      } else if (buyPressure >= 0.60) {
        score += 30;
      } else if (buyPressure >= 0.55) {
        score += 20;
      } else if (buyPressure >= 0.50) {
        score += 10;
      }

      if (change1h >= 10) {
        score += 25;
      } else if (change1h >= 5) {
        score += 20;
      } else if (change1h >= 2) {
        score += 10;
      } else if (change1h > 0) {
        score += 5;
      }

      return {
        candidate,
        score,
        buyPressure,
        acceleration
      };
    }

    /*
      ============================================================
      FETCH TOP POOLS
      ============================================================
    */

    async function getPoolPage(network, page) {
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
        const response =
          await fetch(url, {
            headers
          });

        if (!response.ok) {
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
        return {
          network,
          data: [],
          included: []
        };
      }
    }

    /*
      ============================================================
      LOAD DATA
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
      BUILD MARKETS
      ============================================================
    */

    const markets = [];
    const seenPools = new Set();

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

        if (seenPools.has(poolId)) {
          continue;
        }

        seenPools.add(poolId);

        const attributes =
          pool.attributes || {};

        const volume24h =
          Number(
            attributes.volume_usd?.h24 || 0
          );

        const volume1h =
          Number(
            attributes.volume_usd?.h1 || 0
          );

        const liquidity =
          Number(
            attributes.reserve_in_usd || 0
          );

        if (
          volume24h < 5000 &&
          liquidity < 50000
        ) {
          continue;
        }

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

        if (
          hasStablecoin(
            tokenA,
            tokenB
          )
        ) {
          continue;
        }

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

        const current =
          calculateCurrentActivity({
            volume1h,
            volume24h,
            buys: buys24h,
            sells: sells24h,
            change1h,
            ageDays
          });

        markets.push({
          network,
          pool: poolId,

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

          revival: false,
          revivalScore: 0,
          revivalStatus: "Normal",

          buyPressure:
            Number(
              current.buyPressure || 0
            ),

          currentCandidate:
            current.candidate,

          currentScore:
            current.score,

          acceleration:
            current.acceleration,

          source:
            "GeckoTerminal"
        });
      }
    }

    /*
      ============================================================
      SORT MAIN MARKETS
      ============================================================
    */

    markets.sort(
      (a, b) =>
        Number(b.volume24h || 0) -
        Number(a.volume24h || 0)
    );

    /*
      ============================================================
      HISTORICAL REVIVAL ANALYSIS
      ============================================================

      Only analyse candidates.

      Maximum 100 candidates to avoid
      excessive API requests.
    */

    const candidates =
      markets
        .filter(
          market =>
            market.ageDays >= 30 &&
            market.currentCandidate === true
        )
        .sort(
          (a, b) =>
            Number(b.currentScore || 0) -
            Number(a.currentScore || 0)
        )
        .slice(0, 100);

    /*
      Process historical requests in small
      batches.
    */

    const batchSize = 10;

    for (
      let start = 0;
      start < candidates.length;
      start += batchSize
    ) {
      const batch =
        candidates.slice(
          start,
          start + batchSize
        );

      await Promise.all(
        batch.map(
          async market => {
            const candles =
              await getHourlyCandles(
                market.network,
                market.pool
              );

            const historical =
              detectHistoricalRevival(
                candles
              );

            /*
              Historical confirmation.

              Need:
              - historical dip
              - base
              - recovery
              - bullish candle
            */

            if (
              historical.historical
            ) {
              market.revival = true;

              market.revivalStatus =
                "Buying Started";

              market.revivalScore =
                Math.min(
                  100,
                  Number(
                    market.currentScore || 0
                  ) +
                  Number(
                    historical.score || 0
                  )
                );

              market.historicalDip =
                historical.dip;

              market.historicalBase =
                historical.base;

              market.historicalRecovery =
                historical.recovery;

              market.historicalBullish =
                historical.bullishCandle;

              market.historicalVolume =
                historical.volumeConfirmed;

              market.recoveryPercent =
                Number(
                  historical.recoveryPercent || 0
                );

              market.volumeReturn =
                Number(
                  historical.volumeReturn || 0
                );
            }
          }
        )
      );
    }

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
