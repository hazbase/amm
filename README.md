# @hazbase/amm
[![npm version](https://badge.fury.io/js/@hazbase%2Famm.svg)](https://badge.fury.io/js/@hazbase%2Famm)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Overview
`@hazbase/amm` is an **SDK helper** for working with AMM stack (Factory / Router / Circuit‑Breaker‑enabled Pool).
It streamlines **pool creation, initial liquidity, quoting, single/multi‑hop swaps, fee flushing, and circuit‑breaker operations** via thin, typed wrappers around `ethers` v6.

**Highlights**
- **Factory** — `createPool`, `getPool`, `setDefaults`, `upgradeImplementation`
- **Router** — `addLiquidity` / `addLiquidityETH` / `removeLiquidity` / `swapExact*` / `quoteExactTokensForTokens`
- **Pool** (CircuitBreakerAMM) — `mint` / `burn` / `quoteOut/quoteIn` / `currentRV` / `getReserves` / `flushFees` / `pause` / `updateParams`
- **Unit safety** — ERC‑20 helpers cache `decimals` and provide `parse/format` + “Human” APIs to reduce unit mistakes
- **Thenable amount (optional)** — ergonomic chaining like `await pool.balanceOf(addr).format()`

## Requirements
- **Node.js**: 18+ (ESM recommended)
- **Deps**: `ethers` v6
- **Signer**: `ethers.Signer` / `JsonRpcSigner`
- **Contracts deployed**: `AMMFactory`, `AMMRouter`, `CircuitBreakerAMM`, and `WNATIVE` on your target chain

## Installation
```bash
npm i @hazbase/amm ethers
```

## Quick start

### 1) Create pool → seed liquidity → do a single‑hop swap
```ts
import { ethers } from "ethers";
import {
  AMM,
  Router,
  Pool,
} from "@hazbase/amm";

const RPC_URL      = process.env.RPC_URL!;
const PRIVATE_KEY  = process.env.PRIVATE_KEY!;

const TOKEN_A = "<USDC>";                       // ERC20 (e.g., USDC)
const TOKEN_B = "<JPYC>";                       // ERC20 (e.g., JPYC)

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer   = new ethers.Wallet(PRIVATE_KEY, provider);

  const USDC = FlexibleTokenHelper.attach(TOKEN_A, signer);
  const JPYC = FlexibleTokenHelper.attach(TOKEN_B, signer);

  // AMM can optionally accept a custom factory address.
  // If omitted, a default factory for the given chainId is used.
  const chainId = 11155111; // example: Sepolia
  const amm = new AMM(signer, chainId /*, optionalFactoryAddress? */);

  const poolAddr = await amm.createPool({
    tokenA  : USDC.address,
    tokenB  : JPYC.address
  });

  const pool = await amm.pool(USDC.address, JPYC.address);

  const router = new Router(signer, chainId /*, optionalRouterAddress? */);

  await USDC.contract.approve(router.address, await USDC.parse(100000000n));
  await JPYC.contract.approve(router.address, await JPYC.parse(100000000n));

  const notionalA = 10_000; // 10k USDC as an example
  const priceBA   = 150;    // 150 JPYC per 1 USDC

  // --- Scale with decimals ---
  const USDC_DEC = 6;   // common
  const JPYC_DEC = 6;

  const amountADesired = BigInt(notionalA) * BigInt(10 ** USDC_DEC);   // USDC amount
  const amountBUnits   = BigInt(notionalA * priceBA);                  // 10,000 * 150 = 1,500,000
  const amountBDesired = amountBUnits * BigInt(10 ** JPYC_DEC);        // JPYC amount

  // --- Set conservative mins (e.g., -0.5%) ---
  // NOTE: Router may slightly optimize amounts; set mins to avoid reverts.
  const bps9950 = 9_950n; // 99.50%
  const BPS     = 10_000n;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const to       = await signer.getAddress();

  const amountAMin = (amountADesired * bps9950) / BPS;
  const amountBMin = (amountBDesired * bps9950) / BPS;

  await router.addLiquidity({
    pair: pool.address,
    tokenA: USDC.address,
    tokenB: JPYC.address,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    to,
    deadline,
  });

  const multi = await router.quoteExactTokensForTokens({
    amountIn: await JPYC.parse(150),
    path: [JPYC.address, USDC.address]
  });
  console.log('quote:', ethers.formatUnits(multi.amountOut, 6));
  console.log('feeBps:', multi.totalFeeBps);

  const tx = await router.swapExactTokens({
    amountIn: await JPYC.parse(150),
    amountOutMin: 1n,
    path: [JPYC.address, USDC.address],
    to: deployer.address
  });
}

main().catch(console.error);
```

### 2) One‑sided liquidity with ETH (optional)
```ts
// Add liquidity with ETH on one side
await router.addLiquidityETH({
  pair: poolAddr,
  token: TOKEN_A,                          // the ERC20 side
  amountTokenDesired: ethers.parseUnits("10000", 6),
  amountTokenMin:    ethers.parseUnits("9990",  6),
  amountETHMin:      ethers.parseUnits("50",   18),
  to,
  deadline,
  value: ethers.parseUnits("50", 18),      // payable ETH
});
```

## Network & factory selection
You can **specify a custom Factory address** when initializing AMM/Router helpers. If **omitted**, the helper will pick a **default factory (and router) for the given `chainId`** (as embedded in the SDK). This allows:
- Local devnets to pass freshly‑deployed addresses explicitly.
- Public networks to rely on curated defaults out of the box.

**Examples**
```ts
// 1) Use the default factory/router for chainId
const amm = new AMM(signer, chainId);
const router = new Router(signer, chainId);

// 2) Force a specific factory/router
const ammCustom = new AMM(signer, chainId, "0xYourFactoryAddress");
const routerCustom = new Router(signer, chainId, "0xYourRouterAddress");
```

> If you override only one of them, ensure the **factory/router pair belong to the same AMM deployment** (version‑compatible).

## Function reference (SDK)

> This package exports **SDK classes/functions** (no CLI).

### Factory — `AMM`
- `createPool(tokenA: Address, tokenB: Address): Promise<TxReceipt>` — Create a pool via CREATE2 clone (no‑op if exists).
- `getPool(tokenA: Address, tokenB: Address): Promise<Address>` — Resolve pool address if present.
- `setDefaults(d: { baseFeeBps; feeAlphaBps; lvl1Bps; lvl2Bps; lvl3Bps; maxTxBps }): Promise<TxReceipt>` — Update defaults for **future** pools.
- `upgradeImplementation(newImpl: Address): Promise<TxReceipt>` — Replace implementation used by future clones.

### Router — `Router`
- `addLiquidity(params): Promise<TxReceipt>` — Token x Token liquidity (initial ratios = initial price).
- `addLiquidityETH(params & { value: bigint }): Promise<TxReceipt>` — Token x ETH (wraps/unwarps under the hood).
- `removeLiquidity(params): Promise<TxReceipt>` — Burn LP and receive underlying assets.
- `swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline): Promise<TxReceipt>` — Single/multi‑hop; min enforced on final hop.
- `swapExactETHForTokens(amountOutMin, path, to, deadline, { value }): Promise<TxReceipt>`
- `swapExactTokensForETH(amountIn, amountOutMin, path, to, deadline): Promise<TxReceipt>`
- `quoteExactTokensForTokens(amountIn, path): Promise<{ amountOut: bigint; totalFeeBps: number; hops: Array<...> }>` — Quoting with per‑hop fees included.

### Pool — `Pool`
- **LP/Swap (direct pool methods if needed)** — `quoteOut(amountIn, zeroForOne)`, `quoteIn(amountOut, zeroForOne)`
- **View** — `tokens()`, `getReserves()`, `currentRV()`
- **Fees** — `flushFees(token, maxAmount)`, `flushNative(maxAmt)`
- **Ops/Gov** — `pause()`, `unpause()`, `updateParams(...)` (role‑gated)
- **Units** — `parse(number)`, `format(raw)`, and optional helpers mirroring ERC‑20 patterns

## Tuning `setDefaults` (parameters & suggested ranges)
`setDefaults` configures **future pools** created by the factory. Values are expressed in **basis points (BPS)** unless noted.

| Field         | Meaning                                                                 | Typical range (stable‑stable) | Typical range (volatile) | Notes |
|---------------|-------------------------------------------------------------------------|-------------------------------|--------------------------|-------|
| `baseFeeBps`  | Baseline swap fee applied regardless of volatility                      | 5–15 bps (0.05–0.15%)         | 20–40 bps (0.20–0.40%)   | Lower for deep, low‑vol markets; higher where MEV/latency risk is material. |
| `feeAlphaBps` | Responsiveness of dynamic fee to realized volatility (smoothing factor) | 100–200 bps                   | 300–800 bps              | Smaller = smoother/laggier; larger = more reactive. Tune with oracle cadence. |
| `lvl1Bps`     | Circuit‑breaker **level 1** trigger threshold (RV bucket)               | 50–100 bps (0.5–1.0%)         | 150–300 bps (1.5–3.0%)   | When exceeded → **size caps** apply (see `maxTxBps`). |
| `lvl2Bps`     | Circuit‑breaker **level 2** threshold                                   | 150–300 bps (1.5–3.0%)        | 300–600 bps (3–6%)       | When exceeded → may **restrict direction** (one‑way only). |
| `lvl3Bps`     | Circuit‑breaker **level 3** threshold                                   | 500–800 bps (5–8%)            | 800–1500 bps (8–15%)     | When exceeded → may **fully pause** swaps. |
| `maxTxBps`    | Per‑transaction **size cap** as % of pool reserves                      | 200–500 bps (2–5%)            | 100–300 bps (1–3%)       | Smaller pools should use **lower caps** to limit price impact. |

**Guidance**
- Start conservative, then **loosen** after observing a week of production traffic.  
- For **stable‑stable** pairs: bias towards **lower `baseFeeBps`** and **tighter caps**.  
- For **volatile** pairs: lift `baseFeeBps` and thresholds; keep `maxTxBps` modest to avoid large single‑trade shocks.  
- Ensure the **oracle window** and `feeAlphaBps` interact sensibly (don’t over‑react to single‑block noise).

> These are **practical starting points**, not hard rules. Your asset’s liquidity profile, oracle cadence (slot count/period), and MEV environment will shift the optimum.

## Best practices
- **Initial price equals initial ratio** — The very first `addLiquidity` ratio sets the initial price (existing liquidity fixes the price).
- **Slippage on the last hop only** — For multi‑hop, set `minOut` on the final hop; intermediate hops should pass with `minOut=0`.
- **Fee flushing** — If Splitter is down, fees accumulate as `pending` in the pool. Once healthy, run `flushFees/flushNative`.
- **Circuit breaker** — Depending on realized volatility and parameters, the pool may enforce size caps, directional limits, or full stops.
- **Unit safety** — Cache `decimals` and expose **Raw (bigint)** and **Human (string)** APIs to avoid unit mistakes.

## Troubleshooting
- **`pool missing`** — Ensure `createPool` was called; verify token order (sorted internally by helpers).
- **`expired`** — `deadline` is in the past. Use `Date.now()/1000 + 600`.
- **`slippage`** — `amount*Min` too strict. Take the quote and loosen by a few BPS.
- **`CB: paused / cap`** — Circuit breaker active (direction/size/full stop). Check parameters and reserves.
- **`transfer amount exceeds allowance`** — Missing `approve` to Router. Use `MaxUint256` (0→MAX pattern).
- **Flush failed** — Verify Splitter state. If `pending` grew, re‑flush after recovery.

## Tip: Common imports
```ts
import {
  AMM,
  Router,
  Pool
} from "@hazbase/amm";
```

## License
Apache‑2.0
