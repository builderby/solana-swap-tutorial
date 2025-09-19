import "dotenv/config";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
  Transaction,
  SystemProgram,
  Commitment,
} from "@solana/web3.js";
import axios from "axios";
import bs58 from "bs58";
import { getQuote, getSwapInstructions } from "./jupiterApi";
import { deserializeInstruction, createVersionedTransaction } from "./txUtils";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL as string;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY as string;
const JITO_BUNDLE_URL =
  process.env.JITO_BUNDLE_URL ||
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const JITO_BUNDLE_URL_FALLBACK_1 = process.env.JITO_BUNDLE_URL_FALLBACK_1;
const JITO_BUNDLE_URL_FALLBACK_2 = process.env.JITO_BUNDLE_URL_FALLBACK_2;
const JITO_TIP_MULTIPLIER = parseFloat(
  process.env.JITO_TIP_MULTIPLIER || "1.2"
);
const JITO_MIN_TIP_LAMPORTS = parseInt(
  process.env.JITO_MIN_TIP_LAMPORTS || "1000",
  10
);
const JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS = parseInt(
  process.env.JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS ||
    process.env.JITO_MIN_TIP_LAMPORTS ||
    "1000",
  10
);
const JITO_TIP_ESCALATION = (
  process.env.JITO_TIP_ESCALATION || "1.0,1.2,1.5,2.0"
)
  .split(",")
  .map((v) => parseFloat(v.trim()))
  .filter((v) => !Number.isNaN(v));
const JITO_MAX_TIP_LAMPORTS = parseInt(
  process.env.JITO_MAX_TIP_LAMPORTS || "2000000",
  10
);
const JITO_TIP_BASE = (process.env.JITO_TIP_BASE || "ema50").toLowerCase();
const PRIORITY_FEE_FLOOR_MICROLAMPORTS = parseInt(
  process.env.PRIORITY_FEE_FLOOR_MICROLAMPORTS || "10000",
  10
);
const PRIORITY_FEE_PERCENTILE = parseInt(
  process.env.PRIORITY_FEE_PERCENTILE || "75",
  10
);
const PRIORITY_FEE_MIN_MICROLAMPORTS = parseInt(
  process.env.PRIORITY_FEE_MIN_MICROLAMPORTS || "10000",
  10
);
const PRIORITY_FEE_MAX_MICROLAMPORTS = parseInt(
  process.env.PRIORITY_FEE_MAX_MICROLAMPORTS || "1000000",
  10
);
const PRIORITY_FEE_PROVIDER_URL = process.env.PRIORITY_FEE_PROVIDER_URL;
const PRIORITY_FEE_PROVIDER_METHOD =
  process.env.PRIORITY_FEE_PROVIDER_METHOD || "getPriorityFeeEstimate";
const PRIORITY_FEE_ACCOUNT_KEYS = (process.env.PRIORITY_FEE_ACCOUNT_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => !!s);

const connection = new Connection(SOLANA_RPC_URL);
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(WALLET_PRIVATE_KEY))
);

const BUNDLE_ENDPOINTS: string[] = [
  JITO_BUNDLE_URL,
  JITO_BUNDLE_URL_FALLBACK_1,
  JITO_BUNDLE_URL_FALLBACK_2,
].filter(Boolean) as string[];
const API_BASES = BUNDLE_ENDPOINTS.map((u) => u.replace(/\/?bundles$/, "")).map(
  (u) => u.replace(/\/$/, "")
);

function shuffled<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function postBundleRpc(
  method: string,
  params: any[],
  attemptsPerEndpoint = 4,
  timeoutMs = 6000
): Promise<any> {
  const METHOD_TO_PATH: Record<string, string> = {
    getTipAccounts: "getTipAccounts",
    getInflightBundleStatuses: "getInflightBundleStatuses",
    getBundleStatuses: "getBundleStatuses",
  };
  const endpoints =
    method === "sendBundle"
      ? shuffled(BUNDLE_ENDPOINTS)
      : (API_BASES.length
          ? API_BASES
          : BUNDLE_ENDPOINTS.map((u) => u.replace(/\/?bundles$/, ""))
        ).map((b) => `${b}/${METHOD_TO_PATH[method] || method}`);

  let lastError: any;
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < attemptsPerEndpoint; attempt++) {
      try {
        const response = await axios.post(
          endpoint,
          { jsonrpc: "2.0", id: 1, method, params },
          { timeout: timeoutMs }
        );
        if (response.data?.error) {
          const err = new Error(
            response.data.error.message || "Jito RPC error"
          );
          (err as any).code = response.data.error.code;
          throw err;
        }
        return response.data.result;
      } catch (e: any) {
        lastError = e;
        const status = e.response?.status;
        const retriable = status === 429 || !status || status >= 500;
        if (!retriable || attempt === attemptsPerEndpoint - 1) break;
        await new Promise((r) =>
          setTimeout(
            r,
            Math.min(3000, 250 * 2 ** attempt) + Math.floor(Math.random() * 150)
          )
        );
      }
    }
  }
  throw lastError || new Error("Unknown Jito RPC error");
}

async function getTokenDecimals(mint: string): Promise<number> {
  const info = await connection.getParsedAccountInfo(new PublicKey(mint));
  const decimals = (info.value as any)?.data?.parsed?.info?.decimals;
  if (typeof decimals !== "number")
    throw new Error(`Failed to fetch token info for mint: ${mint}`);
  return decimals;
}

async function getAddressLookupTableAccounts(
  connection: Connection,
  keys: string[]
): Promise<AddressLookupTableAccount[]> {
  if (!keys || keys.length === 0) return [] as AddressLookupTableAccount[];
  const pubkeys = keys.map((k) => new PublicKey(k));
  const infos = await connection.getMultipleAccountsInfo(pubkeys, {
    commitment: "processed" as Commitment,
  });
  const result: AddressLookupTableAccount[] = [];
  for (let i = 0; i < pubkeys.length; i++) {
    const info = infos[i];
    if (info && info.data) {
      try {
        const state = AddressLookupTableAccount.deserialize(info.data);
        result.push(new AddressLookupTableAccount({ key: pubkeys[i], state }));
      } catch {}
    }
  }
  return result;
}

async function getAveragePriorityFee() {
  const priorityFees = await connection.getRecentPrioritizationFees();
  if (priorityFees.length === 0) {
    return {
      microLamports: PRIORITY_FEE_FLOOR_MICROLAMPORTS,
      solAmount: PRIORITY_FEE_FLOOR_MICROLAMPORTS / 1e15,
    };
  }
  const recent = priorityFees.slice(-150);
  const avg = Math.ceil(
    recent.reduce((s, f) => s + f.prioritizationFee, 0) / recent.length
  );
  const microLamports = avg || PRIORITY_FEE_FLOOR_MICROLAMPORTS;
  return { microLamports, solAmount: microLamports / 1e15 };
}

async function getProviderEstimatedPriorityFee(
  percentileOverride?: number,
  accountKeysOverride?: string[]
) {
  if (!PRIORITY_FEE_PROVIDER_URL) return null;
  try {
    const effectivePercentile = Number.isFinite(percentileOverride as number)
      ? (percentileOverride as number)
      : PRIORITY_FEE_PERCENTILE;
    const effectiveAccountKeys =
      Array.isArray(accountKeysOverride) && accountKeysOverride.length
        ? accountKeysOverride
        : PRIORITY_FEE_ACCOUNT_KEYS.length
        ? PRIORITY_FEE_ACCOUNT_KEYS
        : undefined;
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: PRIORITY_FEE_PROVIDER_METHOD,
      params: [
        { percentile: effectivePercentile, accountKeys: effectiveAccountKeys },
      ],
    };
    const resp = await axios.post(PRIORITY_FEE_PROVIDER_URL, body, {
      timeout: 2500,
      headers: { "Content-Type": "application/json" },
    });
    const result = resp.data?.result;
    if (!result) return null;
    let microLamports: number | null = null;
    if (typeof result === "number") microLamports = Math.ceil(result);
    else if ((result as any)?.microLamports)
      microLamports = Math.ceil((result as any).microLamports);
    else if ((result as any)?.priorityFeeEstimate)
      microLamports = Math.ceil((result as any).priorityFeeEstimate);
    if (!Number.isFinite(microLamports as number)) return null;
    microLamports = Math.max(
      microLamports as number,
      PRIORITY_FEE_MIN_MICROLAMPORTS
    );
    microLamports = Math.min(
      microLamports as number,
      PRIORITY_FEE_MAX_MICROLAMPORTS
    );
    return {
      microLamports: microLamports as number,
      solAmount: (microLamports as number) / 1e15,
    };
  } catch {
    return null;
  }
}

function percentilePick(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * (sorted.length - 1)))
  );
  return sorted[idx];
}

async function getPercentilePriorityFee() {
  const fees = await connection.getRecentPrioritizationFees();
  if (!fees || fees.length === 0) {
    const floor = PRIORITY_FEE_MIN_MICROLAMPORTS;
    return { microLamports: floor, solAmount: floor / 1e15 };
  }
  const recent = fees
    .slice(-150)
    .map((f) => f.prioritizationFee)
    .filter((v) => Number.isFinite(v) && v >= 0);
  if (!recent.length) {
    const floor = PRIORITY_FEE_MIN_MICROLAMPORTS;
    return { microLamports: floor, solAmount: floor / 1e15 };
  }
  let picked = Math.ceil(percentilePick(recent, PRIORITY_FEE_PERCENTILE));
  picked = Math.max(picked, PRIORITY_FEE_MIN_MICROLAMPORTS);
  picked = Math.min(picked, PRIORITY_FEE_MAX_MICROLAMPORTS);
  return { microLamports: picked, solAmount: picked / 1e15 };
}

async function getTipAccounts(): Promise<string[]> {
  return await postBundleRpc("getTipAccounts", []);
}

async function fetchTipFloorLamports(): Promise<number> {
  try {
    const resp = await axios.get(
      "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
      { timeout: 4000 }
    );
    if (!Array.isArray(resp.data) || resp.data.length === 0)
      return JITO_MIN_TIP_LAMPORTS;
    const entry = resp.data[resp.data.length - 1];
    let baselineSol = 0;
    switch (JITO_TIP_BASE) {
      case "p99":
        baselineSol = entry.landed_tips_99th_percentile ?? 0;
        break;
      case "p95":
        baselineSol = entry.landed_tips_95th_percentile ?? 0;
        break;
      case "p75":
        baselineSol = entry.landed_tips_75th_percentile ?? 0;
        break;
      case "p50":
        baselineSol = entry.landed_tips_50th_percentile ?? 0;
        break;
      case "ema50":
      default:
        baselineSol =
          entry.ema_landed_tips_50th_percentile ??
          entry.landed_tips_50th_percentile ??
          0;
        break;
    }
    return Math.max(JITO_MIN_TIP_LAMPORTS, Math.ceil(baselineSol * 1e9));
  } catch {
    return JITO_MIN_TIP_LAMPORTS;
  }
}

async function createBundle(
  mainTx: VersionedTransaction,
  payer: Keypair,
  sharedBlockhash?: string,
  attemptIndex = 0
): Promise<{ bundle: string[]; tipLamports: number }> {
  const tips = await getTipAccounts();
  const tipAccount = new PublicKey(
    tips[Math.floor(Math.random() * tips.length)]
  );
  let blockhash = sharedBlockhash;
  if (!blockhash) {
    blockhash = (await connection.getLatestBlockhash("finalized" as Commitment))
      .blockhash;
  }
  const floor = await fetchTipFloorLamports();
  const esc =
    JITO_TIP_ESCALATION && JITO_TIP_ESCALATION.length > 0
      ? JITO_TIP_ESCALATION[
          Math.min(attemptIndex, JITO_TIP_ESCALATION.length - 1)
        ]
      : 1.0;
  const dynamicMult = (JITO_TIP_MULTIPLIER || 1.2) * esc;
  const minFloor =
    attemptIndex === 0
      ? Math.max(JITO_MIN_TIP_LAMPORTS, JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS)
      : JITO_MIN_TIP_LAMPORTS;
  let lamports = Math.max(minFloor, Math.ceil(floor * dynamicMult));
  if (Number.isFinite(JITO_MAX_TIP_LAMPORTS))
    lamports = Math.min(lamports, JITO_MAX_TIP_LAMPORTS);
  console.log(
    `🏷️ Tip floor: ${floor} lamports, multiplier: ${dynamicMult.toFixed(
      2
    )}, chosen tip: ${lamports} lamports`
  );

  const tipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports,
    })
  );
  tipTx.recentBlockhash = blockhash;
  tipTx.feePayer = payer.publicKey;
  tipTx.sign(payer);

  console.log("🔄 Encoding transactions...");
  // Order: [tip, main]
  const bundleBase64 = [tipTx, mainTx].map((tx, i) => {
    console.log(`📦 Encoding transaction ${i + 1}`);
    if (tx instanceof VersionedTransaction) {
      console.log(`🔢 Transaction ${i + 1} is VersionedTransaction`);
      return Buffer.from(tx.serialize()).toString("base64");
    }
    console.log(`📜 Transaction ${i + 1} is regular Transaction`);
    return Buffer.from(
      (tx as Transaction).serialize({ verifySignatures: false })
    ).toString("base64");
  });
  return { bundle: bundleBase64, tipLamports: lamports };
}

async function sendBundle(bundleBase64: string[]): Promise<string> {
  return await postBundleRpc("sendBundle", [
    bundleBase64,
    { encoding: "base64" },
  ]);
}

async function getInflight(bundleId: string) {
  return await postBundleRpc("getInflightBundleStatuses", [[bundleId]]);
}

async function getBundleStatuses(bundleId: string) {
  return await postBundleRpc("getBundleStatuses", [[bundleId]]);
}

async function confirmBundle(
  bundleId: string,
  mainSig: string,
  timeoutMs = 60000,
  pollMs = 2000,
  maxPolls = 3
) {
  const start = Date.now();
  let attempt = 0;
  let last: any = null;
  let pollCount = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    pollCount++;
    const inflight = await getInflight(bundleId);
    const v = inflight?.value?.[0];
    if (v && (v.status === "Landed" || v.status === "Failed")) {
      console.log(
        `🧭 Bundle poll #${attempt}: status=${v.status}${
          v.landed_slot ? ` slot=${v.landed_slot}` : ""
        }`
      );
      return v;
    }

    const hist = await getBundleStatuses(bundleId);
    const h = hist?.value?.[0];
    if (h && h.confirmation_status) {
      const landed =
        h.confirmation_status === "finalized" ||
        h.confirmation_status === "confirmed";
      console.log(
        `🧭 Bundle poll #${attempt}: status=${landed ? "Landed" : "Pending"}${
          h.slot ? ` slot=${h.slot}` : ""
        }`
      );
      return {
        bundle_id: h.bundle_id,
        status: landed ? "Landed" : "Pending",
        landed_slot: h.slot,
        transactions: h.transactions || [],
      };
    }

    const rpc = await connection.getSignatureStatuses([mainSig], {
      searchTransactionHistory: true,
    });
    const s = rpc.value?.[0];
    if (
      s &&
      (s.confirmationStatus === "confirmed" ||
        s.confirmationStatus === "finalized")
    )
      return { bundle_id: bundleId, status: "Landed", landed_slot: s.slot };

    console.log(`🧭 Bundle poll #${attempt}: status=${v?.status || "unknown"}`);
    if (
      pollCount >= maxPolls &&
      (v?.status === "Pending" || v?.status === "Invalid")
    )
      return v || h || null;
    last = v || h || null;
    await new Promise((r) => setTimeout(r, pollMs));
    if (pollMs < 5000) pollMs = Math.min(5000, Math.floor(pollMs * 1.25));
  }
  return last || { bundle_id: bundleId, status: "Timeout", landed_slot: null };
}

async function main() {
  const inputMint = "So11111111111111111111111111111111111111112";
  const outputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const amount = 0.01;
  const slippageBps = 100;
  const maxRetries = 5;

  console.log("\n🚀 Starting swap operation...");
  console.log(`Input: ${amount} SOL`);
  console.log(`Output: USDC`);
  console.log(`Initial Slippage: ${slippageBps / 100}%`);

  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log("\n🔄 ========== INITIATING SWAP ==========");
      console.log("🔍 Fetching token information...");
      const inputDecimals = await getTokenDecimals(inputMint);
      const outputDecimals = await getTokenDecimals(outputMint);
      console.log(`🔢 Input token decimals: ${inputDecimals}`);
      console.log(`🔢 Output token decimals: ${outputDecimals}`);

      console.log("\n💰 Getting quote from Jupiter...");
      const adjustedAmount = Math.floor(amount * 10 ** inputDecimals);
      const quoteResponse = await getQuote(
        inputMint,
        outputMint,
        adjustedAmount,
        slippageBps
      );
      if (!quoteResponse || !quoteResponse.routePlan)
        throw new Error("No trading routes found");
      console.log("✅ Quote received successfully");

      console.log("\n📝 Getting swap instructions...");
      const swapInstructions = await getSwapInstructions(
        quoteResponse,
        wallet.publicKey.toString()
      );
      if (!swapInstructions || (swapInstructions as any).error)
        throw new Error("Failed to get swap instructions");
      console.log("✅ Swap instructions received successfully");

      console.log("\n🛠️  Preparing transaction...");
      const { blockhash } = await connection.getLatestBlockhash("processed");
      const {
        setupInstructions,
        swapInstruction: swapInstructionPayload,
        cleanupInstruction,
        addressLookupTableAddresses,
      } = swapInstructions as any;

      console.log("\n🧪 Simulating transaction...");
      console.log("🔍 Simulating transaction to estimate compute units...");
      const addressLookupTableAccounts = await getAddressLookupTableAccounts(
        connection,
        addressLookupTableAddresses || []
      );
      const simInstructions = [
        ...setupInstructions.map((i: any) => deserializeInstruction(i)),
        deserializeInstruction(swapInstructionPayload),
        ...(cleanupInstruction
          ? [deserializeInstruction(cleanupInstruction)]
          : []),
      ] as any;
      const simMsg = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: simInstructions,
      }).compileToV0Message(addressLookupTableAccounts as any);
      const dummyTx = new VersionedTransaction(simMsg);
      const sim = await connection.simulateTransaction(dummyTx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      const units = Math.ceil(
        ((sim.value?.unitsConsumed as number) || 100000) * 1.2
      );
      console.log(
        `✅ Simulation successful. Units consumed: ${
          (sim.value?.unitsConsumed as number) || 100000
        }`
      );
      console.log(`🧮 Compute units: ${units}`);

      // Collect program IDs from instructions to target provider estimator
      const programIds = simInstructions.map((ix: any) =>
        (ix.programId as PublicKey).toBase58()
      );
      // Prefer provider estimate (targeted), then percentile; fallback to average
      let pf = await getProviderEstimatedPriorityFee(undefined, programIds);
      if (!pf || !Number.isFinite(pf.microLamports) || pf.microLamports <= 0) {
        pf = await getPercentilePriorityFee();
      }
      if (!pf || !Number.isFinite(pf.microLamports) || pf.microLamports <= 0) {
        pf = await getAveragePriorityFee();
      }
      console.log(
        `💸 Priority fee: ${
          pf.microLamports
        } micro-lamports (${pf.solAmount.toFixed(9)} SOL)`
      );

      const vtx = createVersionedTransaction(
        [
          ...setupInstructions.map((i: any) => deserializeInstruction(i)),
          deserializeInstruction(swapInstructionPayload),
          ...(cleanupInstruction
            ? [deserializeInstruction(cleanupInstruction)]
            : []),
        ] as any,
        wallet.publicKey,
        addressLookupTableAccounts as any,
        blockhash,
        units,
        pf
      );
      vtx.sign([wallet]);

      const attemptStart = Date.now();
      console.log("\n📦 Creating Jito bundle...");
      const { bundle, tipLamports } = await createBundle(
        vtx,
        wallet,
        blockhash,
        retries
      );
      console.log("✅ Jito bundle created successfully");

      console.log("\n📤 Sending Jito bundle...");
      const bundleId = await sendBundle(bundle);
      console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);

      console.log("\n🔍 Checking bundle status...");
      const mainSig = bs58.encode(vtx.signatures[0]);
      const status = await confirmBundle(bundleId, mainSig, 60000, 2000, 3);
      const attemptMs = Date.now() - attemptStart;
      console.log(
        `⏱️ Attempt ${
          retries + 1
        } stats: time=${attemptMs}ms tip=${tipLamports} lamports status=${
          (status as any)?.status || "unknown"
        }`
      );
      if (!status || (status as any).status !== "Landed") {
        throw new Error("Failed to execute swap after multiple attempts.");
      }

      console.log(`✔ Bundle finalized. Slot: ${(status as any).landed_slot}`);
      const txs: string[] = (status as any).transactions || [mainSig];
      const swapSig = txs.find((sig) => sig === mainSig) || mainSig;
      console.log(`🔗 View on Solscan: https://solscan.io/tx/${swapSig}`);
      break;
    } catch (e: any) {
      console.error(
        `\n❌ Error executing swap (attempt ${retries + 1}/${maxRetries}):`
      );
      console.error(e.message || e);
      retries++;
      if (retries >= maxRetries) {
        console.error(
          `\n💔 Failed to execute swap after ${maxRetries} attempts.`
        );
        throw e;
      }
      console.log(`\nRetrying in 2 seconds...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((e) => console.error(e));
