import axios from "axios";
import { JUPITER_V6_API } from "./config";

interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
}

interface SwapInstructionParams {
  quoteResponse: any;
  userPublicKey: string;
  wrapUnwrapSOL?: boolean;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number
): Promise<any> {
  const response = await axios.get(`${JUPITER_V6_API}/quote`, {
    params: {
      inputMint,
      outputMint,
      amount,
      slippageBps,
    } as QuoteParams,
  });
  return response.data;
}

export async function getSwapInstructions(
  quoteResponse: any,
  userPublicKey: string
): Promise<any> {
  const response = await axios.post(`${JUPITER_V6_API}/swap-instructions`, {
    quoteResponse,
    userPublicKey,
    wrapUnwrapSOL: true,
  } as SwapInstructionParams);
  return response.data;
} 