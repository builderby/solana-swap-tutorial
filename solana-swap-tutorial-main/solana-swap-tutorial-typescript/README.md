# Solana Swap Tutorial (TypeScript Version)

This is a TypeScript implementation of the Solana Swap tutorial by Builderby.

## Features

- Interact with Jupiter Aggregator for token swaps on Solana
- Use Jito bundles for MEV protection
- Written in TypeScript with full type safety
- Includes detailed console output for each step of the swap process

## Prerequisites

- Node.js v16 or later
- npm v7 or later
- A Solana RPC URL (e.g., from Helius)
- A wallet with SOL for transactions

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/solana-swap-tutorial-typescript.git
cd solana-swap-tutorial-typescript
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root with the following variables:
```
SOLANA_RPC_URL=https://your-rpc-url-here
WALLET_PRIVATE_KEY=[your-private-key-array-here]
```

Note: Your private key should be in the format of a numeric array, e.g., `[132,178,90,...]`

## Usage

1. Build the TypeScript code:
```bash
npm run build
```

2. Run the swap script:
```bash
npm start
```

Or in development mode:
```bash
npm run dev
```

## Customizing the Swap

To customize the swap parameters, modify the following values in `src/index.ts`:

```typescript
const inputMint = "So11111111111111111111111111111111111111112"; // Wrapped SOL
const outputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
const amount = 0.01; // 0.01 SOL
const initialSlippageBps = 100; // 1% initial slippage
const maxRetries = 5;
```

## License

ISC 