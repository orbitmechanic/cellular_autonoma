const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Chloroplast Integration and Cloning", function () {
  let owner, user;
  let Nucleus, nucleus;
  let Leucoplast, leucoplast;
  let Chloroplast, chloroplast;

  before(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy the Nucleus template and initialize it.
    Nucleus = await ethers.getContractFactory("Nucleus");
    nucleus = await Nucleus.deploy();
    await nucleus.deployed();
    await nucleus.initialize("Cell1", await owner.getAddress(), [], [], []);

    // Deploy the Leucoplast template and initialize it with the Nucleus address.
    Leucoplast = await ethers.getContractFactory("Leucoplast");
    leucoplast = await Leucoplast.deploy();
    await leucoplast.deployed();
    await leucoplast.initialize(nucleus.address);

    // Fund the original Leucoplast with 20 ether.
    await owner.sendTransaction({
      to: leucoplast.address,
      value: ethers.parseEther("20"),
    });

    // Deploy the Chloroplast template and initialize it.
    Chloroplast = await ethers.getContractFactory("Chloroplast");
    chloroplast = await Chloroplast.deploy();
    await chloroplast.deployed();
    await chloroplast.initialize(
      nucleus.address,
      payable(leucoplast.address),
      ethers.parseEther("5")
    );

    // (Optionally, you might want to register Chloroplast in Nucleus here.)
  });

  describe("Replication", function () {
    it("should replicate the cell, deploying new Nucleus and Leucoplast clones", async function () {
      // Get the original Leucoplast balance.
      const originalBalance = await leucoplast.getBalance();

      // Call replicate() on Chloroplast.
      const tx = await chloroplast.replicate();
      await tx.wait();

      // Check that the replicatedCells array in Chloroplast has at least one entry.
      const cellCount = await chloroplast.replicatedCellsLength();
      expect(cellCount).to.be.gt(0);

      // Retrieve the new Nucleus address from the replicatedCells array.
      const newNucleusAddr = await chloroplast.replicatedCells(0);
      expect(newNucleusAddr).to.properAddress;

      // Attach the Nucleus interface to the new clone.
      const newNucleus = Nucleus.attach(newNucleusAddr);
      const newId = await newNucleus.identity();
      expect(newId).to.contain(" copy");

      // Verify that funds were transferred: the original Leucoplast balance should now be lower.
      const remainingBalance = await leucoplast.getBalance();
      expect(remainingBalance).to.be.lt(originalBalance);
    });
  });

  describe("Chloroplast Cloning", function () {
    it("should clone itself and initialize with the same state", async function () {
      // Call cloneChloroplast() on the Chloroplast template.
      // Assume that cloneChloroplast() emits an event CloneCreated(address cloneAddress).
      const cloneTx = await chloroplast.cloneChloroplast();
      const receipt = await cloneTx.wait();
      // Extract the clone address from the event (adjust the event name/args as defined).
      const cloneEvent = receipt.events.find((e) => e.event === "CloneCreated");
      const cloneAddr = cloneEvent.args.cloneAddress;

      // Attach the Chloroplast interface to the clone.
      const clonedChloroplast = Chloroplast.attach(payable(cloneAddr));

      // Verify that the clone’s state was correctly initialized.
      expect(await clonedChloroplast.nucleus()).to.equal(nucleus.address);
      expect(await clonedChloroplast.leucoplast()).to.equal(leucoplast.address);
      expect(await clonedChloroplast.replicationCostEstimate()).to.equal(
        ethers.parseEther("5")
      );
    });
  });
});
