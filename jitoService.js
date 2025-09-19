const axios = require("axios");
const { PublicKey, SystemProgram, Transaction, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const { JITO_RPC_URL, JITO_BUNDLE_URLS, JITO_TIP_MULTIPLIER, JITO_MIN_TIP_LAMPORTS, JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS, JITO_TIP_ESCALATION, JITO_MAX_TIP_LAMPORTS, JITO_TIP_BASE, SOLANA_RPC_URL } = require("./config");
// Tip floor REST endpoint
const TIP_FLOOR_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";

const { Connection } = require("@solana/web3.js");

const connection = new Connection(SOLANA_RPC_URL);

// Bundle endpoints: primary + optional fallbacks, with simple rotation
const BUNDLE_ENDPOINTS = (JITO_BUNDLE_URLS && JITO_BUNDLE_URLS.length > 0)
  ? JITO_BUNDLE_URLS
  : [JITO_RPC_URL];

// Base API endpoints (without trailing /bundles) for non-sendBundle methods
const API_BASE_ENDPOINTS = BUNDLE_ENDPOINTS.map((u) => u.replace(/\/?bundles$/, "")).map((u) => u.replace(/\/$/, ""));

const METHOD_TO_PATH = {
  getTipAccounts: "getTipAccounts",
  getInflightBundleStatuses: "getInflightBundleStatuses",
  getBundleStatuses: "getBundleStatuses",
};

function shuffledEndpoints() {
  if (BUNDLE_ENDPOINTS.length <= 1) return BUNDLE_ENDPOINTS;
  const copy = BUNDLE_ENDPOINTS.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt) {
  const base = 250; // ms
  const cap = 3000; // ms
  const exp = Math.min(cap, base * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 150);
  return exp + jitter;
}

async function postBundleRpc(method, params, options = {}) {
  const {
    attemptsPerEndpoint = 4,
    requestTimeoutMs = 6000,
  } = options;

  let endpoints;
  if (method === "sendBundle") {
    endpoints = shuffledEndpoints();
  } else {
    const path = METHOD_TO_PATH[method] || method;
    const bases = API_BASE_ENDPOINTS.length > 0 ? API_BASE_ENDPOINTS : BUNDLE_ENDPOINTS.map((u) => u.replace(/\/?bundles$/, ""));
    endpoints = bases.map((base) => `${base}/${path}`);
  }
  let lastError;

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < attemptsPerEndpoint; attempt++) {
      try {
        const response = await axios.post(
          endpoint,
          { jsonrpc: "2.0", id: 1, method, params },
          { headers: { "Content-Type": "application/json" }, timeout: requestTimeoutMs }
        );

        if (response.data && response.data.error) {
          const err = new Error(response.data.error.message || "Jito RPC error");
          err.code = response.data.error.code;
          throw err;
        }

        return response.data.result;
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const isRateLimited = status === 429;
        const isRetriable = isRateLimited || !status || (status >= 500);
        if (!isRetriable || attempt === attemptsPerEndpoint - 1) {
          break; // move to next endpoint
        }
        await sleep(backoffDelayMs(attempt));
      }
    }
  }

  throw lastError || new Error("Unknown error calling Jito bundle RPC");
}

// Tip accounts cache to reduce rate-limit pressure
let tipCache = { accounts: null, fetchedAt: 0 };
const TIP_TTL_MS = 60_000; // 1 minute

let tipFloorCache = { lamports: null, fetchedAt: 0 };
const TIP_FLOOR_TTL_MS = 15_000; // refresh frequently

async function fetchTipFloorLamports() {
  const now = Date.now();
  if (tipFloorCache.lamports !== null && now - tipFloorCache.fetchedAt < TIP_FLOOR_TTL_MS) {
    return tipFloorCache.lamports;
  }
  try {
    const resp = await axios.get(TIP_FLOOR_URL, { timeout: 4000 });
    if (!Array.isArray(resp.data) || resp.data.length === 0) {
      return JITO_MIN_TIP_LAMPORTS;
    }
    const entry = resp.data[resp.data.length - 1];
    // Choose baseline based on JITO_TIP_BASE
    let sol = 0;
    switch (JITO_TIP_BASE) {
      case 'p99': sol = entry.landed_tips_99th_percentile ?? 0; break;
      case 'p95': sol = entry.landed_tips_95th_percentile ?? 0; break;
      case 'p75': sol = entry.landed_tips_75th_percentile ?? 0; break;
      case 'p50': sol = entry.landed_tips_50th_percentile ?? 0; break;
      case 'ema50':
      default:
        sol = entry.ema_landed_tips_50th_percentile ?? entry.landed_tips_50th_percentile ?? 0;
        break;
    }
    const lamports = Math.max(JITO_MIN_TIP_LAMPORTS, Math.ceil(sol * 1e9));
    tipFloorCache = { lamports, fetchedAt: now };
    return lamports;
  } catch {
    return JITO_MIN_TIP_LAMPORTS;
  }
}

async function getTipAccounts() {
  try {
    const now = Date.now();
    if (tipCache.accounts && now - tipCache.fetchedAt < TIP_TTL_MS) {
      return tipCache.accounts;
    }

    const result = await postBundleRpc("getTipAccounts", []);
    tipCache = { accounts: result, fetchedAt: Date.now() };
    return result;
  } catch (error) {
    console.error("❌ Error getting tip accounts:", error.message);
    throw error;
  }
}

async function createJitoBundle(transaction, wallet, sharedBlockhash, attemptIndex = 0) {
  try {
    const tipAccounts = await getTipAccounts();
    if (!tipAccounts || tipAccounts.length === 0) {
      throw new Error("❌ Failed to get Jito tip accounts");
    }

    const tipAccountPubkey = new PublicKey(
      tipAccounts[Math.floor(Math.random() * tipAccounts.length)]
    );

    // Determine tip dynamically from tip floor with escalation
    const floor = await fetchTipFloorLamports();
    const esc = JITO_TIP_ESCALATION && JITO_TIP_ESCALATION.length > 0 ? JITO_TIP_ESCALATION[Math.min(attemptIndex, JITO_TIP_ESCALATION.length - 1)] : 1.0;
    const baseMult = JITO_TIP_MULTIPLIER || 1.2;
    const dynamicMult = baseMult * esc;
    const minFloor = attemptIndex === 0 ? Math.max(JITO_MIN_TIP_LAMPORTS, JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS) : JITO_MIN_TIP_LAMPORTS;
    let suggested = Math.max(minFloor, Math.ceil(floor * dynamicMult));
    if (Number.isFinite(JITO_MAX_TIP_LAMPORTS)) {
      suggested = Math.min(suggested, JITO_MAX_TIP_LAMPORTS);
    }
    console.log(`🏷️ Tip floor: ${floor} lamports, multiplier: ${dynamicMult.toFixed(2)}, chosen tip: ${suggested} lamports`);
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: tipAccountPubkey,
      lamports: suggested,
    });

    let blockhashToUse = sharedBlockhash;
    if (!blockhashToUse) {
    const latestBlockhash = await connection.getLatestBlockhash("finalized");
      blockhashToUse = latestBlockhash.blockhash;
    }

    const tipTransaction = new Transaction().add(tipInstruction);
    tipTransaction.recentBlockhash = blockhashToUse;
    tipTransaction.feePayer = wallet.publicKey;
    tipTransaction.sign(wallet);

    const signature = bs58.encode(transaction.signatures[0]);

    console.log("🔄 Encoding transactions...");
    // Order: [tip, main] for higher acceptance with current block engine behavior
    const bundle = [tipTransaction, transaction].map((tx, index) => {
      console.log(`📦 Encoding transaction ${index + 1}`);
      if (tx instanceof VersionedTransaction) {
        console.log(`🔢 Transaction ${index + 1} is VersionedTransaction`);
        return Buffer.from(tx.serialize()).toString("base64");
      } else {
        console.log(`📜 Transaction ${index + 1} is regular Transaction`);
        const bytes = tx.serialize({ verifySignatures: false });
        return Buffer.from(bytes).toString("base64");
      }
    });

    console.log("✅ Bundle created successfully");
    return { bundle, tipLamports: suggested };
  } catch (error) {
    console.error("❌ Error in createJitoBundle:", error);
    console.error("🔍 Error stack:", error.stack);
    throw error;
  }
}

async function sendJitoBundle(bundle) {
  try {
    const result = await postBundleRpc("sendBundle", [bundle, { encoding: "base64" }]);
    return result;
  } catch (error) {
    console.error("❌ Error sending Jito bundle:", error.message);
    throw error;
  }
}

async function checkBundleStatus(bundleId, mainTxSignature) {
  try {
    // First try inflight (5 minute lookback)
    const resp = await postBundleRpc("getInflightBundleStatuses", [[bundleId]], { attemptsPerEndpoint: 4, requestTimeoutMs: 4000 });
    const inflight = resp?.value?.[0];
    if (inflight && (inflight.status === "Landed" || inflight.status === "Failed")) {
      return {
        bundleId: inflight.bundle_id,
        status: inflight.status,
        landedSlot: inflight.landed_slot,
      };
    }

    // Fallback to historical bundle statuses which returns transaction signatures
    const resp2 = await postBundleRpc("getBundleStatuses", [[bundleId]], { attemptsPerEndpoint: 4, requestTimeoutMs: 4000 });
    const hist = resp2?.value?.[0];
    if (hist && hist.confirmation_status) {
      return {
        bundleId: hist.bundle_id,
        status: hist.confirmation_status === "finalized" || hist.confirmation_status === "confirmed" ? "Landed" : "Pending",
        landedSlot: hist.slot,
        transactions: hist.transactions || [],
      };
    }

    // Final fallback: check the main tx signature via Solana RPC (not rate-limited by Jito)
    if (mainTxSignature) {
      const statuses = await connection.getSignatureStatuses([mainTxSignature], { searchTransactionHistory: true });
      const s = statuses && statuses.value && statuses.value[0];
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        return { bundleId, status: "Landed", landedSlot: s.slot, transactions: [mainTxSignature] };
      }
    }

    // If inflight existed but wasn't final, return it so caller can decide; else null
    if (inflight) {
      return {
        bundleId: inflight.bundle_id,
        status: inflight.status,
        landedSlot: inflight.landed_slot,
      };
    }

    console.log(`ℹ️ No status found for bundle ID: ${bundleId}`);
    return null;
  } catch (error) {
    console.error("❌ Error checking bundle status:", error.message);
    return null;
  }
}

async function confirmBundle(bundleId, mainTxSignature, timeoutMs = 120000, pollMs = 2000, maxPolls = 3) {
  const start = Date.now();
  let lastStatus = null;
  let attempt = 0;
  let pollCount = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    pollCount++;
    const status = await checkBundleStatus(bundleId, mainTxSignature);
    if (status) {
      console.log(`🧭 Bundle poll #${attempt}: status=${status.status}${status.landedSlot ? ` slot=${status.landedSlot}` : ""}`);
    } else {
      console.log(`🧭 Bundle poll #${attempt}: status=unknown`);
    }
    if (status && (status.status === "Landed" || status.status === "Failed")) {
      return status;
    }
    // Cap number of polls per attempt to allow quick retry/reprice
    if (pollCount >= maxPolls && status && (status.status === "Pending" || status.status === "Invalid")) {
      return status;
    }
    lastStatus = status;
    await sleep(pollMs);
    // gentle backoff to avoid 429s
    if (pollMs < 5000) {
      pollMs = Math.min(5000, Math.floor(pollMs * 1.25));
    }
  }
  return lastStatus || { bundleId, status: "Timeout", landedSlot: null };
}

module.exports = {
  createJitoBundle,
  sendJitoBundle,
  checkBundleStatus,
  confirmBundle,
};