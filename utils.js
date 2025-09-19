const { Connection, PublicKey } = require("@solana/web3.js");
const axios = require("axios");
const {
  SOLANA_RPC_URL,
  PRIORITY_FEE_PROVIDER_URL,
  PRIORITY_FEE_PROVIDER_METHOD,
  PRIORITY_FEE_ACCOUNT_KEYS,
  PRIORITY_FEE_PERCENTILE,
  PRIORITY_FEE_MIN_MICROLAMPORTS,
  PRIORITY_FEE_MAX_MICROLAMPORTS,
} = require("./config");

const connection = new Connection(SOLANA_RPC_URL);

async function getTokenInfo(mint) {
  const mintAccount = new PublicKey(mint);
  const mintInfo = await connection.getParsedAccountInfo(mintAccount);

  if (!mintInfo.value || !mintInfo.value.data || !mintInfo.value.data.parsed) {
    throw new Error(`❌ Failed to fetch token info for mint: ${mint}`);
  }

  const { decimals } = mintInfo.value.data.parsed.info;
  return { decimals };
}

async function getAveragePriorityFee() {
  const priorityFees = await connection.getRecentPrioritizationFees();
  if (priorityFees.length === 0) {
    return { microLamports: 0, solAmount: 0 }; // No data
  }

  const recentFees = priorityFees.slice(-150); // Get fees from last 150 slots
  const averageFee =
    recentFees.reduce((sum, fee) => sum + fee.prioritizationFee, 0) /
    recentFees.length;
  const microLamports = Math.ceil(averageFee);
  const solAmount = microLamports / 1e15; // micro-lamports -> lamports (/1e6) -> SOL (/1e9)
  return { microLamports, solAmount };
}

function pickPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((percentile / 100) * (sorted.length - 1)))
  );
  return sorted[idx];
}

async function getPercentilePriorityFee() {
  const priorityFees = await connection.getRecentPrioritizationFees();
  if (!priorityFees || priorityFees.length === 0) {
    const floor = PRIORITY_FEE_MIN_MICROLAMPORTS;
    return { microLamports: floor, solAmount: floor / 1e15 };
  }
  const recentFees = priorityFees
    .slice(-150)
    .map((f) => f.prioritizationFee)
    .filter((v) => Number.isFinite(v) && v >= 0);
  if (recentFees.length === 0) {
    const floor = PRIORITY_FEE_MIN_MICROLAMPORTS;
    return { microLamports: floor, solAmount: floor / 1e15 };
  }
  let picked = Math.ceil(pickPercentile(recentFees, PRIORITY_FEE_PERCENTILE));
  if (Number.isFinite(PRIORITY_FEE_MIN_MICROLAMPORTS)) {
    picked = Math.max(picked, PRIORITY_FEE_MIN_MICROLAMPORTS);
  }
  if (Number.isFinite(PRIORITY_FEE_MAX_MICROLAMPORTS)) {
    picked = Math.min(picked, PRIORITY_FEE_MAX_MICROLAMPORTS);
  }
  return { microLamports: picked, solAmount: picked / 1e15 };
}

async function getProviderEstimatedPriorityFee(
  percentileOverride,
  accountKeysOverride
) {
  if (!PRIORITY_FEE_PROVIDER_URL) return null;
  try {
    const effectivePercentile = Number.isFinite(percentileOverride)
      ? percentileOverride
      : PRIORITY_FEE_PERCENTILE;
    const effectiveAccountKeys =
      Array.isArray(accountKeysOverride) && accountKeysOverride.length
        ? accountKeysOverride
        : PRIORITY_FEE_ACCOUNT_KEYS.length
        ? PRIORITY_FEE_ACCOUNT_KEYS
        : undefined;
    const params = [
      { percentile: effectivePercentile, accountKeys: effectiveAccountKeys },
    ];
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: PRIORITY_FEE_PROVIDER_METHOD,
      params,
    };
    const resp = await axios.post(PRIORITY_FEE_PROVIDER_URL, body, {
      timeout: 2500,
      headers: { "Content-Type": "application/json" },
    });
    const result = resp.data?.result;
    if (!result) return null;
    // Normalize common provider shapes
    let microLamports = null;
    if (typeof result === "number") microLamports = Math.ceil(result);
    else if (result?.microLamports)
      microLamports = Math.ceil(result.microLamports);
    else if (result?.priorityFeeEstimate)
      microLamports = Math.ceil(result.priorityFeeEstimate);
    if (!Number.isFinite(microLamports)) return null;
    microLamports = Math.max(microLamports, PRIORITY_FEE_MIN_MICROLAMPORTS);
    microLamports = Math.min(microLamports, PRIORITY_FEE_MAX_MICROLAMPORTS);
    return { microLamports, solAmount: microLamports / 1e15 };
  } catch {
    return null;
  }
}

module.exports = {
  getTokenInfo,
  getAveragePriorityFee,
  getPercentilePriorityFee,
  getProviderEstimatedPriorityFee,
};
