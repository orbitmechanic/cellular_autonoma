const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Leucoplast with real Nucleus integration", function () {
  let nucleus, leucoplast;
  let owner, cellMember1, cellMember2, attacker;

  before(async function () {
    // Get test signers.
    [owner, cellMember1, cellMember2, attacker] = await ethers.getSigners();

    // Deploy the real Nucleus contract.
    // Pass the owner's address as the parent address and use empty arrays for extra organelles.
    const Nucleus = await ethers.getContractFactory("Nucleus");
    nucleus = await Nucleus.deploy(
      "ProtoNucleus",
      await owner.getAddress(),
      [],
      [],
      []
    );
    await nucleus.waitForDeployment();

    // Register cellMember1 as a valid cell member from the Parent account.
    await nucleus.registerOrganelle(
      "CellMember",
      await cellMember1.getAddress(),
      true
    );
  });

  // Redeploy a fresh Leucoplast instance before each test to ensure isolation.
  beforeEach(async function () {
    const Leucoplast = await ethers.getContractFactory("Leucoplast");
    leucoplast = await Leucoplast.deploy(nucleus.target);
    await leucoplast.waitForDeployment();
  });

  describe("Initialization", () => {
    it("should set the nucleus address correctly", async () => {
      // In ethers v6 the deployed contract’s address is available as .target.
      expect(await leucoplast.nucleus()).to.equal(nucleus.target);
    });
  });

  describe("Withdraw Functionality", () => {
    beforeEach(async () => {
      // Fund the Leucoplast contract with 10 Ether before each withdrawal test.
      await owner.sendTransaction({
        to: leucoplast.target,
        value: ethers.parseEther("10"),
      });
    });

    it("should allow a registered cell member to withdraw up to the max limit", async () => {
      // With 10 ether in the contract, the max withdrawal is half: 5 ether.
      // Withdraw 4 ether (which is within limit).
      const recipient = await cellMember1.getAddress();
      const amount = ethers.parseEther("4");
      await leucoplast.connect(cellMember1).withdraw(recipient, amount);
      // Expect remaining balance: 10 - 4 = 6 ether.
      expect(await leucoplast.getBalance()).to.equal(ethers.parseEther("6"));
    });

    it("should revert when attempting to withdraw more than the max limit", async () => {
      // With 10 ether, attempting to withdraw 6 ether should revert.
      const recipient = await cellMember1.getAddress();
      const amount = ethers.parseEther("6");
      await expect(
        leucoplast.connect(cellMember1).withdraw(recipient, amount)
      ).to.be.revertedWith("Exceeds max withdrawal limit");
    });

    it("should revert when a non-cell member attempts to withdraw", async () => {
      // An address that is not registered in the Nucleus will trigger getOrganelleName to revert.
      const recipient = await attacker.getAddress();
      const amount = ethers.parseEther("1");
      await expect(
        leucoplast.connect(attacker).withdraw(recipient, amount)
      ).to.be.revertedWith("Organelle not found");
    });
  });

  describe("Receive Functionality", () => {
    it("should accept Ether and increase balance", async () => {
      const initialBalance = await leucoplast.getBalance();
      const value = ethers.parseEther("2");
      await owner.sendTransaction({ to: leucoplast.target, value });
      expect(await leucoplast.getBalance()).to.be.gt(initialBalance);
    });
  });

  describe("Get Balance Functionality", () => {
    it("should return the correct balance after deposits and withdrawals", async () => {
      // Fund the contract with 10 ether.
      await owner.sendTransaction({
        to: leucoplast.target,
        value: ethers.parseEther("10"),
      });
      // Have cellMember1 withdraw 3 ether.
      await leucoplast
        .connect(cellMember1)
        .withdraw(await cellMember1.getAddress(), ethers.parseEther("3"));
      // Expect remaining balance: 10 - 3 = 7 ether.
      expect(await leucoplast.getBalance()).to.equal(ethers.parseEther("7"));
    });
  });

  describe("Edge Cases", () => {
    it("should handle a zero withdrawal amount without reverting", async () => {
      await expect(
        leucoplast
          .connect(cellMember1)
          .withdraw(await cellMember1.getAddress(), 0)
      ).to.not.be.reverted;
    });

    it("should allow multiple withdrawals as long as each is within limit", async () => {
      const recipient = await cellMember1.getAddress();
      const amountEach = ethers.parseEther("2");
      // Fund the contract with 10 ether.
      await owner.sendTransaction({
        to: leucoplast.target,
        value: ethers.parseEther("10"),
      });
      // Perform two withdrawals of 2 ether each.
      await leucoplast.connect(cellMember1).withdraw(recipient, amountEach);
      await leucoplast.connect(cellMember1).withdraw(recipient, amountEach);
      // Total withdrawn: 4 ether; remaining balance should be 6 ether.
      expect(await leucoplast.getBalance()).to.equal(ethers.parseEther("6"));
    });
  });
});
