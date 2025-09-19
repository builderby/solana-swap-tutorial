import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

export function deserializeInstruction(instruction: any) {
  return {
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((key: any) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(instruction.data, 'base64'),
  } as any;
}

export function createVersionedTransaction(
  instructions: any[],
  payer: PublicKey,
  addressLookupTableAccounts: AddressLookupTableAccount[],
  recentBlockhash: string,
  computeUnits: number,
  priorityFee: { microLamports: number }
) {
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits });
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee.microLamports });
  const finalInstructions = [computeBudgetIx, priorityFeeIx, ...instructions];

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: finalInstructions as any,
  }).compileToV0Message(addressLookupTableAccounts);

  return new VersionedTransaction(messageV0);
}


