/* ------------------------------------------------------------------ */
/*  @hazbase/amm – Helpers (AMM = Factory, Pool = pair, Router = hub) */
/*  SmartWallet‑style fluent API, single file export.                 */
/* ------------------------------------------------------------------ */

import {
  ethers,
  ContractRunner,
  AbiCoder,
} from "ethers";
import type { InterfaceAbi } from "ethers";

import { AMMFactory_ABI }       from "./abis/AMMFactory";
import { CircuitBreakerAMM_ABI } from "./abis/CircuitBreakerAMM";
import { AMMRouter_ABI }        from "./abis/AMMRouter";
import { DEFAULT_FACTORY, DEFAULT_ROUTER } from "./constants";

/************************
 *      Type Aliases    *
 ************************/
export type Address = string;

export interface DeployPoolParams {
  tokenA   : Address;
  tokenB   : Address;
}
export interface LiquidityParams {
  amountA : bigint;
  amountB : bigint;
  to      : Address;
}
export interface SwapParams {
  amountIn     : bigint;
  amountOutMin : bigint;
  path         : readonly Address[]; // len>=2
  to           : Address;
  value?       : bigint;            // for ETH paths
  deadline?    : bigint;
  input?       : Address;
}

export interface QuoteParams {
  amountIn     : bigint;
  path         : readonly Address[]; // len>=2
  input?       : Address;
}

/* ------------------------------------------------------------------ */
/*                        AMM (Factory helper)                         */
/* ------------------------------------------------------------------ */
export class AMM {
  readonly factory: ethers.Contract;
  readonly runner : ContractRunner;
  private cache   : Map<string, Address> = new Map();

  /**
   * @param runner signer or provider
   * @param factoryAddr optional factory address; defaults to DEFAULT_FACTORY
   * @param chainId chainId
   */
  constructor(runner: ContractRunner, chainId?: Number, _factoryAddr?: Address) {
    const factoryAddr = _factoryAddr || DEFAULT_FACTORY[Number(chainId ?? 1)];
    this.factory = new ethers.Contract(
      factoryAddr,
      AMMFactory_ABI as InterfaceAbi,
      runner
    );
    this.runner = runner;
  }

  /* ---------- Pool management ---------- */
  async createPool({ tokenA, tokenB }: DeployPoolParams): Promise<Address> {
    const tx = await this.factory.createPool(tokenA, tokenB);
    const rc = await tx.wait();
    const topic = (this.factory.interface.getEvent("PoolCreated")?.topicHash) as string;
    const evt   = rc.logs.find((l: any) => l.topics[0] === topic);
    const [, , pool] = this.factory.interface.decodeEventLog("PoolCreated", evt!.data, evt!.topics);
    const key = this._pairKey(tokenA, tokenB);
    this.cache.set(key, pool as Address);
    return pool as Address;
  }

  async getPool(tokenA: Address, tokenB: Address): Promise<Address> {
    const key = this._pairKey(tokenA, tokenB);
    if (this.cache.has(key)) return this.cache.get(key)!;
    const addr: Address = await this.factory.getPool(tokenA, tokenB);
    if (addr !== ethers.ZeroAddress) this.cache.set(key, addr);
    return addr;
  }

  async pool(tokenA: Address, tokenB: Address): Promise<Pool> {
    const addr = await this.getPool(tokenA, tokenB);
    if (addr === ethers.ZeroAddress) throw new Error("Pool not found");
    return Pool.attach(addr, this.runner);
  }

  async upgradeImplementation(newImpl: Address): Promise<Address>{
    const tx = await this.factory.upgradeImplementation(newImpl);
    return tx.wait();
  }

  async setDefaults(d: {
    baseFeeBps: number;
    feeAlphaBps: number;
    lvl1Bps: number;
    lvl2Bps: number;
    lvl3Bps: number;
    maxTxBps: number;
  }) {
    const tx = await this.factory.setDefaults(d);
    return tx.wait();
  }

  private _pairKey(a: Address, b: Address) {
    return ethers.keccak256(
      AbiCoder.defaultAbiCoder().encode([
        "address", "address"], a < b ? [a, b] : [b, a])
    );
  }
}

/* ------------------------------------------------------------------ */
/*                           Pool helper                               */
/* ------------------------------------------------------------------ */
export class Pool {
  readonly address : Address;
  readonly contract: ethers.Contract;

  private constructor(addr: Address, runner: ContractRunner) {
    this.address  = ethers.getAddress(addr);
    this.contract = new ethers.Contract(
      this.address,
      CircuitBreakerAMM_ABI as InterfaceAbi,
      runner
    );
  }

  static attach(addr: Address, runner: ContractRunner) { return new Pool(addr, runner); }

  /* ----- single hop swap with return value ----- */
  async swapExactTokens({ amountIn, amountOutMin, path, to }: SwapParams): Promise<bigint> {
    if (path.length !== 2) throw new Error("Pool.swap expects 2‑token path");
    const t0 = await this.contract.token0();
    const zeroForOne = path[0].toLowerCase() === t0.toLowerCase();
    const fn = zeroForOne ? "swapExactToken0ForToken1" : "swapExactToken1ForToken0";
    const tx = await this.contract[fn](amountIn, amountOutMin, { from: to });
    const rc = await tx.wait();
    
    return BigInt(rc.logs[1].data); // Swap(amountOut)
  }

  async quoteExactTokens({ amountIn, path, input }: QuoteParams): Promise<{amount: string, bps: number, fee: string}> {
    if (path.length !== 2) throw new Error("Pool.swap expects 2‑token path");
    const t0 = await this.contract.token0();
    const zeroForOne = path[0].toLowerCase() === t0.toLowerCase();
    let fn;
    if( zeroForOne ) fn = input?.toLowerCase() === t0.toLowerCase()? "quoteOut" : "quoteIn";
    else fn = input?.toLowerCase() === t0.toLowerCase()? "quoteIn" : "quoteOut";
    const [amountOut, feeBps, feeAmt] = await this.contract[fn](amountIn, zeroForOne);
    
    return {
      amount: amountOut,
      bps: (Number(feeBps) / 1000),
      fee: feeAmt
    };
  }

  /* ----- views ----- */
  async currentRV(): Promise<number> { return Number(await this.contract.currentRV()); }
  
  async reserves(): Promise<{ r0: bigint; r1: bigint }> {
    const [r0, r1] = await this.contract.getReserves();
    return { r0, r1 };
  }
}

/* ------------------------------------------------------------------ */
/*                          Router helper                              */
/* ------------------------------------------------------------------ */
export class Router {
  readonly contract: ethers.Contract;
  readonly runner  : ContractRunner;
  readonly address : Address;

  constructor(runner: ContractRunner, chainId?: Number, _routerAddr?: Address) {
    const routerAddr = _routerAddr || DEFAULT_ROUTER[Number(chainId ?? 1)];
    this.contract = new ethers.Contract(routerAddr, AMMRouter_ABI as InterfaceAbi, runner);
    this.runner   = runner;
    this.address  = routerAddr;
  }

  /* ---- swapExactTokensForTokens (multi‑hop) ---- */
  async swapExactTokens(p: SwapParams) {
    if (p.path.length < 2) throw new Error("path too short");
    const tx = await this.contract.swapExactTokensForTokens(
      p.amountIn, p.amountOutMin, p.path, p.to,
      p.deadline ?? BigInt(Math.floor(Date.now()/1000) + 600)
    );
    return tx.wait();
  }

  /* ---- ETH wrappers ---- */
  async swapExactETHForTokens(p: SwapParams) {
    const tx = await this.contract.swapExactETHForTokens(
      p.amountOutMin, p.path, p.to,
      p.deadline ?? BigInt(Math.floor(Date.now()/1000) + 600),
      { value: p.value ?? p.amountIn }
    );
    return tx.wait();
  }

  async swapExactTokensForETH(p: SwapParams) {
    const tx = await this.contract.swapExactTokensForETH(
      p.amountIn, p.amountOutMin, p.path, p.to,
      p.deadline ?? BigInt(Math.floor(Date.now()/1000) + 600)
    );
    return tx.wait();
  }

  async addLiquidityETH(p: {
    pair: Address;
    token: Address;
    amountTokenDesired: bigint;
    amountTokenMin: bigint;
    amountETHMin: bigint;
    to: Address;
    deadline?: bigint;
    value?: bigint; // ETH value to send
  }) {
    // NOTE: deadline default = now + 600s
    const tx = await this.contract.addLiquidityETH(
      p.pair, p.token,
      p.amountTokenDesired, p.amountTokenMin, p.amountETHMin,
      p.to,
      p.deadline ?? BigInt(Math.floor(Date.now()/1000) + 600),
      { value: p.value ?? p.amountETHMin }
    );
    return tx.wait();
  }

  async addLiquidity(p: {
    pair: Address;
    tokenA: Address;
    tokenB: Address;
    amountADesired: bigint;
    amountBDesired: bigint;
    amountAMin: bigint;
    amountBMin: bigint;
    to: Address;
    deadline?: bigint;
  }) {
    // NOTE: deadline default = now + 600s
    const tx = await this.contract.addLiquidity(
      p.pair, p.tokenA, p.tokenB,
      p.amountADesired, p.amountBDesired,
      p.amountAMin, p.amountBMin,
      p.to,
      p.deadline ?? BigInt(Math.floor(Date.now()/1000) + 600)
    );
    return tx.wait();
  }

  /* ---- View ---- */
  async quoteExactTokensForTokens({amountIn, path}: QuoteParams) {
    const [amountOut, totalFee] = await this.contract.quoteExactTokensForTokens(amountIn, path);
    return {
      amount: amountOut,
      fee: totalFee
    };
  }
}
