import dotenv from "dotenv";

dotenv.config();

export const JUPITER_V6_API = "https://quote-api.jup.ag/v6";
export const JITO_RPC_URL = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL as string;
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY as string; 