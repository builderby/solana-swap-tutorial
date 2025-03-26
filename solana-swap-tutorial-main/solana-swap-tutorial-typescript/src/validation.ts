import { PublicKey } from "@solana/web3.js";

export function validateMint(mint: string): void {
  if (typeof mint !== "string" || !/^[A-HJ-NP-Za-km-z1-9]{32,44}$/.test(mint)) {
    throw new Error(`Invalid mint address: ${mint}`);
  }
}

export function validateAmount(amount: number): void {
  if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
    throw new Error(
      `Invalid amount: ${amount}. Amount must be a positive number.`
    );
  }
}

export function validateSlippage(slippageBps: number): void {
  if (
    typeof slippageBps !== "number" ||
    isNaN(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10000
  ) {
    throw new Error(
      `Invalid slippage: ${slippageBps}. Slippage must be a number between 0 and 10000.`
    );
  }
}

export function validateRetries(maxRetries: number): void {
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    throw new Error(
      `Invalid max retries: ${maxRetries}. Max retries must be a positive integer.`
    );
  }
} 