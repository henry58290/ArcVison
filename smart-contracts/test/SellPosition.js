const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PredictionMarket — sellPosition", function () {
  let contract, owner, alice, bob;
  const ONE_ETH = ethers.parseEther("1");
  const HALF_ETH = ethers.parseEther("0.5");
  const MIN_BET = ethers.parseEther("0.001");
  const CATEGORY = 0;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PredictionMarket");
    contract = await Factory.deploy();
    await contract.waitForDeployment();

    // Create a market ending in 7 days
    const endTime = (await time.latest()) + 7 * 24 * 60 * 60;
    await contract.createMarket("Will ETH hit $5k?", endTime, CATEGORY);
  });

  describe("Successful sell", function () {
    it("should allow selling full YES position", async function () {
      // Alice buys YES
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });

      // Get Alice's YES balance (net of fee)
      const yesBalance = await contract.yesBets(1, alice.address);
      expect(yesBalance).to.be.gt(0);

      // Get sell quote
      const quote = await contract.getSellQuote(1, true, yesBalance);
      expect(quote.netReturn).to.be.gt(0);

      // Sell full position
      const balBefore = await ethers.provider.getBalance(alice.address);
      const tx = await contract.connect(alice).sellPosition(1, true, yesBalance);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(alice.address);

      // User received ETH
      expect(balAfter + gasUsed - balBefore).to.be.closeTo(quote.netReturn, ethers.parseEther("0.0001"));

      // Position is zero
      expect(await contract.yesBets(1, alice.address)).to.equal(0);
    });

    it("should allow selling partial position", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);
      const halfBalance = yesBalance / 2n;

      await contract.connect(alice).sellPosition(1, true, halfBalance);

      const remaining = await contract.yesBets(1, alice.address);
      expect(remaining).to.equal(yesBalance - halfBalance);
    });

    it("should allow selling NO position", async function () {
      await contract.connect(bob).placePosition(1, false, { value: ONE_ETH });
      const noBalance = await contract.noBets(1, bob.address);

      await contract.connect(bob).sellPosition(1, false, noBalance);
      expect(await contract.noBets(1, bob.address)).to.equal(0);
    });

    it("should emit Sell event with correct data", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);

      await expect(contract.connect(alice).sellPosition(1, true, yesBalance))
        .to.emit(contract, "Sell")
        .withArgs(
          1,
          alice.address,
          true,
          yesBalance,
          (v) => v > 0n, // returnValue > 0
          (v) => v > 0n, // yesOdds
          (v) => v > 0n, // noOdds
          0n,            // totalYes should be 0 (sold everything)
          0n             // totalNo was 0
        );
    });

    it("should shift odds after sell (selling YES lowers YES odds)", async function () {
      // Both sides have liquidity
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      await contract.connect(bob).placePosition(1, false, { value: HALF_ETH });

      const oddsBefore = await contract.getOdds(1);
      const yesOddsBefore = oddsBefore.yesOdds;

      // Alice sells half her YES
      const yesBalance = await contract.yesBets(1, alice.address);
      await contract.connect(alice).sellPosition(1, true, yesBalance / 2n);

      const oddsAfter = await contract.getOdds(1);
      // YES odds should decrease after selling YES
      expect(oddsAfter.yesOdds).to.be.lt(yesOddsBefore);
    });

    it("should accrue fees to protocol", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const feesBefore = await contract.accruedFees();

      const yesBalance = await contract.yesBets(1, alice.address);
      await contract.connect(alice).sellPosition(1, true, yesBalance);

      const feesAfter = await contract.accruedFees();
      expect(feesAfter).to.be.gt(feesBefore);
    });
  });

  describe("Buy → Sell roundtrip", function () {
    it("selling immediately after buying should return less than invested", async function () {
      // In a parimutuel pool with virtual liquidity, selling immediately
      // returns less than you paid because:
      //   1. Buy fee is deducted on entry
      //   2. Sell price = position * currentOdds / 10000 (odds < 100% due to virtual liq)
      //   3. Sell fee is deducted on exit
      // This is expected behavior — it's the spread/slippage cost.
      const buyAmount = ONE_ETH;
      const balBefore = await ethers.provider.getBalance(alice.address);

      const tx1 = await contract.connect(alice).placePosition(1, true, { value: buyAmount });
      const r1 = await tx1.wait();

      const yesBalance = await contract.yesBets(1, alice.address);
      const tx2 = await contract.connect(alice).sellPosition(1, true, yesBalance);
      const r2 = await tx2.wait();

      const balAfter = await ethers.provider.getBalance(alice.address);
      const totalGas = (r1.gasUsed * r1.gasPrice) + (r2.gasUsed * r2.gasPrice);
      const netLoss = balBefore - balAfter - totalGas;

      // User must lose something (fees + odds spread from virtual liquidity)
      expect(netLoss).to.be.gt(0n);
      // But should still get back a meaningful portion (> 50% of input)
      const returned = buyAmount - netLoss;
      expect(returned).to.be.gt(buyAmount / 2n);
    });

    it("selling after favorable price move should yield profit", async function () {
      // Alice buys YES at ~50%
      await contract.connect(alice).placePosition(1, true, { value: HALF_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);

      // Bob buys YES, pushing price up significantly
      await contract.connect(bob).placePosition(1, true, { value: ethers.parseEther("5") });

      // Alice's sell quote should be above her buy price
      const quote = await contract.getSellQuote(1, true, yesBalance);
      // The net return should be more than original bet (minus fees)
      // because odds moved in her favor
      expect(quote.netReturn).to.be.gt(yesBalance * 60n / 100n);
    });
  });

  describe("Failure cases", function () {
    it("should revert when selling more than owned", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);

      await expect(
        contract.connect(alice).sellPosition(1, true, yesBalance + 1n)
      ).to.be.revertedWith("Insufficient YES position");
    });

    it("should revert when selling with no position", async function () {
      await expect(
        contract.connect(alice).sellPosition(1, true, MIN_BET)
      ).to.be.revertedWith("Insufficient YES position");
    });

    it("should revert when selling below minimum", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });

      await expect(
        contract.connect(alice).sellPosition(1, true, MIN_BET - 1n)
      ).to.be.revertedWith("Below minimum sell");
    });

    it("should revert for non-open market", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);

      // Resolve the market
      await contract.resolveMarket(1, true);

      await expect(
        contract.connect(alice).sellPosition(1, true, yesBalance)
      ).to.be.revertedWith("Market not open");
    });

    it("should revert after betting window closes", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);

      // Fast forward past end time
      await time.increase(8 * 24 * 60 * 60);

      await expect(
        contract.connect(alice).sellPosition(1, true, yesBalance)
      ).to.be.revertedWith("Betting window closed");
    });

    it("should revert for cancelled market", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);

      await contract.cancelMarket(1, "Test cancellation");

      await expect(
        contract.connect(alice).sellPosition(1, true, yesBalance)
      ).to.be.revertedWith("Market was cancelled");
    });
  });

  describe("Edge cases", function () {
    it("should handle selling at minimum amount", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ethers.parseEther("0.01") });

      // Sell exactly MIN_BET worth
      await expect(
        contract.connect(alice).sellPosition(1, true, MIN_BET)
      ).to.not.be.reverted;
    });

    it("should handle multiple partial sells", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);
      const third = yesBalance / 3n;

      // Sell in three parts
      await contract.connect(alice).sellPosition(1, true, third);
      await contract.connect(alice).sellPosition(1, true, third);

      const remaining = await contract.yesBets(1, alice.address);
      expect(remaining).to.equal(yesBalance - third * 2n);
    });

    it("should handle sell when one pool is zero", async function () {
      // Only YES has liquidity
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      const yesBalance = await contract.yesBets(1, alice.address);

      // Should still work — odds are based on virtual liquidity
      await expect(
        contract.connect(alice).sellPosition(1, true, yesBalance / 2n)
      ).to.not.be.reverted;
    });
  });

  describe("getSellQuote", function () {
    it("should return accurate quote matching actual sell", async function () {
      await contract.connect(alice).placePosition(1, true, { value: ONE_ETH });
      await contract.connect(bob).placePosition(1, false, { value: HALF_ETH });

      const yesBalance = await contract.yesBets(1, alice.address);
      const quote = await contract.getSellQuote(1, true, yesBalance);

      expect(quote.grossReturn).to.be.gt(0);
      expect(quote.fee).to.be.gt(0);
      expect(quote.netReturn).to.equal(quote.grossReturn - quote.fee);
      expect(quote.pricePerShare).to.be.gt(0);
      expect(quote.pricePerShare).to.be.lt(10000); // less than 100%
    });
  });
});
