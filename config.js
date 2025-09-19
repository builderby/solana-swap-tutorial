require("dotenv").config();

module.exports = {
  JUPITER_V6_API: "https://quote-api.jup.ag/v6",
  // Primary Jito bundle URL (env overrides default global endpoint)
  JITO_RPC_URL:
    process.env.JITO_BUNDLE_URL ||
    "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  // Optional list of regional fallback endpoints for rotation
  JITO_BUNDLE_URLS: [
    process.env.JITO_BUNDLE_URL,
    process.env.JITO_BUNDLE_URL_FALLBACK_1,
    process.env.JITO_BUNDLE_URL_FALLBACK_2,
  ].filter(Boolean),
  // Tip tuning (for bundles only the Jito tip matters)
  JITO_TIP_MULTIPLIER: parseFloat(process.env.JITO_TIP_MULTIPLIER || "1.2"),
  JITO_MIN_TIP_LAMPORTS: parseInt(
    process.env.JITO_MIN_TIP_LAMPORTS || "1000",
    10
  ),
  // Optional higher floor just for the first attempt (falls back to JITO_MIN_TIP_LAMPORTS)
  JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS: parseInt(
    process.env.JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS ||
      process.env.JITO_MIN_TIP_LAMPORTS ||
      "1000",
    10
  ),
  // Baseline to use from tip_floor: ema50|p50|p75|p95|p99 (default ema50)
  JITO_TIP_BASE: (process.env.JITO_TIP_BASE || "ema50").toLowerCase(),
  // Tip escalation across retries (e.g., 1.0,1.2,1.5,2.0)
  JITO_TIP_ESCALATION: (process.env.JITO_TIP_ESCALATION || "1.0,1.2,1.5,2.0")
    .split(",")
    .map((v) => parseFloat(v.trim()))
    .filter((v) => !Number.isNaN(v)),
  // Absolute cap to prevent runaway tips
  JITO_MAX_TIP_LAMPORTS: parseInt(
    process.env.JITO_MAX_TIP_LAMPORTS || "2000000",
    10
  ),
  // Priority fee floor for sendTransaction fallback (micro-lamports)
  PRIORITY_FEE_FLOOR_MICROLAMPORTS: parseInt(
    process.env.PRIORITY_FEE_FLOOR_MICROLAMPORTS || "10000",
    10
  ),
  // Optional provider-based priority fee estimator (e.g., Helius/QuickNode)
  PRIORITY_FEE_PROVIDER_URL: process.env.PRIORITY_FEE_PROVIDER_URL,
  PRIORITY_FEE_PROVIDER_METHOD:
    process.env.PRIORITY_FEE_PROVIDER_METHOD || "getPriorityFeeEstimate",
  PRIORITY_FEE_ACCOUNT_KEYS: (process.env.PRIORITY_FEE_ACCOUNT_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Percentile-based priority fee selection and caps
  PRIORITY_FEE_PERCENTILE: parseInt(
    process.env.PRIORITY_FEE_PERCENTILE || "75",
    10
  ),
  PRIORITY_FEE_MIN_MICROLAMPORTS: parseInt(
    process.env.PRIORITY_FEE_MIN_MICROLAMPORTS || "10000",
    10
  ),
  PRIORITY_FEE_MAX_MICROLAMPORTS: parseInt(
    process.env.PRIORITY_FEE_MAX_MICROLAMPORTS || "1000000",
    10
  ),
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY,
};
