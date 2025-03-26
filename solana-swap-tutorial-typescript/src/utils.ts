import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_RPC_URL } from "./config";

const connection = new Connection(SOLANA_RPC_URL);

interface TokenInfo {
  decimals: number;
}

interface PriorityFee {
  microLamports: number;
  solAmount: number;
}

export async function getTokenInfo(mint: string): Promise<TokenInfo> {
  const mintAccount = new PublicKey(mint);
  const mintInfo = await connection.getParsedAccountInfo(mintAccount);

  if (!mintInfo.value || !mintInfo.value.data || !(mintInfo.value.data as any).parsed) {
    throw new Error(`❌ Failed to fetch token info for mint: ${mint}`);
  }

  const { decimals } = (mintInfo.value.data as any).parsed.info;
  return { decimals };
}

export async function getAveragePriorityFee(): Promise<PriorityFee> {
  const priorityFees = await connection.getRecentPrioritizationFees();
  if (priorityFees.length === 0) {
    return { microLamports: 10000, solAmount: 0.00001 }; // Default to 10000 micro-lamports if no data
  }

  const recentFees = priorityFees.slice(-150); // Get fees from last 150 slots
  const averageFee =
    recentFees.reduce((sum, fee) => sum + fee.prioritizationFee, 0) /
    recentFees.length;
  const microLamports = Math.ceil(averageFee);
  const solAmount = microLamports / 1e6 / 1e3; // Convert micro-lamports to SOL
  return { microLamports, solAmount };
} 