# @hazbase/amm
[![npm version](https://badge.fury.io/js/@hazbase%2Famm.svg)](https://badge.fury.io/js/@hazbase%2Famm)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Overview
`@hazbase/amm` is an SDK helper for working with the hazBase AMM stack: Factory, Router, and Circuit-Breaker-enabled Pool.
It streamlines pool creation, initial liquidity, quoting, single/multi-hop swaps, fee flushing, and circuit-breaker operations via thin, typed wrappers around `ethers` v6.

Highlights:
- Factory: `createPool`, `getPool`, `setDefaults`, `upgradeImplementation`
- Router: `addLiquidity`, `addLiquidityETH`, `removeLiquidity`, `swapExact*`, `quoteExactTokensForTokens`
- Pool: `mint`, `burn`, `quoteOut`, `quoteIn`, `currentRV`, `getReserves`, `flushFees`, `pause`, `updateParams`
- Unit helpers: `parse`, `format`, `balanceOf().format()`, and `allowance().format()` for reducing unit mistakes

## Requirements

- Node.js 18+
- `ethers` v6
- A signer for write methods, or a provider for view methods
- Deployed `AMMFactory`, `AMMRouter`, `CircuitBreakerAMM`, and `WNATIVE` contracts

## Example environment variables

The examples below assume these values are available in your environment:

```dotenv
RPC_URL=https://rpc.example.org
PRIVATE_KEY=0x...
TOKEN_A=0x...
TOKEN_B=0x...
```

## Installation

```bash
npm i @hazbase/amm ethers
```

## Quick Start

```ts
import { ethers } from "ethers";
import { AMM, Router, ERC20TokenHelper } from "@hazbase/amm";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const to = await signer.getAddress();

const chainId = 11155111;
const tokenA = ERC20TokenHelper.attach(process.env.TOKEN_A!, signer);
const tokenB = ERC20TokenHelper.attach(process.env.TOKEN_B!, signer);

const amm = new AMM(signer, chainId);
const router = new Router(signer, chainId);

const { pool: poolAddress } = await amm.createPool({
  tokenA: tokenA.address,
  tokenB: tokenB.address,
});
const pool = await amm.pool(tokenA.address, tokenB.address);

await tokenA.approve(router.address, ethers.MaxUint256);
await tokenB.approve(router.address, ethers.MaxUint256);

const amountADesired = await tokenA.parse("10000");
const amountBDesired = await tokenB.parse("1500000");

const added = await router.addLiquidity({
  pair: poolAddress,
  tokenA: tokenA.address,
  tokenB: tokenB.address,
  amountADesired,
  amountBDesired,
  amountAMin: 0n,
  amountBMin: 0n,
  to,
});

console.log("LP minted", await pool.format(added.liquidity));

const quote = await router.quoteExactTokensForTokens({
  amountIn: await tokenB.parse("150"),
  path: [tokenB.address, tokenA.address],
});
console.log("amountOut", await tokenA.format(quote.amountOut));
console.log("totalFeeAmount", quote.totalFeeAmount.toString());

const swap = await router.swapExactTokensForTokens({
  amountIn: await tokenB.parse("150"),
  amountOutMin: 1n,
  path: [tokenB.address, tokenA.address],
  to,
});
console.log("swapped", await tokenA.format(swap.amountOut));
```

## Network & factory selection

You can specify custom Factory and Router addresses when initializing AMM/Router helpers. If omitted, the SDK uses the default Factory and Router for the given `chainId` when available. This allows local devnets to pass freshly deployed addresses explicitly, while public networks can rely on curated defaults.

```ts
const amm = new AMM(signer, 11155111);
const router = new Router(signer, 11155111);

const ammCustom = new AMM(signer, undefined, "0xFactory");
const routerCustom = new Router(signer, undefined, "0xRouter");
```

If you override only one of them, make sure the Factory and Router belong to the same AMM deployment.

## API Reference

### `AMM`

- `new AMM(runner, chainId?, factoryAddress?)`
- `connect(runner): AMM`
- `createPool({ tokenA, tokenB }): Promise<{ pool, receipt }>`
- `getPool(tokenA, tokenB): Promise<Address>`
- `pool(tokenA, tokenB): Promise<Pool>`
- `setDefaults(defaults): Promise<TransactionReceipt>`
- `upgradeImplementation(newImpl): Promise<TransactionReceipt>`

`createPool` preserves the contract behavior: if a pool already exists, `AMMFactory.createPool` reverts. Use `getPool` first if you need an idempotent flow.

### `Router`

- `new Router(runner, chainId?, routerAddress?)`
- `connect(runner): Router`
- `addLiquidity(params): Promise<{ amountA, amountB, liquidity, receipt }>`
- `addLiquidityETH(params & { value }): Promise<{ amountToken, amountETH, liquidity, receipt }>`
- `removeLiquidity(params): Promise<{ amountA, amountB, receipt }>`
- `swapExactTokensForTokens(params): Promise<{ amountOut, receipt }>`
- `swapExactTokens(params): Promise<{ amountOut, receipt }>`
- `swapExactETHForTokens(params & { value? }): Promise<{ amountOut, receipt }>`
- `swapExactTokensForETH(params): Promise<{ amountOut, receipt }>`
- `quoteExactTokensForTokens({ amountIn, path }): Promise<{ amountOut, totalFeeAmount }>`

`quoteExactTokensForTokens` returns `{ amountOut, totalFeeAmount }`. It does not synthesize `totalFeeBps`; use pool-level `quoteOut` / `quoteIn` for per-hop fee bps. When `deadline` is omitted, the SDK uses the runner provider's latest block timestamp plus 600 seconds, falling back to wall-clock time only if no provider is available.

`swapExactETHForTokens` is available for deployments where the router/WNATIVE flow supports it. Test this path against your deployed router/WNATIVE pair before relying on it.

### `Pool`

- `Pool.attach(address, runner): Pool`
- `connect(runner): Pool`
- `tokens(): Promise<{ token0, token1 }>`
- `token0()`, `token1()`
- `getReserves(): Promise<{ reserve0, reserve1 }>`
- `pendingFee(token): Promise<bigint>`
- `pendingNative(): Promise<bigint>`
- `currentRV(): Promise<number>`
- `quoteOut({ amountIn, zeroForOne }): Promise<{ amountOut, feeBps, feeAmount }>`
- `quoteIn({ amountOut, zeroForOne }): Promise<{ amountIn, feeBps, feeAmount }>`
- `swapExactToken0ForToken1(params): Promise<{ amountOut, receipt }>`
- `swapExactToken1ForToken0(params): Promise<{ amountOut, receipt }>`
- `swapExactTokens(params): Promise<{ amountOut, receipt }>`
- `mint(to): Promise<{ liquidity, receipt }>`
- `burn(to): Promise<{ amount0, amount1, receipt }>`
- `flushFees(token, maxAmount?): Promise<TransactionReceipt>`
- `flushNative(maxAmount?): Promise<TransactionReceipt>`
- `pause()`, `unpause()`, `updateParams(params)`

`Pool` is also the LP ERC20 helper:

- `parse(amountHuman)`, `format(amountRaw)`
- `balanceOf(account).raw()`, `balanceOf(account).format()`
- `allowance(owner, spender).raw()`, `allowance(owner, spender).format()`
- `approve(spender, amount)`, `transfer(to, amount)`

Direct `Pool.mint` and `Pool.burn` are low-level contract methods. For `mint`, transfer both underlying tokens to the pool first. For `burn`, transfer LP tokens to the pool first. Normal application flows should prefer `Router.addLiquidity` and `Router.removeLiquidity`.

### `ERC20TokenHelper`

`ERC20TokenHelper.attach(address, runner)` provides lightweight unit and ERC20 helpers for AMM examples:

- `connect(runner)`
- `parse`, `format`, `name`, `symbol`, `decimals`
- `totalSupply`, `balanceOf`, `allowance`
- `approve`, `transfer`, `transferFrom`

## ETH Liquidity Example

```ts
await tokenA.approve(router.address, ethers.MaxUint256);

await router.addLiquidityETH({
  pair: poolAddress,
  token: tokenA.address,
  amountTokenDesired: await tokenA.parse("10000"),
  amountTokenMin: 0n,
  amountETHMin: ethers.parseEther("1"),
  value: ethers.parseEther("1"),
  to,
});
```

## Tuning `setDefaults` / `updateParams`

Values are basis points unless noted.

| Field | Meaning |
| --- | --- |
| `baseFeeBps` | Base swap fee. |
| `feeAlphaBps` | Dynamic fee coefficient applied to realized volatility. |
| `lvl1Bps` | Level 1 realized-volatility threshold; also used by the pool's base trade cap. |
| `lvl2Bps` | Level 2 threshold; may restrict direction. |
| `lvl3Bps` | Level 3 threshold; pauses swaps through circuit-breaker checks. |
| `maxTxBps` | Elevated-volatility max trade size. |

## Best practices

- Initial liquidity sets the initial pool price. Quote and review the ratio before the first `addLiquidity`.
- For swaps, set `amountOutMin` from a fresh quote plus your slippage tolerance.
- For multi-hop routes, enforce slippage on the final output amount.
- Approve the Router for normal liquidity and swap flows; approve or transfer directly to the Pool only when using low-level `Pool.mint` / `Pool.burn`.
- Use `pendingFee` / `pendingNative` before and after `flushFees` / `flushNative` when monitoring fee collection.
- Circuit-breaker parameters can cap size, restrict direction, or pause swaps under elevated volatility. Start conservatively and adjust after observing real traffic.

## Troubleshooting

- `pool exists`: `createPool` was called for an existing pair. Use `getPool` first.
- `pool missing`: no pool exists for a router path hop.
- `expired`: pass a future `deadline`, or omit it to use the SDK default of now + 600 seconds.
- `slippage`: loosen `amountOutMin`, `amountAMin`, or `amountBMin` after quoting.
- `CB: paused` / `CB: cap`: circuit-breaker thresholds or trade size blocked the operation.
- `transfer amount exceeds allowance`: approve the router or pool before the operation.

## License

Apache-2.0
