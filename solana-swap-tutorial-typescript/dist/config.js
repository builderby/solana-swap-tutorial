"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLET_PRIVATE_KEY = exports.SOLANA_RPC_URL = exports.JITO_RPC_URL = exports.JUPITER_V6_API = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.JUPITER_V6_API = "https://quote-api.jup.ag/v6";
exports.JITO_RPC_URL = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
exports.SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
exports.WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
