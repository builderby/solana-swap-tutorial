# Changelog

## 2025-09-19

### Added
- Provider-based priority fee estimator (Helius/QuickNode) with percentile and min/max caps.
- Targeted fee estimation using program IDs from swap instructions.
- First-attempt tip floor `JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS`.
- ALT batching via `getMultipleAccountsInfo` with graceful fallback when ALTs missing/invalid.
- Bundle confirmation limiter (max 3 polls/attempt) and improved status fallbacks.
- Regional Jito bundle endpoint rotation with retries/backoff; tip floor fetch integration.

### Changed
- Unified blockhash usage across swap and tip transactions in bundle.
- Bundle order to `[tip, main]` to improve first-attempt acceptance.
- Prefer processed blockhash for freshness; short attempt cycle with quick retry.
- Priority fee selection now prefers provider → percentile → average.
- TypeScript: mirror of all JS updates; only swap signature is printed (not tip).

### Docs
- Updated root and TS READMEs with new env vars and guidance:
  - PRIORITY_FEE_PROVIDER_URL, PRIORITY_FEE_PROVIDER_METHOD, PRIORITY_FEE_ACCOUNT_KEYS
  - JITO_FIRST_ATTEMPT_MIN_TIP_LAMPORTS
  - JITO_BUNDLE_URL regional guidance and reliability tips

### Notes
- Secrets are read from env; no keys committed.
- .env is ignored at repo root (and for TS).

