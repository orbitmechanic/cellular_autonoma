const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Chloroplast Integration and Cloning", function () {
  let owner, user;
  let Nucleus, nucleus;
  let Leucoplast, leucoplast;
  let Chloroplast, chloroplast;
  let CloneFactory, cloneFactory;

  before(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy the Nucleus template and initialize it.
    Nucleus = await ethers.getContractFactory("Nucleus");
    nucleus = await Nucleus.deploy();
    // No .deployed() call here.
    await nucleus.initialize("Cell1", await owner.getAddress(), [], [], []);

    // Deploy the Leucoplast template and initialize it with the Nucleus address.
    Leucoplast = await ethers.getContractFactory("Leucoplast");
    leucoplast = await Leucoplast.deploy();
    await leucoplast.initialize(nucleus.address);

    // Fund the Leucoplast with 20 ether.
    await owner.sendTransaction({
      to: leucoplast.address,
      value: ethers.parseEther("20"),
    });

    // Deploy the Chloroplast template and initialize it with the Nucleus and Leucoplast addresses.
    Chloroplast = await ethers.getContractFactory("Chloroplast");
    chloroplast = await Chloroplast.deploy();
    await chloroplast.initialize(
      nucleus.address,
      payable(leucoplast.address),
      ethers.parseEther("5")
    );

    // Optionally register the Chloroplast in the Nucleus.
    await nucleus.registerOrganelle("Chloroplast", chloroplast.address, false);

    // Deploy a simple clone factory for Chloroplast (if you have one).
    // (Alternatively, if Chloroplast has a cloneChloroplast() function, you can test that directly.)
    CloneFactory = await ethers.getContractFactory("LeucoplastCloneFactory");
    cloneFactory = await CloneFactory.deploy();
  });

  describe("Replication", function () {
    it("should replicate the cell by deploying new Nucleus and Leucoplast clones", async function () {
      // Capture the original Leucoplast balance.
      const originalBalance = await leucoplast.getBalance();

      // Call replicate() on Chloroplast.
      const tx = await chloroplast.replicate();
      await tx.wait();

      // Check that replicatedCells array has at least one entry.
      const cellCount = await chloroplast.replicatedCellsLength();
      expect(cellCount).to.be.gt(0);

      // Retrieve the new Nucleus address from replicatedCells.
      const newNucleusAddr = await chloroplast.replicatedCells(0);
      expect(newNucleusAddr).to.properAddress; // using Chai's address matcher

      // Attach Nucleus interface to the new clone.
      const newNucleus = Nucleus.attach(newNucleusAddr);
      const newId = await newNucleus.identity();
      expect(newId).to.contain(" copy");

      // Verify that funds were transferred by checking that original Leucoplast balance decreased.
      const remainingBalance = await leucoplast.getBalance();
      expect(remainingBalance).to.be.lt(originalBalance);
    });
  });

  describe("Chloroplast Cloning", function () {
    it("should clone itself and initialize with the same state", async function () {
      // Call cloneChloroplast() on the Chloroplast template.
      const cloneTx = await chloroplast.cloneChloroplast();
      const receipt = await cloneTx.wait();
      // Extract clone address from the emitted event "CloneCreated".
      const cloneEvent = receipt.events.find((e) => e.event === "CloneCreated");
      const cloneAddr = cloneEvent.args.cloneAddress;
      expect(cloneAddr).to.properAddress;

      // Attach Chloroplast interface to the clone.
      const clonedChloroplast = Chloroplast.attach(payable(cloneAddr));
      // Verify clone state.
      expect(await clonedChloroplast.nucleus()).to.equal(nucleus.address);
      expect(await clonedChloroplast.leucoplast()).to.equal(leucoplast.address);
      expect(await clonedChloroplast.replicationCostEstimate()).to.equal(
        ethers.parseEther("5")
      );
    });
  });
});
