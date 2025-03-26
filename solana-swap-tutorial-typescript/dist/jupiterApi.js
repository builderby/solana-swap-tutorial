"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuote = getQuote;
exports.getSwapInstructions = getSwapInstructions;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
async function getQuote(inputMint, outputMint, amount, slippageBps) {
    const response = await axios_1.default.get(`${config_1.JUPITER_V6_API}/quote`, {
        params: {
            inputMint,
            outputMint,
            amount,
            slippageBps,
        },
    });
    return response.data;
}
async function getSwapInstructions(quoteResponse, userPublicKey) {
    const response = await axios_1.default.post(`${config_1.JUPITER_V6_API}/swap-instructions`, {
        quoteResponse,
        userPublicKey,
        wrapUnwrapSOL: true,
    });
    return response.data;
}
