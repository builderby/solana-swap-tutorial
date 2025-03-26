"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenInfo = getTokenInfo;
exports.getAveragePriorityFee = getAveragePriorityFee;
const web3_js_1 = require("@solana/web3.js");
const config_1 = require("./config");
const connection = new web3_js_1.Connection(config_1.SOLANA_RPC_URL);
async function getTokenInfo(mint) {
    const mintAccount = new web3_js_1.PublicKey(mint);
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
        return { microLamports: 10000, solAmount: 0.00001 }; // Default to 10000 micro-lamports if no data
    }
    const recentFees = priorityFees.slice(-150); // Get fees from last 150 slots
    const averageFee = recentFees.reduce((sum, fee) => sum + fee.prioritizationFee, 0) /
        recentFees.length;
    const microLamports = Math.ceil(averageFee);
    const solAmount = microLamports / 1e6 / 1e3; // Convert micro-lamports to SOL
    return { microLamports, solAmount };
}
