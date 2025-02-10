const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Leucoplast and Nucleus Integration", function () {
  let owner, cellMember, nonMember;
  let Nucleus, nucleus;
  let Leucoplast, leucoplastTemplate, leucoplastClone;
  let CloneFactory, cloneFactory;

  before(async function () {
    [owner, cellMember, nonMember] = await ethers.getSigners();

    // Deploy the Nucleus contract (using the initializer pattern).
    Nucleus = await ethers.getContractFactory("Nucleus");
    nucleus = await Nucleus.deploy();
    await nucleus.deployed();
    // Initialize Nucleus with identity "Cell1", Parent = owner.
    await nucleus.initialize("Cell1", await owner.getAddress(), [], [], []);

    // For Leucoplast’s onlyCellMember modifier to pass, register a valid cell member.
    // Here we register the Leucoplast template address later.
    // Also, we register cellMember so that we can test withdrawal as a valid caller.

    // Deploy the Leucoplast template (clone‑able version).
    Leucoplast = await ethers.getContractFactory("Leucoplast");
    leucoplastTemplate = await Leucoplast.deploy();
    await leucoplastTemplate.deployed();
    // Initialize it with the real Nucleus address.
    await leucoplastTemplate.initialize(nucleus.address);

    // Register the template Leucoplast in the nucleus (as "Leucoplast") so that calls from its address pass.
    await nucleus.registerOrganelle(
      "Leucoplast",
      leucoplastTemplate.address,
      false
    );

    // Also register cellMember as a valid cell member.
    await nucleus.registerOrganelle(
      "TestMember",
      await cellMember.getAddress(),
      false
    );

    // Deploy a clone factory for Leucoplast.
    CloneFactory = await ethers.getContractFactory("LeucoplastCloneFactory");
    cloneFactory = await CloneFactory.deploy();
    await cloneFactory.deployed();
  });

  describe("Leucoplast Unit Functionality (Integration with Nucleus)", function () {
    let leucoplast;
    beforeEach(async function () {
      // For each test, deploy a fresh clone of the Leucoplast template via the factory.
      // (We clone the template and then initialize the clone with the real nucleus.)
      const cloneAddress = await cloneFactory.callStatic.cloneLeucoplast(
        leucoplastTemplate.address
      );
      const cloneTx = await cloneFactory.cloneLeucoplast(
        leucoplastTemplate.address
      );
      await cloneTx.wait();
      leucoplast = Leucoplast.attach(cloneAddress);
      // Initialize the clone with the real nucleus address.
      await leucoplast.initialize(nucleus.address);
    });

    it("should initialize with the real Nucleus address", async function () {
      expect(await leucoplast.nucleus()).to.equal(nucleus.address);
    });

    it("should accept Ether and update balance", async function () {
      // Send 5 ether to the Leucoplast clone.
      await owner.sendTransaction({
        to: leucoplast.address,
        value: ethers.parseEther("5"),
      });
      const bal = await leucoplast.getBalance();
      expect(bal).to.equal(ethers.parseEther("5"));
    });

    it("should allow a registered cell member to withdraw up to half the balance", async function () {
      // Fund the Leucoplast clone with 10 ether.
      await owner.sendTransaction({
        to: leucoplast.address,
        value: ethers.parseEther("10"),
      });
      // cellMember is registered in Nucleus as "TestMember", so when cellMember calls withdraw,
      // INucleus(nucleus).getOrganelleName(cellMember) returns a nonempty string.
      // Withdraw 4 ether (within half of 10 ether => 5 ether max).
      await leucoplast
        .connect(cellMember)
        .withdraw(await cellMember.getAddress(), ethers.parseEther("4"));
      const newBal = await leucoplast.getBalance();
      expect(newBal).to.equal(ethers.parseEther("6"));
    });

    it("should revert withdrawal from a non-registered address", async function () {
      await expect(
        leucoplast
          .connect(nonMember)
          .withdraw(await nonMember.getAddress(), ethers.parseEther("1"))
      ).to.be.revertedWith("Cannot withdraw by external Tx.");
    });
  });

  describe("Integration: Cloning Leucoplast with Nucleus", function () {
    it("should clone the Leucoplast template and initialize the clone with the real Nucleus", async function () {
      // Use the clone factory to clone the Leucoplast template.
      const cloneAddress = await cloneFactory.callStatic.cloneLeucoplast(
        leucoplastTemplate.address
      );
      const cloneTx = await cloneFactory.cloneLeucoplast(
        leucoplastTemplate.address
      );
      await cloneTx.wait();

      leucoplastClone = Leucoplast.attach(cloneAddress);
      // Initialize the clone.
      await leucoplastClone.initialize(nucleus.address);

      // Verify that the clone's nucleus state is set correctly.
      expect(await leucoplastClone.nucleus()).to.equal(nucleus.address);

      // Test functionality: send 3 ether to the clone and check balance.
      await owner.sendTransaction({
        to: leucoplastClone.address,
        value: ethers.parseEther("3"),
      });
      const cloneBal = await leucoplastClone.getBalance();
      expect(cloneBal).to.equal(ethers.parseEther("3"));
    });
  });
});
