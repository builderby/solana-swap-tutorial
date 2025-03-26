"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const transactionUtils_1 = require("./transactionUtils");
const utils_1 = require("./utils");
const jupiterApi_1 = require("./jupiterApi");
const jitoService_1 = require("./jitoService");
const validation_1 = require("./validation");
const config_1 = require("./config");
const bs58_1 = __importDefault(require("bs58"));
const connection = new web3_js_1.Connection(config_1.SOLANA_RPC_URL);
const wallet = web3_js_1.Keypair.fromSecretKey(new Uint8Array(JSON.parse(config_1.WALLET_PRIVATE_KEY)));
async function swap(inputMint, outputMint, amount, slippageBps = 100, maxRetries = 5) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            console.log("\n🔄 ========== INITIATING SWAP ==========");
            console.log("🔍 Fetching token information...");
            const inputTokenInfo = await (0, utils_1.getTokenInfo)(inputMint);
            const outputTokenInfo = await (0, utils_1.getTokenInfo)(outputMint);
            console.log(`🔢 Input token decimals: ${inputTokenInfo.decimals}`);
            console.log(`🔢 Output token decimals: ${outputTokenInfo.decimals}`);
            const adjustedAmount = amount * Math.pow(10, inputTokenInfo.decimals);
            const adjustedSlippageBps = slippageBps * (1 + retries * 0.5);
            // 1. Get quote from Jupiter
            console.log("\n💰 Getting quote from Jupiter...");
            const quoteResponse = await (0, jupiterApi_1.getQuote)(inputMint, outputMint, adjustedAmount, adjustedSlippageBps);
            if (!quoteResponse || !quoteResponse.routePlan) {
                throw new Error("❌ No trading routes found");
            }
            console.log("✅ Quote received successfully");
            // 2. Get swap instructions
            console.log("\n📝 Getting swap instructions...");
            const swapInstructions = await (0, jupiterApi_1.getSwapInstructions)(quoteResponse, wallet.publicKey.toString());
            if (!swapInstructions || swapInstructions.error) {
                throw new Error("❌ Failed to get swap instructions: " +
                    (swapInstructions ? swapInstructions.error : "Unknown error"));
            }
            console.log("✅ Swap instructions received successfully");
            const { setupInstructions, swapInstruction: swapInstructionPayload, cleanupInstruction, addressLookupTableAddresses, } = swapInstructions;
            const swapInstruction = (0, transactionUtils_1.deserializeInstruction)(swapInstructionPayload);
            // 3. Prepare transaction
            console.log("\n🛠️  Preparing transaction...");
            const addressLookupTableAccounts = await (0, transactionUtils_1.getAddressLookupTableAccounts)(addressLookupTableAddresses || []);
            if (addressLookupTableAddresses && addressLookupTableAddresses.length > 0 &&
                (!addressLookupTableAccounts || addressLookupTableAccounts.length === 0)) {
                console.warn(`⚠️ Warning: Failed to retrieve any address lookup tables. Expected ${addressLookupTableAddresses.length} tables.`);
            }
            const latestBlockhash = await connection.getLatestBlockhash("finalized");
            // 4. Simulate transaction to get compute units
            const instructions = [
                ...(setupInstructions ? setupInstructions.map(transactionUtils_1.deserializeInstruction) : []),
                swapInstruction,
            ];
            if (cleanupInstruction) {
                instructions.push((0, transactionUtils_1.deserializeInstruction)(cleanupInstruction));
            }
            console.log("\n🧪 Simulating transaction...");
            let computeUnits;
            try {
                computeUnits = await (0, transactionUtils_1.simulateTransaction)(instructions, wallet.publicKey, addressLookupTableAccounts, 5);
            }
            catch (error) {
                console.error("❌ Error in transaction simulation with lookup tables:", error);
                console.log("🔄 Trying simulation without address lookup tables as fallback...");
                computeUnits = await (0, transactionUtils_1.simulateTransaction)(instructions, wallet.publicKey, [], // Empty array for lookup tables
                3);
            }
            if (computeUnits === undefined) {
                throw new Error("❌ Failed to simulate transaction");
            }
            if (typeof computeUnits === 'object' && computeUnits.error === "InsufficientFundsForRent") {
                console.log("❌ Insufficient funds for rent. Skipping this swap.");
                return null;
            }
            const priorityFee = await (0, utils_1.getAveragePriorityFee)();
            console.log(`🧮 Compute units: ${computeUnits}`);
            console.log(`💸 Priority fee: ${priorityFee.microLamports} micro-lamports (${priorityFee.solAmount.toFixed(9)} SOL)`);
            // 5. Create versioned transaction
            let transaction;
            try {
                transaction = (0, transactionUtils_1.createVersionedTransaction)(instructions, wallet.publicKey, addressLookupTableAccounts, latestBlockhash.blockhash, computeUnits, priorityFee);
            }
            catch (error) {
                console.error("❌ Error creating transaction with lookup tables:", error);
                console.log("🔄 Creating transaction without lookup tables as fallback...");
                transaction = (0, transactionUtils_1.createVersionedTransaction)(instructions, wallet.publicKey, [], // Empty array for lookup tables
                latestBlockhash.blockhash, computeUnits, priorityFee);
            }
            // 6. Sign the transaction
            transaction.sign([wallet]);
            // 7. Create and send Jito bundle
            console.log("\n📦 Creating Jito bundle...");
            const jitoBundle = await (0, jitoService_1.createJitoBundle)(transaction, wallet);
            console.log("✅ Jito bundle created successfully");
            console.log("\n📤 Sending Jito bundle...");
            let bundleId = await (0, jitoService_1.sendJitoBundle)(jitoBundle);
            console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);
            console.log("\n🔍 Checking bundle status...");
            let bundleStatus = null;
            let bundleRetries = 3;
            const delay = 15000; // Wait 15 seconds
            while (bundleRetries > 0) {
                console.log(`⏳ Waiting for 15 seconds before checking status...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                bundleStatus = await (0, jitoService_1.checkBundleStatus)(bundleId);
                if (bundleStatus && bundleStatus.status === "Landed") {
                    console.log(`✔ Bundle finalized. Slot: ${bundleStatus.landedSlot}`);
                    break;
                }
                else if (bundleStatus && bundleStatus.status === "Failed") {
                    console.log("❌ Bundle failed. Retrying...");
                    bundleId = await (0, jitoService_1.sendJitoBundle)(jitoBundle);
                    console.log(`New Bundle ID: ${bundleId}`);
                }
                else {
                    console.log(`Bundle not finalized. Status: ${bundleStatus ? bundleStatus.status : "unknown"}`);
                }
                bundleRetries--;
            }
            if (!bundleStatus || bundleStatus.status !== "Landed") {
                throw new Error("Failed to execute swap after multiple attempts.");
            }
            console.log("\n✨ Swap executed successfully! ✨");
            console.log("========== SWAP COMPLETE ==========\n");
            const signature = bs58_1.default.encode(transaction.signatures[0]);
            return { bundleStatus, signature };
        }
        catch (error) {
            console.error(`\n❌ Error executing swap (attempt ${retries + 1}/${maxRetries}):`);
            console.error(error.message);
            retries++;
            if (retries >= maxRetries) {
                console.error(`\n💔 Failed to execute swap after ${maxRetries} attempts.`);
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
        (0, validation_1.validateMint)(inputMint);
        (0, validation_1.validateMint)(outputMint);
        (0, validation_1.validateAmount)(amount);
        (0, validation_1.validateSlippage)(initialSlippageBps);
        (0, validation_1.validateRetries)(maxRetries);
        console.log("\n🚀 Starting swap operation...");
        console.log(`Input: ${amount} SOL`);
        console.log(`Output: USDC`);
        console.log(`Initial Slippage: ${initialSlippageBps / 100}%`);
        const result = await swap(inputMint, outputMint, amount, initialSlippageBps, maxRetries);
        if (!result) {
            console.error("\n💔 Swap could not be completed.");
            return;
        }
        console.log("\n🎉 Swap completed successfully!");
        console.log("Swap result:");
        console.log(JSON.stringify(result.bundleStatus, null, 2));
        console.log("\n🖋️  Transaction signature:", result.signature);
        console.log(`🔗 View on Solscan: https://solscan.io/tx/${result.signature}`);
    }
    catch (error) {
        console.error("\n💥 Error in main function:");
        console.error(error.message);
    }
}
main();
