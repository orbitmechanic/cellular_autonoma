const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Chloroplast Replication Functionality", function () {
  let nucleus, leucoplast, chloroplast;
  let owner, cellMember1, attacker;

  before(async function () {
    [owner, cellMember1, attacker] = await ethers.getSigners();

    // Deploy a Nucleus with a minimal organelle list.
    const Nucleus = await ethers.getContractFactory("Nucleus");
    // For simplicity, deploy with empty arrays so that only default organelles (e.g. "Parent" and "Nucleus")
    // are registered. (Your Nucleus.sol may auto-register these in its constructor.)
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

    // Fund the Leucoplast with sufficient funds for replication.
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

    // Optionally, register the Chloroplast as a non-replicating member in the original Nucleus.
    await nucleus.registerOrganelle("Chloroplast", chloroplast.target, false);
  });

  it("should revert replication if funds are insufficient", async function () {
    // Drain the Leucoplast.
    const currentBalance = await leucoplast.getBalance();
    if (currentBalance.gt(0)) {
      await leucoplast.withdraw(await owner.getAddress(), currentBalance);
    }
    await expect(chloroplast.replicate()).to.be.revertedWith(
      "Insufficient funds for replication"
    );
  });

  it("should replicate the cell if funds are sufficient", async function () {
    // Fund the Leucoplast with sufficient funds again.
    await owner.sendTransaction({
      to: leucoplast.target,
      value: ethers.parseEther("20"),
    });

    // Call replicate.
    const tx = await chloroplast.replicate();
    await tx.wait();

    // Verify that a new cell copy (a new Nucleus contract) was created.
    const newCellsLength = await chloroplast.replicatedCellsLength();
    expect(newCellsLength).to.be.gt(0);

    // Optionally, you can check for emitted events.
    // For example, check that a "CellReplicated" event was emitted.
  });
});
