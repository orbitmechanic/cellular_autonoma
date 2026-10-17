const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v1 Leucoplast characterization (ported to ethers v6). Documents the
// membership-gating bug: the modifier's intended error can never fire
// because getOrganelleName() REVERTS for outsiders instead of returning "".
// ---------------------------------------------------------------------------

describe("v1 Leucoplast (characterization)", function () {
  let owner, cellMember, nonMember;
  let Nucleus, nucleus, Leucoplast, leucoplast;

  beforeEach(async function () {
    [owner, cellMember, nonMember] = await ethers.getSigners();

    Nucleus = await ethers.getContractFactory("contracts/Nucleus.sol:Nucleus");
    nucleus = await Nucleus.deploy();
    await nucleus.initialize("Cell1", owner.address, [], [], []);

    Leucoplast = await ethers.getContractFactory("contracts/Leucoplast.sol:Leucoplast");
    leucoplast = await Leucoplast.deploy();
    await leucoplast.initialize(nucleus.target);

    await nucleus.registerOrganelle("Leucoplast", leucoplast.target, false);
    await nucleus.registerOrganelle("TestMember", cellMember.address, false);
  });

  it("accepts Ether and reports balance", async function () {
    await owner.sendTransaction({ to: leucoplast.target, value: ethers.parseEther("5") });
    expect(await leucoplast.getBalance()).to.equal(ethers.parseEther("5"));
  });

  it("allows a registered cell member to withdraw up to half the balance", async function () {
    await owner.sendTransaction({ to: leucoplast.target, value: ethers.parseEther("10") });
    await leucoplast.connect(cellMember).withdraw(cellMember.address, ethers.parseEther("4"));
    expect(await leucoplast.getBalance()).to.equal(ethers.parseEther("6"));
  });

  it("caps withdrawal at half the balance", async function () {
    await owner.sendTransaction({ to: leucoplast.target, value: ethers.parseEther("10") });
    await expect(
      leucoplast.connect(cellMember).withdraw(cellMember.address, ethers.parseEther("6"))
    ).to.be.revertedWith("Exceeds max withdrawal limit");
  });

  // FLAW #3 (v1): the onlyCellMember modifier's message is unreachable.
  // bytes(INucleus(nucleus).getOrganelleName(msg.sender)).length > 0 reverts
  // inside getOrganelleName (it requires a hit), so outsiders get the WRONG
  // error and the modifier logic never evaluates as intended. Any registered
  // organelle — not just trusted ones — can withdraw half to anywhere.
  it("outsiders hit getOrganelleName's revert, not the modifier's message", async function () {
    await expect(
      leucoplast.connect(nonMember).withdraw(nonMember.address, ethers.parseEther("1"))
    ).to.be.revertedWith("Organelle not found"); // NOT "Cannot withdraw by external Tx."
    console.log("      [v1 flaw] membership check leaks the wrong revert; role separation absent");
  });

  it("ANY registered organelle (even the nucleus self) may withdraw", async function () {
    // registerOrganelle accepted arbitrary EOAs as members in v1; a cell
    // whose registry contains a malicious "organelle" hands it wallet keys.
    await owner.sendTransaction({ to: leucoplast.target, value: ethers.parseEther("10") });
    await nucleus.registerOrganelle("Sneaky", nonMember.address, false);
    await leucoplast.connect(nonMember).withdraw(nonMember.address, ethers.parseEther("5"));
    expect(await leucoplast.getBalance()).to.equal(ethers.parseEther("5"));
  });
});
