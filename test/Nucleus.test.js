const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v1 characterization suite (was: Nucleus.test.js, ported to ethers v6).
// These tests document what the ORIGINAL code does — including the flaws the
// v2 rewrite fixes. Gas/size deltas printed here feed the analysis deck.
// ---------------------------------------------------------------------------

describe("v1 Nucleus (characterization)", function () {
  let owner, user, Nucleus, nucleus;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    Nucleus = await ethers.getContractFactory("contracts/Nucleus.sol:Nucleus"); // v1 (contracts/Nucleus.sol)
    nucleus = await Nucleus.deploy();
    await nucleus.initialize("Cell1", owner.address, [], [], []);
  });

  it("initializes with default organelles", async function () {
    const [names] = await nucleus.getAllOrganelles();
    expect(Array.from(names)).to.include.members(["Parent", "Nucleus"]);
    expect(await nucleus.getOrganelleName(owner.address)).to.equal("Parent");
  });

  it("allows the Parent to register and update organelles", async function () {
    await nucleus.registerOrganelle("Test", user.address, true);
    expect(await nucleus.getOrganelleAddress("Test")).to.equal(user.address);
    await nucleus.registerOrganelle("Test", owner.address, false);
    expect(await nucleus.getOrganelleAddress("Test")).to.equal(owner.address);
  });

  it("rejects registration from non-Parent accounts", async function () {
    await expect(
      nucleus.connect(user).registerOrganelle("Another", user.address, true)
    ).to.be.revertedWith("Must be Parent to register new organelle.");
  });

  // FLAW #1 (v1): cloneCell() is permissionless and free. Any account can
  // mint an identity clone; there is no colony, no cost gate, no lineage
  // bookkeeping. It "works" — which is exactly why it is a problem.
  it("cloneCell() is callable by ANYONE and returns an initialized clone", async function () {
    const cloneAddr = await nucleus.connect(user).cloneCell.staticCall();
    await nucleus.connect(user).cloneCell();
    const clone = Nucleus.attach(cloneAddr);
    expect(await clone.identity()).to.equal("Cell1 copy");
  });

  // FLAW #2 (v1): identity is a string that GROWS every generation ("copy").
  // Storage and clone-time memory cost compound along the lineage.
  it("demonstrates identity-string bloat across generations", async function () {
    let current = nucleus;
    const identities = [];
    for (let i = 0; i < 4; i++) {
      const addr = await current.cloneCell.staticCall();
      await current.cloneCell();
      current = Nucleus.attach(addr);
      identities.push(await current.identity());
    }
    // Each generation appends " copy" (5 bytes). By gen 4 the name is
    // "Cell1 copy copy copy copy".
    expect(identities[3]).to.equal("Cell1 copy copy copy copy");
    console.log("      [v1 flaw] identity at gen 4:", JSON.stringify(identities[3]));
  });
});
