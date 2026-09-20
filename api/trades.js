export default async function handler(req, res) {
  try {
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const pool = String(req.query?.pool || "").trim();

    if (!pool) {
      return res.status(400).json({ error: "Missing pool" });
    }

    const separator = pool.indexOf("_");

    if (separator === -1) {
      return res.status(400).json({ error: "Invalid pool" });
    }

    const network = pool.slice(0, separator).trim();
    const poolAddress = pool.slice(separator + 1).trim();

    if (!network || !poolAddress) {
      return res.status(400).json({ error: "Invalid pool" });
    }

    const BASE = "https://api.geckoterminal.com/api/v2";

    const url =
      `${BASE}/networks/${encodeURIComponent(network)}` +
      `/pools/${encodeURIComponent(poolAddress)}/trades`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json;version=20230203"
      }
    });

    if (!response.ok) {
      return res.status(200).json([]);
    }

    const json = await response.json();

    const trades = Array.isArray(json?.data) ? json.data : [];

    const result = trades.map((trade) => {
      const a = trade?.attributes || {};

      return {
        id: trade?.id || "",
        txHash: a.tx_hash || "",
        blockTimestamp: a.block_timestamp || "",
        kind: a.kind || "",
        priceUsd: Number(a.price_usd || 0),
        volumeUsd: Number(a.volume_usd || 0),
        fromTokenAmount: a.from_token_amount || "",
        toTokenAmount: a.to_token_amount || "",
        poolAddress,
        network
      };
    });

    res.setHeader(
      "Cache-Control",
      "s-maxage=30, stale-while-revalidate=120"
    );

    res.setHeader("Content-Type", "application/json");

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "FlowRank trades API error:",
      error?.message || error
    );

    return res.status(200).json([]);
  }
}
