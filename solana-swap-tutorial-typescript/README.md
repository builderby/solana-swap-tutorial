# TypeScript Version - Solana Swap Tutorial (Jito-ready)

This directory mirrors the JavaScript tutorial with TypeScript and includes the latest Jito Block Engine best practices:

- Env-driven regional Jito bundles URL(s)
- Base64 bundle encoding and `{ encoding: 'base64' }`
- Bundle order `[tip transaction, main transaction]`
- Fresh `processed` blockhash and shared blockhash for tip tx
- Dynamic Jito tip from `tip_floor` with multiplier and min floor
- Reliable confirmation flow: `getInflightBundleStatuses` → `getBundleStatuses` → RPC `getSignatureStatuses`

## Setup

```bash
cd solana-swap-tutorial-typescript
npm install
```

Create `.env` (copy from project root if you like). Required and optional variables:

```
SOLANA_RPC_URL=https://your-rpc                   # Required
WALLET_PRIVATE_KEY=[your,private,keypair,array,here]  # Required (JSON array)
JITO_BUNDLE_URL=https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles  # Required (choose closest region)
# JITO_BUNDLE_URL_FALLBACK_1=https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles  # Optional
# JITO_BUNDLE_URL_FALLBACK_2=https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles   # Optional
JITO_TIP_MULTIPLIER=1.2                           # Optional (default 1.2)
JITO_MIN_TIP_LAMPORTS=1000                        # Optional (default 1000)
JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS=5000          # Optional higher floor only for first attempt
JITO_TIP_ESCALATION=1.0,1.2,1.5,2.0               # Optional escalation per retry
JITO_MAX_TIP_LAMPORTS=2000000                     # Optional absolute tip cap
JITO_TIP_BASE=ema50                                # ema50|p50|p75|p95|p99 baseline for floor
PRIORITY_FEE_PERCENTILE=75                         # Percentile CU price (50/75/90/95/99)
PRIORITY_FEE_MIN_MICROLAMPORTS=10000               # Min CU micro-lamports
PRIORITY_FEE_MAX_MICROLAMPORTS=1000000             # Max CU micro-lamports
PRIORITY_FEE_PROVIDER_URL=                         # Optional provider estimator (Helius/QuickNode)
PRIORITY_FEE_PROVIDER_METHOD=getPriorityFeeEstimate
PRIORITY_FEE_ACCOUNT_KEYS=ComputeBudget111111111111111111111111111111   # Optional comma-separated list to target fees
```

## Run

```bash
npm run dev
```

The sample `src/index.ts` demonstrates Jito bundling mechanics. Integrate your Jupiter route building similarly to the JavaScript version to perform real swaps.

## Notes

- Keep poll interval modest (2s → 5s backoff) to avoid 429s.
- Prefer a single closest region for `JITO_BUNDLE_URL`.
- On success, the script prints Solscan URLs for transactions in the bundle.
