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

    function clean(value) {
      return String(value || "")
        .replace(/\$/g, "")
        .trim()
        .toUpperCase();
    }

    function stable(a, b) {
      return (
        stablecoins.has(a) ||
        stablecoins.has(b)
      );
    }

    function tokenInfo(pool, included) {
      const baseId =
        pool?.relationships?.base_token?.data?.id || "";

      const quoteId =
        pool?.relationships?.quote_token?.data?.id || "";

      const base = included.find(
        x => String(x?.id || "") === String(baseId)
      );

      const quote = included.find(
        x => String(x?.id || "") === String(quoteId)
      );

      return {
        a: clean(base?.attributes?.symbol),
        b: clean(quote?.attributes?.symbol)
      };
    }

    function candleCheck(candles) {
      if (!Array.isArray(candles) || candles.length < 12) {
        return {
          dip: false,
          base: false,
          recovery: false,
          bullish: false,
          volume: false
        };
      }

      const old = candles.slice(0, -6);
      const recent = candles.slice(-6);

      const oldHigh = Math.max(
        ...old.map(x => x.high)
      );

      const recentLow = Math.min(
        ...recent.map(x => x.low)
      );

      const recentHigh = Math.max(
        ...recent.map(x => x.high)
      );

      const last =
        candles[candles.length - 1];

      const previous =
        candles[candles.length - 2];

      const dip =
        oldHigh > 0 &&
        ((oldHigh - recentLow) / oldHigh) * 100 >= 8;

      const base =
        recentLow > 0 &&
        ((recentHigh - recentLow) / recentLow) * 100 <= 30;

      const recovery =
        recentLow > 0 &&
        ((last.close - recentLow) / recentLow) * 100 >= 3;

      const bullish =
        last.close > last.open &&
        last.close > previous.close;

      const before =
        recent.slice(0, -1);

      const avgVolume =
        before.length
          ? before.reduce(
              (sum, x) =>
                sum + Number(x.volume || 0),
              0
            ) / before.length
          : 0;

      const volume =
        avgVolume > 0 &&
        last.volume >= avgVolume * 1.2;

      return {
        dip,
        base,
        recovery,
        bullish,
        volume
      };
    }

    async function getCandles(network, poolId) {
      try {
        const prefix = `${network}_`;

        if (!String(poolId).startsWith(prefix)) {
          return [];
        }

        const address =
          String(poolId).slice(prefix.length);

        const url =
          `${BASE}/networks/${network}/pools/${address}/ohlcv/hour` +
          `?aggregate=1&limit=24`;

        const response =
          await fetch(url, { headers });

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
          .map(x => ({
            time: Number(x?.[0] || 0),
            open: Number(x?.[1] || 0),
            high: Number(x?.[2] || 0),
            low: Number(x?.[3] || 0),
            close: Number(x?.[4] || 0),
            volume: Number(x?.[5] || 0)
          }))
          .filter(
            x =>
              x.open > 0 &&
              x.high > 0 &&
              x.low > 0 &&
              x.close > 0
          )
          .sort(
            (a, b) => a.time - b.time
          );

      } catch {
        return [];
      }
    }

    async function getPools(network) {
      try {
        const url =
          `${BASE}/networks/${network}/pools` +
          `?include=base_token,quote_token` +
          `&sort=h24_volume_usd_desc` +
          `&page=1`;

        const response =
          await fetch(url, { headers });

        if (!response.ok) {
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

      } catch {
        return {
          data: [],
          included: []
        };
      }
    }

    const candidates = [];

    for (const network of networks) {
      const result =
        await getPools(network);

      const pools =
        result.data || [];

      const included =
        result.included || [];

      for (const pool of pools.slice(0, 15)) {
        const attributes =
          pool?.attributes || {};

        const createdAt =
          attributes.pool_created_at || null;

        if (!createdAt) continue;

        const createdTime =
          new Date(createdAt).getTime();

        if (!Number.isFinite(createdTime)) {
          continue;
        }

        const ageDays =
          Math.floor(
            (Date.now() - createdTime) /
            86400000
          );

        if (ageDays < 30) {
          continue;
        }

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

        const tokens =
          tokenInfo(pool, included);

        if (
          !tokens.a ||
          !tokens.b ||
          stable(tokens.a, tokens.b)
        ) {
          continue;
        }

        const tx =
          attributes.transactions?.h24 || {};

        const buys =
          Number(tx.buys || 0);

        const sells =
          Number(tx.sells || 0);

        const change1h =
          Number(
            attributes
              .price_change_percentage
              ?.h1 || 0
          );

        const total =
          buys + sells;

        const buyPressure =
          total > 0
            ? buys / total
            : 0;

        const hourlyAverage =
          volume24h / 24;

        const acceleration =
          hourlyAverage > 0
            ? volume1h / hourlyAverage
            : 0;

        /*
          Only investigate markets where
          buying activity is already returning.
        */

        if (
          acceleration < 1.1 ||
          buyPressure < 0.50 ||
          change1h <= 0
        ) {
          continue;
        }

        candidates.push({
          network,
          pool: String(pool.id),
          name:
            `${tokens.a} / ${tokens.b}`,
          price:
            Number(
              attributes
                .base_token_price_usd || 0
            ),
          volume1h,
          volume24h,
          buys24h: buys,
          sells24h: sells,
          change1h,
          buyPressure,
          ageDays
        });
      }
    }

    candidates.sort(
      (a, b) =>
        Number(b.volume24h || 0) -
        Number(a.volume24h || 0)
    );

    /*
      Only a small number of candidates are
      checked against historical candles.
    */

    const selected =
      candidates.slice(0, 20);

    const results = [];

    for (const market of selected) {
      const candles =
        await getCandles(
          market.network,
          market.pool
        );

      const signal =
        candleCheck(candles);

      let status = "Normal";

      if (
        signal.dip &&
        signal.base &&
        signal.recovery &&
        signal.bullish &&
        signal.volume
      ) {
        status = "Buying Started";
      } else if (
        signal.dip &&
        signal.base &&
        signal.recovery
      ) {
        status = "Reviving";
      }

      if (status !== "Normal") {
        results.push({
          ...market,

          revival: true,

          revivalStatus: status,

          historicalDip:
            signal.dip,

          historicalBase:
            signal.base,

          historicalRecovery:
            signal.recovery,

          historicalBullish:
            signal.bullish,

          historicalVolume:
            signal.volume
        });
      }
    }

    results.sort(
      (a, b) => {
        const aScore =
          (a.revivalStatus === "Buying Started" ? 2 : 1) +
          Number(a.buyPressure || 0);

        const bScore =
          (b.revivalStatus === "Buying Started" ? 2 : 1) +
          Number(b.buyPressure || 0);

        return bScore - aScore;
      }
    );

    res.setHeader(
      "Cache-Control
