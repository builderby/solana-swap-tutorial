import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
  Connection,
  TransactionInstruction,
  Signer,
  SimulatedTransactionResponse
} from "@solana/web3.js";
import { SOLANA_RPC_URL } from "./config";

const connection = new Connection(SOLANA_RPC_URL);

interface SerializedInstruction {
  programId: string;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: string;
}

interface PriorityFee {
  microLamports: number;
  solAmount: number;
}

export function deserializeInstruction(instruction: SerializedInstruction): TransactionInstruction {
  return {
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(instruction.data, "base64"),
  };
}

export async function getAddressLookupTableAccounts(keys: string[]): Promise<AddressLookupTableAccount[]> {
  if (!keys || !keys.length) {
    return [];
  }
  
  try {
    const lookupTablePromises = keys.map(async (key) => {
      try {
        const pubkey = new PublicKey(key);
        const accountInfo = await connection.getAccountInfo(pubkey);
        
        if (!accountInfo || !accountInfo.data) {
          console.log(`❌ No account info found for address lookup table: ${key}`);
          return null;
        }
        
        return new AddressLookupTableAccount({
          key: pubkey,
          state: AddressLookupTableAccount.deserialize(accountInfo.data)
        });
      } catch (error) {
        console.error(`❌ Error getting address lookup table account ${key}:`, error);
        return null;
      }
    });
    
    const results = await Promise.all(lookupTablePromises);
    const validLookupTables = results.filter((account): account is AddressLookupTableAccount => 
      account !== null
    );
    
    console.log(`✅ Successfully retrieved ${validLookupTables.length} address lookup table accounts`);
    return validLookupTables;
  } catch (error) {
    console.error("❌ Error getting address lookup table accounts:", error);
    return [];
  }
}

export async function simulateTransaction(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  addressLookupTableAccounts: AddressLookupTableAccount[],
  maxRetries = 5
): Promise<number | { error: string } | undefined> {
  console.log("🔍 Simulating transaction to estimate compute units...");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  
  // Make sure we have valid instructions
  const filteredInstructions = instructions.filter(Boolean);
  if (filteredInstructions.length === 0) {
    console.error("❌ No valid instructions found for simulation");
    return undefined;
  }

  let retries = 0;
  while (retries < maxRetries) {
    try {
      // Log information about the inputs to help debug
      console.log(`📝 Simulating with ${filteredInstructions.length} instructions and ${addressLookupTableAccounts.length} address lookup tables`);
      
      const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: filteredInstructions,
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

      const computeUnits = Math.ceil(unitsConsumed * 1.2);
      return computeUnits;
    } catch (error: any) {
      console.error("❌ Error during simulation:", error.message);
      // Add more debug information
      if (error.message.includes("addresses")) {
        console.error("💡 This appears to be an issue with address lookup tables. Check their validity.");
      }
      
      if (error.message.includes("InsufficientFundsForRent")) {
        return { error: "InsufficientFundsForRent" };
      }
      retries++;
      if (retries >= maxRetries) {
        console.error("❌ Max retries reached. Simulation failed.");
        return undefined;
      }
      console.log(`🔄 Retrying simulation (attempt ${retries + 1})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return undefined;
}

export function createVersionedTransaction(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  addressLookupTableAccounts: AddressLookupTableAccount[],
  recentBlockhash: string,
  computeUnits: number,
  priorityFee: PriorityFee
): VersionedTransaction {
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnits,
  });
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee.microLamports,
  });

  const finalInstructions = [computeBudgetIx, priorityFeeIx, ...instructions.filter(Boolean)];

  // Use empty array if addressLookupTableAccounts is undefined or empty
  const lookupTables = addressLookupTableAccounts && addressLookupTableAccounts.length > 0 
    ? addressLookupTableAccounts 
    : [];
    
  console.log(`📦 Creating versioned transaction with ${finalInstructions.length} instructions and ${lookupTables.length} lookup tables`);

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: recentBlockhash,
    instructions: finalInstructions,
  }).compileToV0Message(lookupTables);

  return new VersionedTransaction(messageV0);
} 