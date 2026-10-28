/**
 * ubiquity/arbitrage-bot#3 ($600) & ubiquity/arbitrage-bot#7 ($400)
 * - #3: Single-chain UUSD peg arbitrage via LibUbiquityPool ($1.00 mint/redeem vs Curve secondary market)
 * - #7: Multi-chain Curve arbitrage between Ethereum Mainnet (`factory-stable-ng-164`) and Gnosis Chain (`factory-stable-ng-29`)
 *       including 5-step cross-chain bridge routing and gas profitability gating.
 */

export const CURVE_MAINNET_UUSD_POOL = "factory-stable-ng-164";
export const CURVE_GNOSIS_UUSD_POOL = "factory-stable-ng-29";
export const UBQ_POOL_DIAMOND_MAINNET = "0xED3084c98148e2528DaDCB53C56352e549C488fA";

export type SingleChainArbDirection = "MINT_AND_SELL_ON_CURVE" | "BUY_ON_CURVE_AND_REDEEM" | "NO_OP";

export interface SingleChainOpportunity {
  direction: SingleChainArbDirection;
  curveUusdPriceUsd: number;
  tradeSizeUsd: number;
  grossProfitUsd: number;
  estimatedGasUsd: number;
  netProfitUsd: number;
  shouldExecute: boolean;
  steps: string[];
}

export interface MultiChainPoolSnapshot {
  mainnetUusdPriceUsd: number; // e.g. 1.00 on Curve Mainnet factory-stable-ng-164
  gnosisUusdPriceUsd: number;  // e.g. 0.97 on Curve Gnosis factory-stable-ng-29
  tradeSizeUsd: number;
  mainnetGasUsd: number;
  gnosisGasUsd: number;
  bridgeFeeUsd: number;
  slippageBps?: number;
  minNetProfitUsd?: number;
}

export interface MultiChainArbPlan {
  route: "GNOSIS_TO_MAINNET" | "MAINNET_TO_GNOSIS" | "NO_OP";
  uusdPurchased: number;
  grossReturnUsd: number;
  totalCostsUsd: number;
  netProfitUsd: number;
  shouldExecute: boolean;
  steps: string[];
}

/**
 * ubiquity/arbitrage-bot#3 ($600): Single-chain peg arbitrage against LibUbiquityPool
 */
export function evaluateSingleChainPegArbitrage(params: {
  curveUusdPriceUsd: number;
  tradeSizeUsd: number;
  estimatedGasUsd: number;
  minNetProfitUsd?: number;
}): SingleChainOpportunity {
  const { curveUusdPriceUsd, tradeSizeUsd, estimatedGasUsd } = params;
  const minNetProfitUsd = params.minNetProfitUsd ?? 1.0;

  if (curveUusdPriceUsd > 1.0) {
    // UUSD > $1.00: Mint 1 UUSD per $1 LUSD in LibUbiquityPool, sell UUSD on Curve for > $1
    const grossProfitUsd = tradeSizeUsd * (curveUusdPriceUsd - 1.0);
    const netProfitUsd = Number((grossProfitUsd - estimatedGasUsd).toFixed(4));
    const shouldExecute = netProfitUsd >= minNetProfitUsd;
    return {
      direction: shouldExecute ? "MINT_AND_SELL_ON_CURVE" : "NO_OP",
      curveUusdPriceUsd,
      tradeSizeUsd,
      grossProfitUsd: Number(grossProfitUsd.toFixed(4)),
      estimatedGasUsd,
      netProfitUsd,
      shouldExecute,
      steps: [
        `Mint ${tradeSizeUsd.toFixed(2)} UUSD using ${tradeSizeUsd.toFixed(2)} LUSD in LibUbiquityPool (${UBQ_POOL_DIAMOND_MAINNET})`,
        `Swap ${tradeSizeUsd.toFixed(2)} UUSD on Curve (${CURVE_MAINNET_UUSD_POOL}) for ${(tradeSizeUsd * curveUusdPriceUsd).toFixed(2)} LUSD`,
      ],
    };
  }

  if (curveUusdPriceUsd < 1.0) {
    // UUSD < $1.00: Buy discounted UUSD on Curve, redeem each 1 UUSD for $1.00 LUSD collateral in LibUbiquityPool
    const uusdBought = tradeSizeUsd / curveUusdPriceUsd;
    const grossProfitUsd = uusdBought * 1.0 - tradeSizeUsd;
    const netProfitUsd = Number((grossProfitUsd - estimatedGasUsd).toFixed(4));
    const shouldExecute = netProfitUsd >= minNetProfitUsd;
    return {
      direction: shouldExecute ? "BUY_ON_CURVE_AND_REDEEM" : "NO_OP",
      curveUusdPriceUsd,
      tradeSizeUsd,
      grossProfitUsd: Number(grossProfitUsd.toFixed(4)),
      estimatedGasUsd,
      netProfitUsd,
      shouldExecute,
      steps: [
        `Buy ${uusdBought.toFixed(2)} UUSD on Curve (${CURVE_MAINNET_UUSD_POOL}) using ${tradeSizeUsd.toFixed(2)} LUSD`,
        `Redeem ${uusdBought.toFixed(2)} UUSD in LibUbiquityPool (${UBQ_POOL_DIAMOND_MAINNET}) for ${uusdBought.toFixed(2)} LUSD`,
      ],
    };
  }

  return {
    direction: "NO_OP",
    curveUusdPriceUsd,
    tradeSizeUsd,
    grossProfitUsd: 0,
    estimatedGasUsd,
    netProfitUsd: -estimatedGasUsd,
    shouldExecute: false,
    steps: [],
  };
}

/**
 * ubiquity/arbitrage-bot#7 ($400): Multi-Chain Curve Arbitrage (Mainnet factory-stable-ng-164 <-> Gnosis factory-stable-ng-29)
 */
export function evaluateMultiChainArbitrage(snapshot: MultiChainPoolSnapshot): MultiChainArbPlan {
  const {
    mainnetUusdPriceUsd,
    gnosisUusdPriceUsd,
    tradeSizeUsd,
    mainnetGasUsd,
    gnosisGasUsd,
    bridgeFeeUsd,
  } = snapshot;
  const slippageFactor = 1 - (snapshot.slippageBps ?? 15) / 10_000;
  const minNetProfitUsd = snapshot.minNetProfitUsd ?? 2.0;
  const totalCostsUsd = Number((mainnetGasUsd + gnosisGasUsd + bridgeFeeUsd).toFixed(4));

  if (gnosisUusdPriceUsd < mainnetUusdPriceUsd) {
    // Buy discounted UUSD on Gnosis (factory-stable-ng-29), bridge to Mainnet, sell on Mainnet (factory-stable-ng-164)
    const uusdPurchased = (tradeSizeUsd / gnosisUusdPriceUsd) * slippageFactor;
    const grossReturnUsd = uusdPurchased * mainnetUusdPriceUsd * slippageFactor;
    const netProfitUsd = Number((grossReturnUsd - tradeSizeUsd - totalCostsUsd).toFixed(4));
    const shouldExecute = netProfitUsd >= minNetProfitUsd;
    return {
      route: shouldExecute ? "GNOSIS_TO_MAINNET" : "NO_OP",
      uusdPurchased: Number(uusdPurchased.toFixed(4)),
      grossReturnUsd: Number(grossReturnUsd.toFixed(4)),
      totalCostsUsd,
      netProfitUsd,
      shouldExecute,
      steps: [
        `1. Bridge ${tradeSizeUsd.toFixed(2)} DAI from Mainnet to Gnosis Chain as xDAI`,
        `2. Wrap ${tradeSizeUsd.toFixed(2)} xDAI into WXDAI on Gnosis Chain`,
        `3. Swap WXDAI for ${uusdPurchased.toFixed(2)} UUSD in Gnosis Curve pool (${CURVE_GNOSIS_UUSD_POOL})`,
        `4. Bridge ${uusdPurchased.toFixed(2)} UUSD from Gnosis Chain to Ethereum Mainnet`,
        `5. Swap ${uusdPurchased.toFixed(2)} UUSD for ${grossReturnUsd.toFixed(2)} LUSD in Mainnet Curve pool (${CURVE_MAINNET_UUSD_POOL})`,
      ],
    };
  }

  if (mainnetUusdPriceUsd < gnosisUusdPriceUsd) {
    const uusdPurchased = (tradeSizeUsd / mainnetUusdPriceUsd) * slippageFactor;
    const grossReturnUsd = uusdPurchased * gnosisUusdPriceUsd * slippageFactor;
    const netProfitUsd = Number((grossReturnUsd - tradeSizeUsd - totalCostsUsd).toFixed(4));
    const shouldExecute = netProfitUsd >= minNetProfitUsd;
    return {
      route: shouldExecute ? "MAINNET_TO_GNOSIS" : "NO_OP",
      uusdPurchased: Number(uusdPurchased.toFixed(4)),
      grossReturnUsd: Number(grossReturnUsd.toFixed(4)),
      totalCostsUsd,
      netProfitUsd,
      shouldExecute,
      steps: [
        `1. Swap ${tradeSizeUsd.toFixed(2)} LUSD for ${uusdPurchased.toFixed(2)} UUSD in Mainnet Curve pool (${CURVE_MAINNET_UUSD_POOL})`,
        `2. Bridge ${uusdPurchased.toFixed(2)} UUSD from Ethereum Mainnet to Gnosis Chain`,
        `3. Swap ${uusdPurchased.toFixed(2)} UUSD for ${grossReturnUsd.toFixed(2)} WXDAI in Gnosis Curve pool (${CURVE_GNOSIS_UUSD_POOL})`,
      ],
    };
  }

  return {
    route: "NO_OP",
    uusdPurchased: 0,
    grossReturnUsd: tradeSizeUsd,
    totalCostsUsd,
    netProfitUsd: -totalCostsUsd,
    shouldExecute: false,
    steps: [],
  };
}
