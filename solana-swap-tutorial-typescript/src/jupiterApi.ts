import axios from 'axios';

const JUPITER_V6_API = 'https://quote-api.jup.ag/v6';

export async function getQuote(inputMint: string, outputMint: string, amount: number, slippageBps: number) {
  const response = await axios.get(`${JUPITER_V6_API}/quote`, {
    params: { inputMint, outputMint, amount, slippageBps },
    timeout: 10000,
  });
  return response.data;
}

export async function getSwapInstructions(quoteResponse: any, userPublicKey: string) {
  const response = await axios.post(
    `${JUPITER_V6_API}/swap-instructions`,
    { quoteResponse, userPublicKey, wrapUnwrapSOL: true },
    { timeout: 15000 }
  );
  return response.data;
}


