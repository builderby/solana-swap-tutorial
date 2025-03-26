require("dotenv").config();

module.exports = {
  JUPITER_V6_API: "https://quote-api.jup.ag/v6",
  JITO_RPC_URL: "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY,
};
