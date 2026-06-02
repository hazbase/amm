/* ------------------------------------------------------------------ */
/*  @hazbase/amm - Contract-first helpers for AMMFactory, Router, Pool */
/* ------------------------------------------------------------------ */

import { ethers, ContractRunner } from "ethers";
import type { BigNumberish, InterfaceAbi, TransactionReceipt } from "ethers";

import { AMMFactory_ABI } from "./abis/AMMFactory";
import { CircuitBreakerAMM_ABI } from "./abis/CircuitBreakerAMM";
import { AMMRouter_ABI } from "./abis/AMMRouter";
import { DEFAULT_FACTORY, DEFAULT_ROUTER } from "./constants";

export type Address = string;

export interface DefaultsParams {
  baseFeeBps: number;
  feeAlphaBps: number;
  lvl1Bps: number;
  lvl2Bps: number;
  lvl3Bps: number;
  maxTxBps: number;
}

export interface DeployPoolParams {
  tokenA: Address;
  tokenB: Address;
}

export interface CreatePoolResult {
  pool: Address;
  receipt: TransactionReceipt;
}

export interface SwapParams {
  amountIn: BigNumberish;
  amountOutMin: BigNumberish;
  path: readonly Address[];
  to: Address;
  deadline?: BigNumberish;
  value?: BigNumberish;
}

export interface QuoteParams {
  amountIn: BigNumberish;
  path: readonly Address[];
}

export interface AddLiquidityParams {
  pair: Address;
  tokenA: Address;
  tokenB: Address;
  amountADesired: BigNumberish;
  amountBDesired: BigNumberish;
  amountAMin: BigNumberish;
  amountBMin: BigNumberish;
  to: Address;
  deadline?: BigNumberish;
}

export interface AddLiquidityETHParams {
  pair: Address;
  token: Address;
  amountTokenDesired: BigNumberish;
  amountTokenMin: BigNumberish;
  amountETHMin: BigNumberish;
  to: Address;
  deadline?: BigNumberish;
  value: BigNumberish;
}

export interface RemoveLiquidityParams {
  pair: Address;
  liquidity: BigNumberish;
  tokenA: Address;
  tokenB: Address;
  amountAMin: BigNumberish;
  amountBMin: BigNumberish;
  to: Address;
  deadline?: BigNumberish;
}

export interface AddLiquidityResult {
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
  receipt: TransactionReceipt;
}

export interface AddLiquidityETHResult {
  amountToken: bigint;
  amountETH: bigint;
  liquidity: bigint;
  receipt: TransactionReceipt;
}

export interface RemoveLiquidityResult {
  amountA: bigint;
  amountB: bigint;
  receipt: TransactionReceipt;
}

export interface SwapResult {
  amountOut: bigint;
  receipt: TransactionReceipt;
}

export interface RouterQuoteResult {
  amountOut: bigint;
  totalFeeAmount: bigint;
}

export interface PoolQuoteOutParams {
  amountIn: BigNumberish;
  zeroForOne: boolean;
}

export interface PoolQuoteInParams {
  amountOut: BigNumberish;
  zeroForOne: boolean;
}

export interface PoolQuoteOutResult {
  amountOut: bigint;
  feeBps: number;
  feeAmount: bigint;
}

export interface PoolQuoteInResult {
  amountIn: bigint;
  feeBps: number;
  feeAmount: bigint;
}

export interface PoolSwapParams {
  amountIn: BigNumberish;
  amountOutMin: BigNumberish;
}

export interface PoolSwapExactTokensParams extends PoolSwapParams {
  path: readonly Address[];
}

export interface MintResult {
  liquidity: bigint;
  receipt: TransactionReceipt;
}

export interface BurnResult {
  amount0: bigint;
  amount1: bigint;
  receipt: TransactionReceipt;
}

export type AmountLike = PromiseLike<bigint> & {
  raw(): Promise<bigint>;
  format(): Promise<string>;
};

interface AmountFormatter {
  format(amountRaw: bigint | string): Promise<string>;
}

class AmountResult implements AmountLike {
  constructor(
    private readonly helper: AmountFormatter,
    private readonly rawPromise: Promise<bigint>,
  ) {}

  then<TResult1 = bigint, TResult2 = never>(
    onfulfilled?: ((value: bigint) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.rawPromise.then(onfulfilled as any, onrejected as any);
  }

  raw(): Promise<bigint> {
    return this.rawPromise;
  }

  async format(): Promise<string> {
    return this.helper.format(await this.rawPromise);
  }
}

const ERC20_ABI: InterfaceAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
];

const DEFAULT_DEADLINE_SECONDS = 600;

function toBigInt(value: unknown): bigint {
  return BigInt(value as bigint | string | number);
}

function toAddress(value: unknown): Address {
  return ethers.getAddress(value as string) as Address;
}

async function deadlineOrDefault(deadline: BigNumberish | undefined, runner: ContractRunner): Promise<BigNumberish> {
  if (deadline !== undefined) return deadline;

  try {
    const block = await runner.provider?.getBlock("latest");
    if (block) return BigInt(block.timestamp + DEFAULT_DEADLINE_SECONDS);
  } catch {
    // Fall back to wall-clock time for runner implementations without a provider.
  }

  return BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS);
}

function pathForCall(path: readonly Address[]): Address[] {
  if (path.length < 2) throw new Error("path too short");
  return path.map((addr) => ethers.getAddress(addr) as Address);
}

function resolveDefaultAddress(
  label: string,
  defaults: Record<number, string>,
  chainId?: number | Number,
  override?: Address,
): Address {
  if (override) return ethers.getAddress(override) as Address;
  const key = Number(chainId ?? 1);
  const addr = defaults[key];
  if (!addr) throw new Error(`No default ${label} configured for chainId ${key}`);
  return ethers.getAddress(addr) as Address;
}

async function waitForReceipt(tx: { wait(): Promise<TransactionReceipt | null> }): Promise<TransactionReceipt> {
  const receipt = await tx.wait();
  if (!receipt) throw new Error("transaction was not mined");
  return receipt;
}

abstract class UnitHelperBase implements AmountFormatter {
  protected _decimals?: number;
  protected _symbol?: string;
  protected _metaInit?: Promise<void>;

  protected abstract contract: ethers.Contract;

  protected amountOf(rawPromise: Promise<bigint>): AmountLike {
    return new AmountResult(this, rawPromise);
  }

  protected async ensureMeta(): Promise<void> {
    if (this._metaInit) return this._metaInit;
    this._metaInit = (async () => {
      try {
        const decimals = Number(await this.contract.decimals());
        this._decimals = Number.isFinite(decimals) ? decimals : 18;
      } catch {
        this._decimals = 18;
      }

      try {
        this._symbol = await this.contract.symbol();
      } catch {
        this._symbol = undefined;
      }
    })();
    return this._metaInit;
  }

  async parse(amountHuman: string | number | bigint): Promise<bigint> {
    await this.ensureMeta();
    return ethers.parseUnits(String(amountHuman), this._decimals!);
  }

  async format(amountRaw: bigint | string): Promise<string> {
    await this.ensureMeta();
    return ethers.formatUnits(amountRaw, this._decimals!);
  }

  async symbol(): Promise<string | undefined> {
    await this.ensureMeta();
    return this._symbol;
  }

  async decimals(): Promise<number> {
    await this.ensureMeta();
    return this._decimals!;
  }
}

export class ERC20TokenHelper extends UnitHelperBase {
  readonly address: Address;
  readonly runner: ContractRunner;
  readonly contract: ethers.Contract;

  private constructor(address: Address, runner: ContractRunner) {
    super();
    this.address = ethers.getAddress(address) as Address;
    this.runner = runner;
    this.contract = new ethers.Contract(this.address, ERC20_ABI, runner);
  }

  static attach(address: Address, runner: ContractRunner): ERC20TokenHelper {
    return new ERC20TokenHelper(address, runner);
  }

  connect(runner: ContractRunner): ERC20TokenHelper {
    if (runner === this.runner) return this;
    return new ERC20TokenHelper(this.address, runner);
  }

  async name(): Promise<string> {
    return this.contract.name() as Promise<string>;
  }

  totalSupply(): AmountLike {
    return this.amountOf(this.contract.totalSupply() as Promise<bigint>);
  }

  balanceOf(account: Address): AmountLike {
    return this.amountOf(this.contract.balanceOf(account) as Promise<bigint>);
  }

  allowance(owner: Address, spender: Address): AmountLike {
    return this.amountOf(this.contract.allowance(owner, spender) as Promise<bigint>);
  }

  async approve(spender: Address, amount: BigNumberish): Promise<TransactionReceipt> {
    const tx = await this.contract.approve(spender, amount);
    return waitForReceipt(tx);
  }

  async transfer(to: Address, amount: BigNumberish): Promise<TransactionReceipt> {
    const tx = await this.contract.transfer(to, amount);
    return waitForReceipt(tx);
  }

  async transferFrom(from: Address, to: Address, amount: BigNumberish): Promise<TransactionReceipt> {
    const tx = await this.contract.transferFrom(from, to, amount);
    return waitForReceipt(tx);
  }
}

/* ------------------------------------------------------------------ */
/*                        AMMFactory helper                            */
/* ------------------------------------------------------------------ */
export class AMM {
  readonly factory: ethers.Contract;
  readonly runner: ContractRunner;
  readonly address: Address;
  private readonly cache = new Map<string, Address>();

  constructor(runner: ContractRunner, chainId?: number | Number, factoryAddr?: Address) {
    const address = resolveDefaultAddress("AMMFactory", DEFAULT_FACTORY, chainId, factoryAddr);
    this.address = address;
    this.factory = new ethers.Contract(address, AMMFactory_ABI as InterfaceAbi, runner);
    this.runner = runner;
  }

  connect(runner: ContractRunner): AMM {
    if (runner === this.runner) return this;
    return new AMM(runner, undefined, this.address);
  }

  async createPool({ tokenA, tokenB }: DeployPoolParams): Promise<CreatePoolResult> {
    const pool = toAddress(await this.factory.createPool.staticCall(tokenA, tokenB));
    const tx = await this.factory.createPool(tokenA, tokenB);
    const receipt = await waitForReceipt(tx);
    this.cache.set(this.pairKey(tokenA, tokenB), pool);
    return { pool, receipt };
  }

  async getPool(tokenA: Address, tokenB: Address): Promise<Address> {
    const key = this.pairKey(tokenA, tokenB);
    if (this.cache.has(key)) return this.cache.get(key)!;
    const addr = toAddress(await this.factory.getPool(tokenA, tokenB));
    if (addr !== ethers.ZeroAddress) this.cache.set(key, addr);
    return addr;
  }

  async pool(tokenA: Address, tokenB: Address): Promise<Pool> {
    const addr = await this.getPool(tokenA, tokenB);
    if (addr === ethers.ZeroAddress) throw new Error("Pool not found");
    return Pool.attach(addr, this.runner);
  }

  async upgradeImplementation(newImpl: Address): Promise<TransactionReceipt> {
    const tx = await this.factory.upgradeImplementation(newImpl);
    return waitForReceipt(tx);
  }

  async setDefaults(defaults: DefaultsParams): Promise<TransactionReceipt> {
    const tx = await this.factory.setDefaults(defaults);
    return waitForReceipt(tx);
  }

  private pairKey(a: Address, b: Address): string {
    const [token0, token1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return ethers.solidityPackedKeccak256(["address", "address"], [token0, token1]);
  }
}

/* ------------------------------------------------------------------ */
/*                           Pool helper                               */
/* ------------------------------------------------------------------ */
export class Pool extends UnitHelperBase {
  readonly address: Address;
  readonly runner: ContractRunner;
  readonly contract: ethers.Contract;

  private constructor(address: Address, runner: ContractRunner) {
    super();
    this.address = ethers.getAddress(address) as Address;
    this.runner = runner;
    this.contract = new ethers.Contract(this.address, CircuitBreakerAMM_ABI as InterfaceAbi, runner);
  }

  static attach(address: Address, runner: ContractRunner): Pool {
    return new Pool(address, runner);
  }

  connect(runner: ContractRunner): Pool {
    if (runner === this.runner) return this;
    return new Pool(this.address, runner);
  }

  async name(): Promise<string> {
    return this.contract.name() as Promise<string>;
  }

  totalSupply(): AmountLike {
    return this.amountOf(this.contract.totalSupply() as Promise<bigint>);
  }

  balanceOf(account: Address): AmountLike {
    return this.amountOf(this.contract.balanceOf(account) as Promise<bigint>);
  }

  allowance(owner: Address, spender: Address): AmountLike {
    return this.amountOf(this.contract.allowance(owner, spender) as Promise<bigint>);
  }

  async approve(spender: Address, amount: BigNumberish): Promise<TransactionReceipt> {
    const tx = await this.contract.approve(spender, amount);
    return waitForReceipt(tx);
  }

  async transfer(to: Address, amount: BigNumberish): Promise<TransactionReceipt> {
    const tx = await this.contract.transfer(to, amount);
    return waitForReceipt(tx);
  }

  async tokens(): Promise<{ token0: Address; token1: Address }> {
    const [token0, token1] = await this.contract.tokens();
    return { token0: toAddress(token0), token1: toAddress(token1) };
  }

  async token0(): Promise<Address> {
    return toAddress(await this.contract.token0());
  }

  async token1(): Promise<Address> {
    return toAddress(await this.contract.token1());
  }

  async getReserves(): Promise<{ reserve0: bigint; reserve1: bigint }> {
    const [reserve0, reserve1] = await this.contract.getReserves();
    return { reserve0: toBigInt(reserve0), reserve1: toBigInt(reserve1) };
  }

  async reserves(): Promise<{ r0: bigint; r1: bigint }> {
    const { reserve0, reserve1 } = await this.getReserves();
    return { r0: reserve0, r1: reserve1 };
  }

  async currentRV(): Promise<number> {
    return Number(await this.contract.currentRV());
  }

  async pendingFee(token: Address): Promise<bigint> {
    return toBigInt(await this.contract.pendingFee(token));
  }

  async pendingNative(): Promise<bigint> {
    return toBigInt(await this.contract.pendingNative());
  }

  async quoteOut({ amountIn, zeroForOne }: PoolQuoteOutParams): Promise<PoolQuoteOutResult> {
    const [amountOut, feeBps, feeAmount] = await this.contract.quoteOut(amountIn, zeroForOne);
    return { amountOut: toBigInt(amountOut), feeBps: Number(feeBps), feeAmount: toBigInt(feeAmount) };
  }

  async quoteIn({ amountOut, zeroForOne }: PoolQuoteInParams): Promise<PoolQuoteInResult> {
    const [amountIn, feeBps, feeAmount] = await this.contract.quoteIn(amountOut, zeroForOne);
    return { amountIn: toBigInt(amountIn), feeBps: Number(feeBps), feeAmount: toBigInt(feeAmount) };
  }

  async quoteExactTokens({ amountIn, path }: QuoteParams): Promise<PoolQuoteOutResult> {
    const zeroForOne = await this.direction(pathForCall(path));
    return this.quoteOut({ amountIn, zeroForOne });
  }

  async swapExactToken0ForToken1(params: PoolSwapParams): Promise<SwapResult> {
    const amountOut = toBigInt(
      await this.contract.swapExactToken0ForToken1.staticCall(params.amountIn, params.amountOutMin),
    );
    const tx = await this.contract.swapExactToken0ForToken1(params.amountIn, params.amountOutMin);
    return { amountOut, receipt: await waitForReceipt(tx) };
  }

  async swapExactToken1ForToken0(params: PoolSwapParams): Promise<SwapResult> {
    const amountOut = toBigInt(
      await this.contract.swapExactToken1ForToken0.staticCall(params.amountIn, params.amountOutMin),
    );
    const tx = await this.contract.swapExactToken1ForToken0(params.amountIn, params.amountOutMin);
    return { amountOut, receipt: await waitForReceipt(tx) };
  }

  async swapExactTokens({ amountIn, amountOutMin, path }: PoolSwapExactTokensParams): Promise<SwapResult> {
    const zeroForOne = await this.direction(pathForCall(path));
    return zeroForOne
      ? this.swapExactToken0ForToken1({ amountIn, amountOutMin })
      : this.swapExactToken1ForToken0({ amountIn, amountOutMin });
  }

  async mint(to: Address): Promise<MintResult> {
    const liquidity = toBigInt(await this.contract.mint.staticCall(to));
    const tx = await this.contract.mint(to);
    return { liquidity, receipt: await waitForReceipt(tx) };
  }

  async burn(to: Address): Promise<BurnResult> {
    const [amount0, amount1] = await this.contract.burn.staticCall(to);
    const tx = await this.contract.burn(to);
    return { amount0: toBigInt(amount0), amount1: toBigInt(amount1), receipt: await waitForReceipt(tx) };
  }

  async flushFees(token: Address, maxAmount: BigNumberish = 0n): Promise<TransactionReceipt> {
    const tx = await this.contract.flushFees(token, maxAmount);
    return waitForReceipt(tx);
  }

  async flushNative(maxAmount: BigNumberish = 0n): Promise<TransactionReceipt> {
    const tx = await this.contract.flushNative(maxAmount);
    return waitForReceipt(tx);
  }

  async pause(): Promise<TransactionReceipt> {
    const tx = await this.contract.pause();
    return waitForReceipt(tx);
  }

  async unpause(): Promise<TransactionReceipt> {
    const tx = await this.contract.unpause();
    return waitForReceipt(tx);
  }

  async updateParams(params: DefaultsParams): Promise<TransactionReceipt> {
    const tx = await this.contract.updateParams(
      params.baseFeeBps,
      params.feeAlphaBps,
      params.lvl1Bps,
      params.lvl2Bps,
      params.lvl3Bps,
      params.maxTxBps,
    );
    return waitForReceipt(tx);
  }

  private async direction(path: readonly Address[]): Promise<boolean> {
    if (path.length !== 2) throw new Error("Pool operations expect a 2-token path");
    const { token0, token1 } = await this.tokens();
    const input = ethers.getAddress(path[0]);
    const output = ethers.getAddress(path[1]);
    if (input === token0 && output === token1) return true;
    if (input === token1 && output === token0) return false;
    throw new Error("path does not match pool tokens");
  }
}

/* ------------------------------------------------------------------ */
/*                          Router helper                              */
/* ------------------------------------------------------------------ */
export class Router {
  readonly contract: ethers.Contract;
  readonly runner: ContractRunner;
  readonly address: Address;

  constructor(runner: ContractRunner, chainId?: number | Number, routerAddr?: Address) {
    const address = resolveDefaultAddress("AMMRouter", DEFAULT_ROUTER, chainId, routerAddr);
    this.contract = new ethers.Contract(address, AMMRouter_ABI as InterfaceAbi, runner);
    this.runner = runner;
    this.address = address;
  }

  connect(runner: ContractRunner): Router {
    if (runner === this.runner) return this;
    return new Router(runner, undefined, this.address);
  }

  async addLiquidity(params: AddLiquidityParams): Promise<AddLiquidityResult> {
    const deadline = await deadlineOrDefault(params.deadline, this.runner);
    const [amountA, amountB, liquidity] = await this.contract.addLiquidity.staticCall(
      params.pair,
      params.tokenA,
      params.tokenB,
      params.amountADesired,
      params.amountBDesired,
      params.amountAMin,
      params.amountBMin,
      params.to,
      deadline,
    );
    const tx = await this.contract.addLiquidity(
      params.pair,
      params.tokenA,
      params.tokenB,
      params.amountADesired,
      params.amountBDesired,
      params.amountAMin,
      params.amountBMin,
      params.to,
      deadline,
    );
    return {
      amountA: toBigInt(amountA),
      amountB: toBigInt(amountB),
      liquidity: toBigInt(liquidity),
      receipt: await waitForReceipt(tx),
    };
  }

  async addLiquidityETH(params: AddLiquidityETHParams): Promise<AddLiquidityETHResult> {
    const deadline = await deadlineOrDefault(params.deadline, this.runner);
    const value = params.value;
    const [amountToken, amountETH, liquidity] = await this.contract.addLiquidityETH.staticCall(
      params.pair,
      params.token,
      params.amountTokenDesired,
      params.amountTokenMin,
      params.amountETHMin,
      params.to,
      deadline,
      { value },
    );
    const tx = await this.contract.addLiquidityETH(
      params.pair,
      params.token,
      params.amountTokenDesired,
      params.amountTokenMin,
      params.amountETHMin,
      params.to,
      deadline,
      { value },
    );
    return {
      amountToken: toBigInt(amountToken),
      amountETH: toBigInt(amountETH),
      liquidity: toBigInt(liquidity),
      receipt: await waitForReceipt(tx),
    };
  }

  async removeLiquidity(params: RemoveLiquidityParams): Promise<RemoveLiquidityResult> {
    const deadline = await deadlineOrDefault(params.deadline, this.runner);
    const [amountA, amountB] = await this.contract.removeLiquidity.staticCall(
      params.pair,
      params.liquidity,
      params.tokenA,
      params.tokenB,
      params.amountAMin,
      params.amountBMin,
      params.to,
      deadline,
    );
    const tx = await this.contract.removeLiquidity(
      params.pair,
      params.liquidity,
      params.tokenA,
      params.tokenB,
      params.amountAMin,
      params.amountBMin,
      params.to,
      deadline,
    );
    return { amountA: toBigInt(amountA), amountB: toBigInt(amountB), receipt: await waitForReceipt(tx) };
  }

  async swapExactTokensForTokens(params: SwapParams): Promise<SwapResult> {
    const path = pathForCall(params.path);
    const deadline = await deadlineOrDefault(params.deadline, this.runner);
    const amountOut = toBigInt(
      await this.contract.swapExactTokensForTokens.staticCall(
        params.amountIn,
        params.amountOutMin,
        path,
        params.to,
        deadline,
      ),
    );
    const tx = await this.contract.swapExactTokensForTokens(
      params.amountIn,
      params.amountOutMin,
      path,
      params.to,
      deadline,
    );
    return { amountOut, receipt: await waitForReceipt(tx) };
  }

  async swapExactTokens(params: SwapParams): Promise<SwapResult> {
    return this.swapExactTokensForTokens(params);
  }

  async swapExactETHForTokens(params: SwapParams): Promise<SwapResult> {
    const path = pathForCall(params.path);
    const deadline = await deadlineOrDefault(params.deadline, this.runner);
    const value = params.value ?? params.amountIn;
    const amountOut = toBigInt(
      await this.contract.swapExactETHForTokens.staticCall(params.amountOutMin, path, params.to, deadline, { value }),
    );
    const tx = await this.contract.swapExactETHForTokens(params.amountOutMin, path, params.to, deadline, { value });
    return { amountOut, receipt: await waitForReceipt(tx) };
  }

  async swapExactTokensForETH(params: SwapParams): Promise<SwapResult> {
    const path = pathForCall(params.path);
    const deadline = await deadlineOrDefault(params.deadline, this.runner);
    const amountOut = toBigInt(
      await this.contract.swapExactTokensForETH.staticCall(
        params.amountIn,
        params.amountOutMin,
        path,
        params.to,
        deadline,
      ),
    );
    const tx = await this.contract.swapExactTokensForETH(
      params.amountIn,
      params.amountOutMin,
      path,
      params.to,
      deadline,
    );
    return { amountOut, receipt: await waitForReceipt(tx) };
  }

  async quoteExactTokensForTokens({ amountIn, path }: QuoteParams): Promise<RouterQuoteResult> {
    const [amountOut, totalFeeAmount] = await this.contract.quoteExactTokensForTokens(amountIn, pathForCall(path));
    return { amountOut: toBigInt(amountOut), totalFeeAmount: toBigInt(totalFeeAmount) };
  }
}
