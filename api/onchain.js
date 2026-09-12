export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.llama.fi/v2/chains");
    const data = await response.json();

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "On-Chain data failed" });
  }
}
