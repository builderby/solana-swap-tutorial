const axios = require("axios");
const { PublicKey, SystemProgram, Transaction, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const { JITO_RPC_URL, SOLANA_RPC_URL } = require("./config");
const { Connection } = require("@solana/web3.js");

const connection = new Connection(SOLANA_RPC_URL);

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

async function createJitoBundle(transaction, wallet) {
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

    const signature = bs58.encode(transaction.signatures[0]);

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

module.exports = {
  createJitoBundle,
  sendJitoBundle,
  checkBundleStatus,
};