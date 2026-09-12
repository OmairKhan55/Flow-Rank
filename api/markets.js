export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://api.binance.com/api/v3/ticker/24hr"
    );

    if (!response.ok) {
      throw new Error("Binance API failed");
    }

    const data = await response.json();

    const markets = data
      .filter(item => item.symbol.endsWith("USDT"))
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, 100)
      .map((item, index) => ({
        rank: index + 1,
        pair: item.symbol,
        price: Number(item.lastPrice),
        volume24h: Number(item.quoteVolume),
        change24h: Number(item.priceChangePercent)
      }));

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    return res.status(200).json(markets);

  } catch (error) {
    return res.status(500).json({
      error: "Market data failed"
    });
  }
}
