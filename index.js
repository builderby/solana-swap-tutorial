const { Connection, Keypair } = require("@solana/web3.js");
const {
  deserializeInstruction,
  getAddressLookupTableAccounts,
  simulateTransaction,
  createVersionedTransaction,
} = require("./transactionUtils");
const {
  getTokenInfo,
  getAveragePriorityFee,
  getPercentilePriorityFee,
  getProviderEstimatedPriorityFee,
} = require("./utils");
const { getQuote, getSwapInstructions } = require("./jupiterApi");
const {
  createJitoBundle,
  sendJitoBundle,
  checkBundleStatus,
  confirmBundle,
} = require("./jitoService");
const { SOLANA_RPC_URL, WALLET_PRIVATE_KEY } = require("./config");
const bs58 = require("bs58");

const connection = new Connection(SOLANA_RPC_URL);
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(WALLET_PRIVATE_KEY))
);

async function swap(
  inputMint,
  outputMint,
  amount,
  slippageBps = 100,
  maxRetries = 5
) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log("\n🔄 ========== INITIATING SWAP ==========");
      console.log("🔍 Fetching token information...");
      const inputTokenInfo = await getTokenInfo(inputMint);
      const outputTokenInfo = await getTokenInfo(outputMint);

      console.log(`🔢 Input token decimals: ${inputTokenInfo.decimals}`);
      console.log(`🔢 Output token decimals: ${outputTokenInfo.decimals}`);

      const adjustedAmount = amount * Math.pow(10, inputTokenInfo.decimals);
      const adjustedSlippageBps = slippageBps * (1 + retries * 0.5);

      // 1. Get quote from Jupiter
      console.log("\n💰 Getting quote from Jupiter...");
      const quoteResponse = await getQuote(
        inputMint,
        outputMint,
        adjustedAmount,
        adjustedSlippageBps
      );

      if (!quoteResponse || !quoteResponse.routePlan) {
        throw new Error("❌ No trading routes found");
      }

      console.log("✅ Quote received successfully");

      // 2. Get swap instructions
      console.log("\n📝 Getting swap instructions...");
      const swapInstructions = await getSwapInstructions(
        quoteResponse,
        wallet.publicKey.toString()
      );

      if (!swapInstructions || swapInstructions.error) {
        throw new Error(
          "❌ Failed to get swap instructions: " +
            (swapInstructions ? swapInstructions.error : "Unknown error")
        );
      }

      console.log("✅ Swap instructions received successfully");

      const {
        setupInstructions,
        swapInstruction: swapInstructionPayload,
        cleanupInstruction,
        addressLookupTableAddresses,
      } = swapInstructions;

      const swapInstruction = deserializeInstruction(swapInstructionPayload);

      // 3. Prepare transaction
      console.log("\n🛠️  Preparing transaction...");
      const addressLookupTableAccounts = await getAddressLookupTableAccounts(
        addressLookupTableAddresses
      );

      // Use a fresher commitment for recent blockhash to maximize landing chances
      // Always fetch a fresh processed blockhash to avoid staleness
      const latestBlockhash = await connection.getLatestBlockhash("processed");

      // 4. Simulate transaction to get compute units
      const instructions = [
        ...setupInstructions.map(deserializeInstruction),
        swapInstruction,
      ];

      if (cleanupInstruction) {
        instructions.push(deserializeInstruction(cleanupInstruction));
      }

      console.log("\n🧪 Simulating transaction...");
      const computeUnits = await simulateTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        5,
        latestBlockhash.lastValidBlockHeight ? undefined : undefined
      );

      if (computeUnits === undefined) {
        throw new Error("❌ Failed to simulate transaction");
      }

      if (computeUnits && computeUnits.error === "InsufficientFundsForRent") {
        console.log("❌ Insufficient funds for rent. Skipping this swap.");
        return null;
      }

      // Collect program IDs from instructions to target provider estimator
      const programIds = instructions
        .map((ix) => ix.programId?.toString?.())
        .filter(Boolean);
      // Prefer provider estimate (targeted), then percentile; fallback to average
      let priorityFee = await getProviderEstimatedPriorityFee(
        undefined,
        programIds
      );
      if (
        !priorityFee ||
        !Number.isFinite(priorityFee.microLamports) ||
        priorityFee.microLamports <= 0
      ) {
        priorityFee = await getPercentilePriorityFee();
      }
      if (
        !priorityFee ||
        !Number.isFinite(priorityFee.microLamports) ||
        priorityFee.microLamports <= 0
      ) {
        priorityFee = await getAveragePriorityFee();
      }

      console.log(`🧮 Compute units: ${computeUnits}`);
      console.log(
        `💸 Priority fee: ${
          priorityFee.microLamports
        } micro-lamports (${priorityFee.solAmount.toFixed(9)} SOL)`
      );

      // 5. Create versioned transaction
      const transaction = createVersionedTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        latestBlockhash.blockhash,
        computeUnits,
        priorityFee
      );

      // 6. Sign the transaction
      transaction.sign([wallet]);

      // 7. Create and send Jito bundle
      const attemptStart = Date.now();
      console.log("\n📦 Creating Jito bundle...");
      const { bundle: jitoBundle, tipLamports } = await createJitoBundle(
        transaction,
        wallet,
        latestBlockhash.blockhash,
        retries
      );
      console.log("✅ Jito bundle created successfully");

      console.log("\n📤 Sending Jito bundle...");
      let bundleId = await sendJitoBundle(jitoBundle);
      console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);

      console.log("\n🔍 Checking bundle status...");
      const mainSig = bs58.encode(transaction.signatures[0]);
      const bundleStatus = await confirmBundle(
        bundleId,
        mainSig,
        60000,
        2000,
        3
      );
      const attemptMs = Date.now() - attemptStart;
      console.log(
        `⏱️ Attempt ${
          retries + 1
        } stats: time=${attemptMs}ms tip=${tipLamports} lamports status=${
          bundleStatus ? bundleStatus.status : "unknown"
        }`
      );

      if (!bundleStatus || bundleStatus.status !== "Landed") {
        // If not landed, rebuild with a new fresh blockhash and resubmit in next retry loop
        throw new Error("Failed to execute swap after multiple attempts.");
      }

      console.log("\n✨ Swap executed successfully! ✨");
      console.log("========== SWAP COMPLETE ==========\n");

      const signature = bs58.encode(transaction.signatures[0]);
      return { bundleStatus, signature };
    } catch (error) {
      console.error(
        `\n❌ Error executing swap (attempt ${retries + 1}/${maxRetries}):`
      );
      console.error(error.message);
      retries++;
      if (retries >= maxRetries) {
        console.error(
          `\n💔 Failed to execute swap after ${maxRetries} attempts.`
        );
        throw error;
      }
      console.log(`\nRetrying in 2 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main() {
  try {
    const inputMint = "So11111111111111111111111111111111111111112"; // Wrapped SOL
    const outputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
    const amount = 0.01; // 0.01 SOL
    const initialSlippageBps = 100; // 1% initial slippage
    const maxRetries = 5;

    console.log("\n🚀 Starting swap operation...");
    console.log(`Input: ${amount} SOL`);
    console.log(`Output: USDC`);
    console.log(`Initial Slippage: ${initialSlippageBps / 100}%`);

    const result = await swap(
      inputMint,
      outputMint,
      amount,
      initialSlippageBps,
      maxRetries
    );

    console.log("\n🎉 Swap completed successfully!");
    console.log("Swap result:");
    console.log(JSON.stringify(result.bundleStatus, null, 2));
    console.log("\n🖋️  Transaction signature:", result.signature);
    console.log(
      `🔗 View on Solscan: https://solscan.io/tx/${result.signature}`
    );
  } catch (error) {
    console.error("\n💥 Error in main function:");
    console.error(error.message);
  }
}

main();
