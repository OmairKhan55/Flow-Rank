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
  "USDS",
  "USDE",
  "USD1",
  "USDA",
  "USAD",
  "USDG",
  "USDP",
  "PYUSD",
  "RLUSD",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "FRAX",
  "USDD",
  "GUSD",
  "LUSD",
  "SUSD",
  "EURC",
  "EURI",
  "USDC.E",
  "USDT.E",
  "USDB",
  "DOLA",
  "FUSD",
  "MUSD",
  "PUSD",
  "USDH",
  "USDV",
  "TRUSD",
  "FXUSD",
  "CUSD",
  "FRXUSD",
  "USDAT",
  "HLUSD",
  "USDCV",
  "YUSD"
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
        item => String(item?.id || "") === String(baseId)
      );

      const quoteToken = included.find(
        item => String(item?.id || "") === String(quoteId)
      );

      return {
        tokenA: cleanSymbol(baseToken?.attributes?.symbol),
        tokenB: cleanSymbol(quoteToken?.attributes?.symbol),
        tokenAAddress: String(
          baseToken?.attributes?.address || ""
        ),
        tokenBAddress: String(
          quoteToken?.attributes?.address || ""
        )
      };
    }

    function fallbackTokenInfo(pool) {
      const name = pool?.attributes?.name || "";

      const parts = String(name)
        .split("/")
        .map(item => cleanSymbol(item));

      return {
        tokenA: parts[0] || "",
        tokenB: parts[1] || ""
      };
    }

    function calculateRevival(data) {
      const volume1h = Number(data.volume1h || 0);
      const volume24h = Number(data.volume24h || 0);
      const buys = Number(data.buys || 0);
      const sells = Number(data.sells || 0);
      const change1h = Number(data.change1h || 0);
      const ageDays = Number(data.ageDays || 0);

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

      const hourlyAverage = volume24h / 24;

      const acceleration =
        hourlyAverage > 0
          ? volume1h / hourlyAverage
          : 0;

      const totalTrades = buys + sells;

      const buyPressure =
        totalTrades > 0
          ? buys / totalTrades
          : 0;

      let score = 0;

      if (acceleration >= 3) score += 40;
      else if (acceleration >= 2) score += 30;
      else if (acceleration >= 1.5) score += 20;
      else if (acceleration >= 1.2) score += 10;

      if (buyPressure >= 0.65) score += 35;
      else if (buyPressure >= 0.60) score += 30;
      else if (buyPressure >= 0.55) score += 20;
      else if (buyPressure >= 0.52) score += 10;

      if (change1h >= 10) score += 25;
      else if (change1h >= 5) score += 20;
      else if (change1h >= 2) score += 10;
      else if (change1h > 0) score += 5;

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

    async function getPoolPage(network, page) {
      const url =
        `${BASE}/networks/${network}/pools` +
        `?include=base_token,quote_token` +
        `&sort=h24_volume_usd_desc` +
        `&page=${page}`;

      try {
        const response = await fetch(url, { headers });

        if (!response.ok) {
          return {
            network,
            data: [],
            included: []
          };
        }

        const json = await response.json();

        return {
          network,
          data: Array.isArray(json?.data)
            ? json.data
            : [],
          included: Array.isArray(json?.included)
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

    async function getNewPools(network) {
      const url =
        `${BASE}/networks/${network}/new_pools` +
        `?include=base_token,quote_token` +
        `&page=1`;

      try {
        const response = await fetch(url, { headers });

        if (!response.ok) {
          return {
            network,
            data: [],
            included: []
          };
        }

        const json = await response.json();

        return {
          network,
          data: Array.isArray(json?.data)
            ? json.data
            : [],
          included: Array.isArray(json?.included)
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

    const requests = [];

    for (const network of networks) {
      requests.push(getPoolPage(network, 1));
      requests.push(getPoolPage(network, 2));
      requests.push(getNewPools(network));
    }

    const results = await Promise.all(requests);

    const markets = [];
    const seenPools = new Set();

    for (const result of results) {
      const network = result?.network || "";
      const pools = Array.isArray(result?.data)
        ? result.data
        : [];

      const included = Array.isArray(result?.included)
        ? result.included
        : [];

      for (const pool of pools) {
        if (!pool?.id) continue;

        const poolId = String(pool.id);

        if (seenPools.has(poolId)) continue;

        seenPools.add(poolId);

        const attributes = pool.attributes || {};

        const volume24h =
          Number(attributes.volume_usd?.h24 || 0);

        const volume1h =
          Number(attributes.volume_usd?.h1 || 0);

        const liquidity =
          Number(attributes.reserve_in_usd || 0);

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
        } = getTokenInfo(pool, included);

        if (!tokenA || !tokenB) {
          const fallback = fallbackTokenInfo(pool);

          tokenA = tokenA || fallback.tokenA;
          tokenB = tokenB || fallback.tokenB;
        }

        if (!tokenA || !tokenB) continue;

        if (hasStablecoin(tokenA, tokenB)) continue;

        const transactions =
          attributes.transactions?.h24 || {};

        const buys24h =
          Number(transactions.buys || 0);

        const sells24h =
          Number(transactions.sells || 0);

        const transactions24h =
          buys24h + sells24h;

        const change1h =
          Number(
            attributes.price_change_percentage?.h1 || 0
          );

        const change24h =
          Number(
            attributes.price_change_percentage?.h24 || 0
          );

        const marketCap =
          Number(attributes.market_cap_usd || 0);

        const fdv =
          Number(attributes.fdv_usd || 0);

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
          attributes.pool_created_at || null;

        const ageDays = createdAt
          ? Math.floor(
              (
                Date.now() -
                new Date(createdAt).getTime()
              ) / 86400000
            )
          : 0;

        const revival = calculateRevival({
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

          name: `${tokenA} / ${tokenB}`,

          tokenA,
          tokenB,

          tokenAAddress: tokenAAddress || "",
          tokenBAddress: tokenBAddress || "",

          tokenAddress: tokenAAddress || "",
          baseTokenAddress: tokenAAddress || "",

          price:
            Number(
              attributes.base_token_price_usd || 0
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

          revival: revival.revival,
          revivalScore: revival.score,
          revivalStatus: revival.status,

          buyPressure:
            Number(revival.buyPressure || 0),

          source: "GeckoTerminal"
        });
      }
    }

    markets.sort(
      (a, b) =>
        Number(b.volume24h || 0) -
        Number(a.volume24h || 0)
    );

    const finalMarkets =
      markets
        .slice(0, 500)
        .map((market, index) => ({
          rank: index + 1,
          ...market
        }));

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

    return res.status(500).json({
      error: "On-chain market data failed"
    });
  }
}
