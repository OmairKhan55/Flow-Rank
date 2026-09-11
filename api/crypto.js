export default async function handler(req, res) {
  const apiKey = process.env.CG_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "CG_API_KEY missing"
    });
  }

  const url =
    "https://api.coingecko.com/api/v3/coins/markets" +
    "?vs_currency=usd" +
    "&order=volume_desc" +
    "&per_page=100" +
    "&page=1" +
    "&sparkline=false" +
    "&price_change_percentage=24h";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "x-cg-demo-api-key": apiKey
      }
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Invalid response from CoinGecko"
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.status?.error_message ||
          data?.error ||
          "CoinGecko API request failed"
      });
    }

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    return res.status(200).json(data);

  } catch (error) {
    console.error("CoinGecko error:", error);

    return res.status(500).json({
      error: "CoinGecko request failed"
    });
  }
}
