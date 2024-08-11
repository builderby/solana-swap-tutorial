const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  AddressLookupTableAccount,
} = require("@solana/web3.js");
const axios = require("axios");
const bs58 = require("bs58");
require("dotenv").config();

// Constants
const JUPITER_V6_API = "https://quote-api.jup.ag/v6";
const JITO_RPC_URL = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

// Initialize connection and wallet
const connection = new Connection(process.env.SOLANA_RPC_URL);
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.WALLET_PRIVATE_KEY))
);

// Helper function to deserialize instruction
const deserializeInstruction = (instruction) => {
  return {
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(instruction.data, "base64"),
  };
};

// Helper function to get address lookup table accounts
const getAddressLookupTableAccounts = async (keys) => {
  const addressLookupTableAccounts = await Promise.all(
    keys.map(async (key) => {
      const accountInfo = await connection.getAccountInfo(new PublicKey(key));
      return {
        key: new PublicKey(key),
        state: accountInfo
          ? AddressLookupTableAccount.deserialize(accountInfo.data)
          : null,
      };
    })
  );
  return addressLookupTableAccounts.filter((account) => account.state !== null);
};

// Function to get token info
async function getTokenInfo(mint) {
  const mintAccount = new PublicKey(mint);
  const mintInfo = await connection.getParsedAccountInfo(mintAccount);

  if (!mintInfo.value || !mintInfo.value.data || !mintInfo.value.data.parsed) {
    throw new Error(`❌ Failed to fetch token info for mint: ${mint}`);
  }

  const { decimals } = mintInfo.value.data.parsed.info;
  return { decimals };
}

// Function to get average priority fee
async function getAveragePriorityFee() {
  const priorityFees = await connection.getRecentPrioritizationFees();
  if (priorityFees.length === 0) {
    return 10000; // Default to 10000 micro-lamports if no data
  }

  const recentFees = priorityFees.slice(-150); // Get fees from last 150 slots
  const averageFee =
    recentFees.reduce((sum, fee) => sum + fee.prioritizationFee, 0) /
    recentFees.length;
  return Math.ceil(averageFee);
}

// Function to get Jito tip accounts
async function getTipAccounts() {
  try {
    const response = await axios.post(
      JITO_RPC_URL,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getTipAccounts",
        params: [],
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    return response.data.result;
  } catch (error) {
    console.error("❌ Error getting tip accounts:", error.message);
    throw error;
  }
}

// Function to create Jito bundle
async function createJitoBundle(transaction) {
  try {
    const tipAccounts = await getTipAccounts();
    if (!tipAccounts || tipAccounts.length === 0) {
      throw new Error("❌ Failed to get Jito tip accounts");
    }

    const tipAccountPubkey = new PublicKey(
      tipAccounts[Math.floor(Math.random() * tipAccounts.length)]
    );

    const tipInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: tipAccountPubkey,
      lamports: 10000,
    });

    const latestBlockhash = await connection.getLatestBlockhash("finalized");

    const tipTransaction = new Transaction().add(tipInstruction);
    tipTransaction.recentBlockhash = latestBlockhash.blockhash;
    tipTransaction.feePayer = wallet.publicKey;
    tipTransaction.sign(wallet);

    console.log("🔄 Encoding transactions...");
    const bundle = [tipTransaction, transaction].map((tx, index) => {
      console.log(`📦 Encoding transaction ${index + 1}`);
      if (tx instanceof VersionedTransaction) {
        console.log(`🔢 Transaction ${index + 1} is VersionedTransaction`);
        return bs58.encode(tx.serialize());
      } else {
        console.log(`📜 Transaction ${index + 1} is regular Transaction`);
        return bs58.encode(tx.serialize({ verifySignatures: false }));
      }
    });

    console.log("✅ Bundle created successfully");
    return bundle;
  } catch (error) {
    console.error("❌ Error in createJitoBundle:", error);
    console.error("🔍 Error stack:", error.stack);
    throw error;
  }
}

// Function to send Jito bundle
async function sendJitoBundle(bundle) {
  try {
    const response = await axios.post(
      JITO_RPC_URL,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [bundle],
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    return response.data.result;
  } catch (error) {
    console.error("❌ Error sending Jito bundle:", error.message);
    throw error;
  }
}

// Function to check bundle status
async function checkBundleStatus(bundleId) {
  try {
    const response = await axios.post(
      JITO_RPC_URL,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getInflightBundleStatuses",
        params: [[bundleId]],
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    const result = response.data.result.value[0];
    if (!result) {
      console.log(`ℹ️ No status found for bundle ID: ${bundleId}`);
      return null;
    }

    return {
      bundleId: result.bundle_id,
      status: result.status,
      landedSlot: result.landed_slot,
    };
  } catch (error) {
    console.error("❌ Error checking bundle status:", error.message);
    return null;
  }
}

// Function to simulate transaction and get compute units
async function simulateTransaction(
  instructions,
  payer,
  addressLookupTableAccounts,
  maxRetries = 5
) {
  console.log("🔍 Simulating transaction to estimate compute units...");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");

  let retries = 0;
  while (retries < maxRetries) {
    try {
      const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: instructions.filter(Boolean), // Remove any null instructions
      }).compileToV0Message(addressLookupTableAccounts);

      const transaction = new VersionedTransaction(messageV0);

      const simulation = await connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (simulation.value.err) {
        console.error(
          "❌ Simulation error:",
          JSON.stringify(simulation.value.err, null, 2)
        );
        if (simulation.value.logs) {
          console.error("📜 Simulation logs:", simulation.value.logs);
        }
        throw new Error(
          `❌ Simulation failed: ${JSON.stringify(simulation.value.err)}`
        );
      }

      const unitsConsumed = simulation.value.unitsConsumed || 0;
      console.log("✅ Simulation successful. Units consumed:", unitsConsumed);

      // Add a buffer to the computed units (e.g., 20% more)
      const computeUnits = Math.ceil(unitsConsumed * 1.2);
      return computeUnits;
    } catch (error) {
      console.error("❌ Error during simulation:", error.message);
      if (error.message.includes("InsufficientFundsForRent")) {
        return { error: "InsufficientFundsForRent" };
      }
      retries++;
      if (retries >= maxRetries) {
        console.error("❌ Max retries reached. Simulation failed.");
        return undefined;
      }
      console.log(`🔄 Retrying simulation (attempt ${retries + 1})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second before retrying
    }
  }
}

// Main swap function
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
      const quoteResponse = await axios.get(`${JUPITER_V6_API}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount: adjustedAmount,
          slippageBps: adjustedSlippageBps,
        },
      });

      if (!quoteResponse.data || !quoteResponse.data.routePlan) {
        throw new Error("❌ No trading routes found");
      }

      console.log("✅ Quote received successfully");

      // 2. Get swap instructions
      console.log("\n📝 Getting swap instructions...");
      const instructionsResponse = await axios.post(
        `${JUPITER_V6_API}/swap-instructions`,
        {
          quoteResponse: quoteResponse.data,
          userPublicKey: wallet.publicKey.toString(),
          wrapUnwrapSOL: true,
        }
      );

      if (!instructionsResponse.data || instructionsResponse.data.error) {
        throw new Error(
          "❌ Failed to get swap instructions: " +
            (instructionsResponse.data
              ? instructionsResponse.data.error
              : "Unknown error")
        );
      }

      console.log("✅ Swap instructions received successfully");

      const {
        setupInstructions,
        swapInstruction: swapInstructionPayload,
        cleanupInstruction,
        addressLookupTableAddresses,
      } = instructionsResponse.data;

      const swapInstruction = deserializeInstruction(swapInstructionPayload);

      // 3. Prepare transaction
      console.log("\n🛠️ Preparing transaction...");
      const addressLookupTableAccounts = await getAddressLookupTableAccounts(
        addressLookupTableAddresses
      );

      const latestBlockhash = await connection.getLatestBlockhash("finalized");

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
        5
      );

      if (computeUnits === undefined) {
        throw new Error("❌ Failed to simulate transaction");
      }

      if (computeUnits && computeUnits.error === "InsufficientFundsForRent") {
        console.log("❌ Insufficient funds for rent. Skipping this swap.");
        return null;
      }

      const priorityFee = await getAveragePriorityFee();

      console.log(`🧮 Compute units: ${computeUnits}`);
      console.log(`💸 Priority fee: ${priorityFee} micro-lamports`);

      // 5. Add compute budget and priority fee instructions
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnits,
      });
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee,
      });

      // 6. Create versioned transaction
      const finalInstructions = [
        computeBudgetIx,
        priorityFeeIx,
        ...instructions,
      ];

      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: finalInstructions,
      }).compileToV0Message(addressLookupTableAccounts);

      const transaction = new VersionedTransaction(messageV0);

      // 7. Sign the transaction
      transaction.sign([wallet]);

      // 8. Create and send Jito bundle
      console.log("\n📦 Creating Jito bundle...");
      const jitoBundle = await createJitoBundle(transaction);
      console.log("✅ Jito bundle created successfully");

      console.log("\n📤 Sending Jito bundle...");
      const bundleId = await sendJitoBundle(jitoBundle);
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

      return bundleStatus;
    } catch (error) {
      console.error(
        `\n❌ Error executing swap (attempt ${retries + 1}/${maxRetries}):`
      );
      console.error(error.message);
      if (error.stack) {
        console.error(error.stack);
      }
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

// Example usage
async function main() {
  try {
    const inputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
    const outputMint = "So11111111111111111111111111111111111111112"; // Wrapped SOL
    const amount = 1; // 1 USDC
    const initialSlippageBps = 100; // 1% initial slippage
    const maxRetries = 5;

    console.log("\n🚀 Starting swap operation...");
    console.log(`Input: ${amount} USDC`);
    console.log(`Output: Wrapped SOL`);
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
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("\n💥 Error in main function:");
    console.error(error.message);
  }
}

main();
