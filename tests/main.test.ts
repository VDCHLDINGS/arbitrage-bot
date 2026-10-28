import { mainModule } from "../static/main";
import { evaluateMultiChainArbitrage, evaluateSingleChainPegArbitrage } from "../src/arbitrage-engine";
import { db } from "./__mocks__/db";
import { server } from "./__mocks__/node";
import usersGet from "./__mocks__/users-get.json";
import { expect, describe, beforeAll, beforeEach, afterAll, afterEach, it } from "@jest/globals";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("User & Arbitrage tests", () => {
  beforeEach(() => {
    for (const item of usersGet) {
      db.users.create(item);
    }
  });

  it("Should fetch all the users and evaluate single-chain & multi-chain UUSD arbitrage", async () => {
    const res = await fetch("https://api.ubiquity.com/users");
    const data = await res.json();
    expect(data).toMatchObject(usersGet);
    const result = await mainModule();
    expect(result.singleChain.shouldExecute).toBe(true);
    expect(result.singleChain.direction).toBe("BUY_ON_CURVE_AND_REDEEM");
    expect(result.multiChain.shouldExecute).toBe(true);
    expect(result.multiChain.route).toBe("GNOSIS_TO_MAINNET");

    const premiumSingle = evaluateSingleChainPegArbitrage({
      curveUusdPriceUsd: 1.03,
      tradeSizeUsd: 1000,
      estimatedGasUsd: 2.0,
    });
    expect(premiumSingle.direction).toBe("MINT_AND_SELL_ON_CURVE");

    const reverseMulti = evaluateMultiChainArbitrage({
      mainnetUusdPriceUsd: 0.97,
      gnosisUusdPriceUsd: 1.0,
      tradeSizeUsd: 1000,
      mainnetGasUsd: 2.0,
      gnosisGasUsd: 0.05,
      bridgeFeeUsd: 1.0,
    });
    expect(reverseMulti.route).toBe("MAINNET_TO_GNOSIS");
  });
});
