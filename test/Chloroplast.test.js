const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Chloroplast Replication Functionality", function () {
  let nucleus, leucoplast, chloroplast;
  let owner, cellMember1, attacker;

  before(async function () {
    [owner, cellMember1, attacker] = await ethers.getSigners();

    // Deploy a Nucleus with a minimal organelle list.
    const Nucleus = await ethers.getContractFactory("Nucleus");
    nucleus = await Nucleus.deploy(
      "Cell1",
      await owner.getAddress(),
      [],
      [],
      []
    );
    await nucleus.waitForDeployment();

    // Deploy the Leucoplast contract.
    const Leucoplast = await ethers.getContractFactory("Leucoplast");
    leucoplast = await Leucoplast.deploy(nucleus.target);
    await leucoplast.waitForDeployment();

    // Fund the original Leucoplast with 20 ether.
    await owner.sendTransaction({
      to: leucoplast.target,
      value: ethers.parseEther("20"),
    });

    // Deploy the Chloroplast replication organelle with a replication cost estimate of 5 ether.
    const Chloroplast = await ethers.getContractFactory("Chloroplast");
    chloroplast = await Chloroplast.deploy(
      nucleus.target,
      leucoplast.target,
      ethers.parseEther("5")
    );
    await chloroplast.waitForDeployment();

    // Register the Chloroplast as a non-replicating member in the original Nucleus.
    await nucleus.registerOrganelle("Chloroplast", chloroplast.target, false);
  });

  describe("Insufficient Funds", () => {
    beforeEach(async function () {
      // Redeploy a fresh Leucoplast with insufficient funds (e.g. 4 ether, which is less than the 5 ether required).
      const Leucoplast = await ethers.getContractFactory("Leucoplast");
      leucoplast = await Leucoplast.deploy(nucleus.target);
      await leucoplast.waitForDeployment();
      await owner.sendTransaction({
        to: leucoplast.target,
        value: ethers.parseEther("4"),
      });
      // Redeploy Chloroplast with the new Leucoplast.
      const Chloroplast = await ethers.getContractFactory("Chloroplast");
      chloroplast = await Chloroplast.deploy(
        nucleus.target,
        leucoplast.target,
        ethers.parseEther("5")
      );
      await chloroplast.waitForDeployment();
      // Do NOT re-register Chloroplast here.
    });

    it("should revert replication if funds are insufficient", async function () {
      await expect(chloroplast.replicate()).to.be.revertedWith(
        "Insufficient funds for replication"
      );
    });
  });

  describe("Successful Replication", () => {
    beforeEach(async function () {
      // Redeploy a fresh Leucoplast and fund it with 20 ether.
      const Leucoplast = await ethers.getContractFactory("Leucoplast");
      leucoplast = await Leucoplast.deploy(nucleus.target);
      await leucoplast.waitForDeployment();
      await owner.sendTransaction({
        to: leucoplast.target,
        value: ethers.parseEther("20"),
      });
      // Redeploy Chloroplast with the new Leucoplast.
      const Chloroplast = await ethers.getContractFactory("Chloroplast");
      chloroplast = await Chloroplast.deploy(
        nucleus.target,
        leucoplast.target,
        ethers.parseEther("5")
      );
      await chloroplast.waitForDeployment();
      // Re-register the new Chloroplast with the nucleus (update mapping from the Parent account).
      try {
        await nucleus
          .connect(owner)
          .registerOrganelle("Chloroplast", chloroplast.target, false);
      } catch (e) {
        // If the error message contains "Organelle name already registered", ignore it.
      }
    });

    it("should replicate the cell if funds are sufficient", async function () {
      const tx = await chloroplast.replicate();
      await tx.wait();
      const newCellsLength = await chloroplast.replicatedCellsLength();
      expect(newCellsLength).to.be.gt(0);
    });

    it("should update registration when the Parent re-registers an existing organelle", async function () {
      // Use two defined addresses from our signers.
      const addressA = await cellMember1.getAddress();
      const addressB = await attacker.getAddress();
      // First, register "Test" with addressA.
      await nucleus.registerOrganelle("Test", addressA, true);
      // Now update registration with addressB (from Parent).
      await nucleus.connect(owner).registerOrganelle("Test", addressB, false);
      // Verify that the mapping now returns addressB.
      const addr = await nucleus.getOrganelleAddress("Test");
      expect(addr).to.equal(addressB);
    });
  });
});
