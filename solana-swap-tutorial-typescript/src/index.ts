import {
  Connection,
  Keypair,
  PublicKey
} from "@solana/web3.js";
import {
  deserializeInstruction,
  getAddressLookupTableAccounts,
  simulateTransaction,
  createVersionedTransaction,
} from "./transactionUtils";
import { getTokenInfo, getAveragePriorityFee } from "./utils";
import { getQuote, getSwapInstructions } from "./jupiterApi";
import {
  createJitoBundle,
  sendJitoBundle,
  checkBundleStatus,
} from "./jitoService";
import { validateMint, validateAmount, validateSlippage, validateRetries } from "./validation";
import { SOLANA_RPC_URL, WALLET_PRIVATE_KEY } from "./config";
import bs58 from 'bs58';

const connection = new Connection(SOLANA_RPC_URL);
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(WALLET_PRIVATE_KEY))
);

interface SwapResult {
  bundleStatus: {
    bundleId: string;
    status: string;
    landedSlot?: number;
  } | null;
  signature: string;
}

async function swap(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps = 100,
  maxRetries = 5
): Promise<SwapResult | null> {
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
        addressLookupTableAddresses || []
      );

      if (addressLookupTableAddresses && addressLookupTableAddresses.length > 0 && 
          (!addressLookupTableAccounts || addressLookupTableAccounts.length === 0)) {
        console.warn(`⚠️ Warning: Failed to retrieve any address lookup tables. Expected ${addressLookupTableAddresses.length} tables.`);
      }

      const latestBlockhash = await connection.getLatestBlockhash("finalized");

      // 4. Simulate transaction to get compute units
      const instructions = [
        ...(setupInstructions ? setupInstructions.map(deserializeInstruction) : []),
        swapInstruction,
      ];

      if (cleanupInstruction) {
        instructions.push(deserializeInstruction(cleanupInstruction));
      }

      console.log("\n🧪 Simulating transaction...");
      let computeUnits;
      try {
        computeUnits = await simulateTransaction(
          instructions,
          wallet.publicKey,
          addressLookupTableAccounts,
          5
        );
      } catch (error) {
        console.error("❌ Error in transaction simulation with lookup tables:", error);
        console.log("🔄 Trying simulation without address lookup tables as fallback...");
        
        computeUnits = await simulateTransaction(
          instructions,
          wallet.publicKey,
          [], // Empty array for lookup tables
          3
        );
      }

      if (computeUnits === undefined) {
        throw new Error("❌ Failed to simulate transaction");
      }

      if (typeof computeUnits === 'object' && computeUnits.error === "InsufficientFundsForRent") {
        console.log("❌ Insufficient funds for rent. Skipping this swap.");
        return null;
      }

      const priorityFee = await getAveragePriorityFee();

      console.log(`🧮 Compute units: ${computeUnits}`);
      console.log(`💸 Priority fee: ${priorityFee.microLamports} micro-lamports (${priorityFee.solAmount.toFixed(9)} SOL)`);

      // 5. Create versioned transaction
      let transaction;
      try {
        transaction = createVersionedTransaction(
          instructions,
          wallet.publicKey,
          addressLookupTableAccounts,
          latestBlockhash.blockhash,
          computeUnits as number,
          priorityFee
        );
      } catch (error) {
        console.error("❌ Error creating transaction with lookup tables:", error);
        console.log("🔄 Creating transaction without lookup tables as fallback...");
        
        transaction = createVersionedTransaction(
          instructions,
          wallet.publicKey,
          [], // Empty array for lookup tables
          latestBlockhash.blockhash,
          computeUnits as number,
          priorityFee
        );
      }
      
      // 6. Sign the transaction
      transaction.sign([wallet]);

      // 7. Create and send Jito bundle
      console.log("\n📦 Creating Jito bundle...");
      const jitoBundle = await createJitoBundle(transaction, wallet);
      console.log("✅ Jito bundle created successfully");

      console.log("\n📤 Sending Jito bundle...");
      let bundleId = await sendJitoBundle(jitoBundle);
      console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);

      console.log("\n🔍 Checking bundle status...");
      let bundleStatus = null;
      let bundleRetries = 3;
      const delay = 15000; // Wait 15 seconds

      while (bundleRetries > 0) {
        console.log(`⏳ Waiting for 15 seconds before checking status...`);
        await new Promise((resolve) => setTimeout(resolve, delay));

        bundleStatus = await checkBundleStatus(bundleId);

        if (bundleStatus && bundleStatus.status === "Landed") {
          console.log(`✔ Bundle finalized. Slot: ${bundleStatus.landedSlot}`);
          break;
        } else if (bundleStatus && bundleStatus.status === "Failed") {
          console.log("❌ Bundle failed. Retrying...");
          bundleId = await sendJitoBundle(jitoBundle);
          console.log(`New Bundle ID: ${bundleId}`);
        } else {
          console.log(
            `Bundle not finalized. Status: ${
              bundleStatus ? bundleStatus.status : "unknown"
            }`
          );
        }

        bundleRetries--;
      }

      if (!bundleStatus || bundleStatus.status !== "Landed") {
        throw new Error("Failed to execute swap after multiple attempts.");
      }

      console.log("\n✨ Swap executed successfully! ✨");
      console.log("========== SWAP COMPLETE ==========\n");

      const signature = bs58.encode(transaction.signatures[0]);
      return { bundleStatus, signature };
    } catch (error: any) {
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
  return null;
}

async function main() {
  try {
    const inputMint = "So11111111111111111111111111111111111111112"; // Wrapped SOL
    const outputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
    const amount = 0.01; // 0.01 SOL
    const initialSlippageBps = 100; // 1% initial slippage
    const maxRetries = 5;

    // Validate inputs
    validateMint(inputMint);
    validateMint(outputMint);
    validateAmount(amount);
    validateSlippage(initialSlippageBps);
    validateRetries(maxRetries);

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

    if (!result) {
      console.error("\n💔 Swap could not be completed.");
      return;
    }

    console.log("\n🎉 Swap completed successfully!");
    console.log("Swap result:");
    console.log(JSON.stringify(result.bundleStatus, null, 2));
    console.log("\n🖋️  Transaction signature:", result.signature);
    console.log(`🔗 View on Solscan: https://solscan.io/tx/${result.signature}`);
  } catch (error: any) {
    console.error("\n💥 Error in main function:");
    console.error(error.message);
  }
}

main(); 