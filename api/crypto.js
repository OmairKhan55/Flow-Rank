export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://data-api.binance.vision/api/v3/ticker/24hr"
    );

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Market data failed"
      });
    }

    const data = await response.json();

    const markets = data
      .filter(item => item.symbol.endsWith("USDT"))
      .map((item, index) => ({
        rank: index + 1,
        pair: item.symbol.replace("USDT", "/USDT"),
        exchange: "Binance",
        price: Number(item.lastPrice),
        volume24h: Number(item.quoteVolume),
        change24h: Number(item.priceChangePercent)
      }))
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 100)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }));

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    return res.status(200).json(markets);

  } catch (error) {
    console.error("Crypto market error:", error);

    return res.status(500).json({
      error: "Crypto market data failed"
    });
  }
}
