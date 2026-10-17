const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v2 cell mechanics: genesis, registry, roles, mitosis, cloning discipline.
// ---------------------------------------------------------------------------

async function deployColony() {
  const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
  const colony = await Colony.deploy();
  return colony;
}

async function attachCell(colony, nucleusAddr) {
  const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
  const EnergyStore = await ethers.getContractFactory("contracts/v2/EnergyStore.sol:EnergyStore");
  const Chloroplast = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
  const nucleus = Nucleus.attach(nucleusAddr);
  const energyAddr = await nucleus.getOrganelleByRole(2n); // Role.ENERGY
  const chloroAddr = await nucleus.getOrganelleByRole(3n); // Role.METABOLISM
  return {
    nucleus,
    energy: EnergyStore.attach(energyAddr),
    chloroplast: Chloroplast.attach(chloroAddr),
    energyAddr,
    chloroAddr,
  };
}

describe("v2 Colony & Cell genesis", function () {
  let owner, colony, rootAddr, root;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    colony = await deployColony();
    const tx = await colony.plantRoot("root-1", { value: ethers.parseEther("10") });
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => colony.interface.parseLog(l))
      .find((p) => p && p.name === "RootPlanted");
    rootAddr = ev.args.nucleus;
    root = await attachCell(colony, rootAddr);
  });

  it("plants a root cell wired to its organelles", async function () {
    expect(await root.nucleus.name()).to.equal("root-1");
    expect(await root.nucleus.serial()).to.equal(1);
    expect(await root.nucleus.generation()).to.equal(1);
    expect(await root.nucleus.alive()).to.equal(true);
    expect(await root.nucleus.colony()).to.equal(await colony.getAddress());
    expect(await root.energy.nucleus()).to.equal(rootAddr);
    expect(await root.chloroplast.nucleus()).to.equal(rootAddr);
    expect(await root.energy.getBalance()).to.equal(ethers.parseEther("10"));
  });

  it("registers the three core organelles with correct roles and templates", async function () {
    expect(await root.nucleus.getRole(rootAddr)).to.equal(1n); // NUCLEUS
    expect(await root.nucleus.getRole(root.energyAddr)).to.equal(2n); // ENERGY
    expect(await root.nucleus.getRole(root.chloroAddr)).to.equal(3n); // METABOLISM
    const o = await root.nucleus.organelleByName("energy");
    expect(o.template).to.equal(await colony.energyTemplate());
    expect(o.instance).to.equal(root.energyAddr);
    expect(o.replicable).to.equal(true);
  });

  it("unknown callers resolve to Role.NONE instead of reverting (v1 bug #8)", async function () {
    const [, stranger] = await ethers.getSigners();
    expect(await root.nucleus.getRole(stranger.address)).to.equal(0n);
  });

  it("rejects initialization replays and outsiders (OnlyColony / AlreadyInitialized)", async function () {
    const [, attacker] = await ethers.getSigners();
    // Roots can only be planted by the colony owner.
    await expect(colony.connect(attacker).plantRoot("evil")).to.be.revertedWithCustomError(
      colony,
      "OwnableUnauthorizedAccount"
    );
    // An initialized nucleus proxy cannot be re-initialized — and only the
    // colony may call initialize at all (the OnlyColony gate fires first for
    // outsiders; AlreadyInitialized guards the colony's own replay path).
    await expect(
      root.nucleus
        .connect(attacker)
        .initialize("hijack", 99, 1, attacker.address, [], [], [], [], [])
    ).to.be.revertedWithCustomError(root.nucleus, "OnlyColony");
  });

  it("records per-agent food attribution when the cell is fed", async function () {
    const [, agent] = await ethers.getSigners();
    await agent.sendTransaction({ to: root.energyAddr, value: ethers.parseEther("1") });
    // The planting endowment (10) also arrived via receive(), so totalFood
    // = 11; the per-agent ledger is what lets service income settle later.
    expect(await root.energy.creditedBy(agent.address)).to.equal(ethers.parseEther("1"));
    expect(await root.energy.totalFood()).to.equal(ethers.parseEther("11"));
  });

  it("blocks EOA withdrawals (role separation)", async function () {
    const [, thief] = await ethers.getSigners();
    await expect(
      root.energy.connect(thief).withdraw(thief.address, 1n)
    ).to.be.revertedWithCustomError(root.energy, "NotCellMember");
  });
});

describe("v2 mitosis", function () {
  let owner, colony, root, rootAddr;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    colony = await deployColony();
    const tx = await colony.plantRoot("root-1", { value: ethers.parseEther("10") });
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => colony.interface.parseLog(l))
      .find((p) => p && p.name === "RootPlanted");
    rootAddr = ev.args.nucleus;
    root = await attachCell(colony, rootAddr);
  });

  it("refuses division without enough food", async function () {
    const [, keeper] = await ethers.getSigners();
    await expect(
      root.chloroplast.connect(keeper).replicate(ethers.parseEther("50"))
    ).to.be.revertedWith("Chloroplast: insufficient food for division");
  });

  it("splits a daughter with its own organelles, correct lineage, bounded name", async function () {
    const [, keeper] = await ethers.getSigners();
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => colony.interface.parseLog(l))
      .find((p) => p && p.name === "Birth");
    expect(ev).to.exist;
    const childAddr = ev.args.child;

    const child = await attachCell(colony, childAddr);
    expect(await child.nucleus.name()).to.equal("cell#2"); // bounded, not "copy copy"
    expect(await child.nucleus.generation()).to.equal(2);
    expect(await child.nucleus.parentCell()).to.equal(rootAddr);
    expect(await child.nucleus.alive()).to.equal(true);
    expect(await root.nucleus.childrenLength()).to.equal(1);
    expect(await root.nucleus.children(0)).to.equal(childAddr);

    // Daughter energy holds endowment minus the 10% birth tithe.
    expect(await child.energy.getBalance()).to.equal(ethers.parseEther("0.9"));
    // Templates are the colony's, not the mother's live instances.
    const o = await child.nucleus.organelleByName("energy");
    expect(o.template).to.equal(await colony.energyTemplate());
    expect(o.instance).to.not.equal(root.energyAddr);
    expect(child.energyAddr).to.not.equal(root.energyAddr);
  });

  it("clones from templates: proxy call cost is FLAT across generations (v1 bug #5)", async function () {
    // setParams(maxGeneration, minBirthInterval, minReserve, birthFee,
    //   titheBps, harvestBps, keeperStipend, maxRefundBps, maxRefundCap)
    await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));

    const [, keeper] = await ethers.getSigners();
    let current = root;
    const callGases = [];
    for (let gen = 1; gen <= 4; gen++) {
      const gas = await current.energy.getBalance.estimateGas();
      callGases.push(gas);
      if (gen < 4) {
        const tx = await current.chloroplast.connect(keeper).replicate(ethers.parseEther("0.2"));
        const receipt = await tx.wait();
        const ev = receipt.logs
          .map((l) => colony.interface.parseLog(l))
          .find((p) => p && p.name === "Birth");
        current = await attachCell(colony, ev.args.child);
        // feed the child so it can keep dividing
        await owner.sendTransaction({ to: current.energyAddr, value: ethers.parseEther("4") });
      }
    }
    // v1 grew ~500+ gas per generation (proxy-of-proxy); v2 must stay flat.
    const drift = callGases[callGases.length - 1] - callGases[0];
    expect(drift).to.be.lt(200n, `call gas drifted ${drift} across 4 generations`);
  });

  it("cooldown blocks immediate re-division; owner can tune it to zero", async function () {
    const [, keeper] = await ethers.getSigners();
    await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    await expect(
      root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"))
    ).to.be.revertedWith("Chloroplast: growth phase cooldown");

    await colony.setParams(12, 0, 0, 0, 1000, 2500, 0, 500, ethers.parseEther("1"));
    await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    expect(await root.chloroplast.births()).to.equal(2);
  });

  it("generation cap enforces terminal cells", async function () {
    await colony.setParams(2, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
    const [, keeper] = await ethers.getSigners();
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"));
    const receipt = await tx.wait();
    const childAddr = receipt.logs
      .map((l) => colony.interface.parseLog(l))
      .find((p) => p && p.name === "Birth").args.child;
    const child = await attachCell(colony, childAddr);
    await owner.sendTransaction({ to: child.energyAddr, value: ethers.parseEther("5") });
    await expect(
      child.chloroplast.connect(keeper).replicate(ethers.parseEther("1"))
    ).to.be.revertedWith("Chloroplast: terminal generation");
  });

  it("canReplicate view mirrors the on-chain gates", async function () {
    let [ok] = await root.chloroplast.canReplicate(ethers.parseEther("10.5"));
    expect(ok).to.equal(false); // would starve the cell (bal 10 < 10.5)
    [ok] = await root.chloroplast.canReplicate(ethers.parseEther("9.5"));
    expect(ok).to.equal(true);
    await colony.setParams(1, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
    [ok] = await root.chloroplast.canReplicate(ethers.parseEther("1"));
    expect(ok).to.equal(false); // generation 1 < max 1 required
  });

  it("shared (non-replicable) symbionts are pointer-copied into daughters", async function () {
    // Graft a shared reserve-like organelle onto the root.
    const Symbiont = await ethers.getContractFactory("contracts/v2/EnergyStore.sol:EnergyStore");
    const symbiont = await Symbiont.deploy(await colony.getAddress());
    await colony.graft(rootAddr, "lens", symbiont.target, ethers.ZeroAddress, 5n /* OTHER */, false);
    const o = await root.nucleus.organelleByName("lens");
    expect(o.replicable).to.equal(false);

    await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
    const [, keeper] = await ethers.getSigners();
    const tx = await root.chloroplast.connect(keeper).replicate(ethers.parseEther("0.1"));
    const receipt = await tx.wait();
    const childAddr = receipt.logs
      .map((l) => colony.interface.parseLog(l))
      .find((p) => p && p.name === "Birth").args.child;

    const childNucleus = await (await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus")).attach(childAddr);
    const oc = await childNucleus.organelleByName("lens");
    expect(oc.instance).to.equal(symbiont.target); // shared pointer preserved
  });

  it("apoptosis sweeps a cell and marks it dead; dead cells cannot divide", async function () {
    await colony.apoptosis(rootAddr);
    expect(await root.nucleus.alive()).to.equal(false);
    const [, keeper] = await ethers.getSigners();
    await expect(
      root.chloroplast.connect(keeper).replicate(ethers.parseEther("1"))
    ).to.be.revertedWith("Chloroplast: cell is dead");
    // all 10 ether swept to harvestRecipient (the owner)
    expect(await root.energy.getBalance()).to.equal(0);
  });
});
