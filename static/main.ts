import {
  CURVE_GNOSIS_UUSD_POOL,
  CURVE_MAINNET_UUSD_POOL,
  UBQ_POOL_DIAMOND_MAINNET,
  evaluateMultiChainArbitrage,
  evaluateSingleChainPegArbitrage,
} from "../src/arbitrage-engine";

export async function mainModule() {
  const singleChain = evaluateSingleChainPegArbitrage({
    curveUusdPriceUsd: 0.97,
    tradeSizeUsd: 1000,
    estimatedGasUsd: 2.5,
  });
  const multiChain = evaluateMultiChainArbitrage({
    mainnetUusdPriceUsd: 1.0,
    gnosisUusdPriceUsd: 0.97,
    tradeSizeUsd: 1000,
    mainnetGasUsd: 3.0,
    gnosisGasUsd: 0.05,
    bridgeFeeUsd: 1.5,
  });
  console.log(
    `Arbitrage initialized (${CURVE_MAINNET_UUSD_POOL} <-> ${CURVE_GNOSIS_UUSD_POOL}, diamond ${UBQ_POOL_DIAMOND_MAINNET})`,
    { singleChainDirection: singleChain.direction, multiChainRoute: multiChain.route }
  );
  return { singleChain, multiChain };
}

mainModule()
  .then(() => {
    console.log("mainModule loaded");
  })
  .catch((error) => {
    console.error(error);
  });
