const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v2.2 audit-regression suite: one test per finding fixed in the ERC
// alignment + security pass (see AUDIT.md). If any of these starts failing,
// a hardening guarantee has regressed.
// ---------------------------------------------------------------------------

const ROLE = { ENERGY: 2n, METABOLISM: 3n, OTHER: 5n, WORKER: 6n };

async function makeColony(fund = "100") {
  const [owner, keeper] = await ethers.getSigners();
  const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
  const colony = await Colony.deploy();
  await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
  await colony.setCycleParams(0, 2500, ethers.parseEther("10"), 300);
  const tx = await colony.plantRoot("root-1", { value: ethers.parseEther(fund) });
  const r = await tx.wait();
  const rootAddr = r.logs
    .map((l) => colony.interface.parseLog(l))
    .find((p) => p && p.name === "RootPlanted").args.nucleus;
  const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
  const Chloro = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
  const nucleus = Nucleus.attach(rootAddr);
  const EnergyStore = await ethers.getContractFactory("contracts/v2/EnergyStore.sol:EnergyStore");
  const energy = EnergyStore.attach(await nucleus.getOrganelleByRole(ROLE.ENERGY));
  const chloro = Chloro.attach(await nucleus.getOrganelleByRole(ROLE.METABOLISM));
  return { owner, keeper, colony, rootAddr, nucleus, chloro, energy };
}

async function graft(colony, cell, name, factory, role, replicable = true) {
  const tmpl = await factory.deploy(await colony.getAddress());
  const tx = await colony.graftTemplate(cell, name, tmpl.target, role, replicable);
  const r = await tx.wait();
  const ev = r.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Grafted");
  return { template: tmpl, instance: factory.attach(ev.args.instance) };
}

describe("v2.2 audit regressions", function () {
  it("A1: WORKER graft must pass the ERC-165 registry gate", async function () {
    const { colony, rootAddr } = await makeColony();
    const Silent = await ethers.getContractFactory("contracts/mocks/MockNoInterface.sol:MockNoInterface");
    const silent = await Silent.deploy();
    await expect(colony.graftTemplate(rootAddr, "fake-organ", silent.target, ROLE.WORKER, true))
      .to.be.revertedWith("Nucleus: WORKER must speak IWorker");
  });

  it("A2: shield attachment must speak IPeroxisome", async function () {
    const { colony, rootAddr } = await makeColony();
    const Memb = await ethers.getContractFactory("contracts/v2/organelles/Membrane.sol:Membrane");
    const Lyso = await ethers.getContractFactory("contracts/v2/organelles/Lysosome.sol:Lysosome");
    const membrane = (await graft(colony, rootAddr, "membrane", Memb, ROLE.OTHER, true)).instance;
    const wrong = (await graft(colony, rootAddr, "lysosome", Lyso, ROLE.WORKER, true)).instance;
    const data = membrane.interface.encodeFunctionData("attachShield", [wrong.target]);
    await expect(colony.administer(rootAddr, membrane.target, data))
      .to.be.revertedWith("Membrane: shield does not speak IPeroxisome");
    // the right one attaches fine
    const Perox = await ethers.getContractFactory("contracts/v2/organelles/Peroxisome.sol:Peroxisome");
    const perox = (await graft(colony, rootAddr, "peroxisome", Perox, ROLE.WORKER, true)).instance;
    const okData = membrane.interface.encodeFunctionData("attachShield", [perox.target]);
    await (await colony.administer(rootAddr, membrane.target, okData)).wait();
    expect(await membrane.shield()).to.equal(perox.target);
  });

  it("A3: a stranger cannot clone-init-bind a template behind the colony's back", async function () {
    const { colony } = await makeColony();
    const Mito = await ethers.getContractFactory("contracts/v2/organelles/Mitochondrion.sol:Mitochondrion");
    const tmpl = await Mito.deploy(await colony.getAddress());
    const Cloner = await ethers.getContractFactory("contracts/mocks/MockCloner.sol:MockCloner");
    const cloner = await Cloner.deploy();
    // v2.2: Organelle.initialize is colony-only, so even a raw clone cannot
    // be pre-bound to a rogue nucleus by an attacker.
    await expect(cloner.cloneAndInit(tmpl.target, cloner.target)).to.be.revertedWith(
      "Organelle: only the colony may bind a clone"
    );
    // a plain clone stays unbound and inert until graftTemplate does it right
    await (await cloner.clone(tmpl.target)).wait();
  });

  it("A4: the per-organ gas stipend contains a spinning malignant organ", async function () {
    const { colony, rootAddr, chloro, keeper, nucleus } = await makeColony();
    await colony.setGovernanceBounds(200_000, 24); // tiny stipend
    const Burner = await ethers.getContractFactory("contracts/mocks/MockGasBurner.sol:MockGasBurner");
    const burnerT = await Burner.deploy();
    await (await colony.graftTemplate(rootAddr, "burner", burnerT.target, ROLE.WORKER, false)).wait();
    const burner = Burner.attach((await nucleus.organelleByName("burner")).instance);
    const receipt = await (await chloro.connect(keeper).express()).wait();
    // cycle survived; the organ burned exactly its 200k allotment and
    // reverted (OOG inside a storage loop) - try/catch contained it and
    // rolled its state back to zero
    expect(receipt.status).to.equal(1);
    expect(receipt.gasUsed).to.be.lt(1_600_000n);
    expect(await burner.counter()).to.equal(0); // reverted organ leaves NOTHING
    const failed = receipt.logs.map((l) => chloro.interface.parseLog(l)).find((p) => p && p.name === "OrganFailed");
    expect(failed).to.exist;
    expect(failed.args.worker).to.equal(burner.target);
    const cycle = receipt.logs.map((l) => chloro.interface.parseLog(l)).find((p) => p && p.name === "MetabolicCycle");
    expect(cycle.args.cycle).to.equal(1);
  });

  it("A5: auxiliary organelle count is bounded (registry scan cost is capped)", async function () {
    const { colony, rootAddr } = await makeColony();
    await colony.setGovernanceBounds(700_000, 4); // 4 auxiliary slots
    const Lyso = await ethers.getContractFactory("contracts/v2/organelles/Lysosome.sol:Lysosome");
    for (let i = 0; i < 4; i++) {
      await (await colony.graftTemplate(rootAddr, `lyso-${i}`, (await Lyso.deploy(await colony.getAddress())).target, ROLE.WORKER, false)).wait();
    }
    const fifth = await Lyso.deploy(await colony.getAddress());
    await expect(colony.graftTemplate(rootAddr, "lyso-x", fifth.target, ROLE.WORKER, false))
      .to.be.revertedWith("Nucleus: auxiliary organelle limit");
  });

  it("A6: eviction frees an auxiliary slot; tombstoned names can be re-grafted", async function () {
    const { colony, rootAddr, chloro, keeper, nucleus } = await makeColony();
    await colony.setGovernanceBounds(700_000, 3);
    const Lyso = await ethers.getContractFactory("contracts/v2/organelles/Lysosome.sol:Lysosome");
    const t1 = await Lyso.deploy(await colony.getAddress());
    const g1 = await (await colony.graftTemplate(rootAddr, "a", t1.target, ROLE.WORKER, false)).wait();
    const aAddr = g1.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Grafted").args.instance;
    const t2 = await Lyso.deploy(await colony.getAddress());
    await (await colony.graftTemplate(rootAddr, "b", t2.target, ROLE.WORKER, false)).wait();
    const t3 = await Lyso.deploy(await colony.getAddress());
    await (await colony.graftTemplate(rootAddr, "c", t3.target, ROLE.WORKER, false)).wait();
    expect(await nucleus.auxCount()).to.equal(3);
    const a = Lyso.attach(aAddr);
    await (await colony.administer(rootAddr, aAddr, a.interface.encodeFunctionData("condemn", ["b"]))).wait();
    await (await chloro.connect(keeper).express()).wait(); // lysosome executes the eviction
    expect(await nucleus.auxCount()).to.equal(2);
    const ob = await nucleus.organelleByName("b");
    expect(ob.instance).to.equal(ethers.ZeroAddress);
    expect(await nucleus.getRole(t2.target)).to.equal(0n);
    // freed capacity admits a re-graft on the same tombstoned name
    const t4 = await Lyso.deploy(await colony.getAddress());
    await (await colony.graftTemplate(rootAddr, "b", t4.target, ROLE.WORKER, false)).wait();
    expect((await nucleus.organelleByName("b")).instance).to.not.equal(ethers.ZeroAddress);
    expect(await nucleus.auxCount()).to.equal(3);
  });

  it("A7: Golgi queue is bounded and prunes on dispatch", async function () {
    const { colony, rootAddr, chloro, keeper, owner } = await makeColony();
    const Golgi = await ethers.getContractFactory("contracts/v2/organelles/GolgiApparatus.sol:GolgiApparatus");
    const golgi = (await graft(colony, rootAddr, "golgi", Golgi, ROLE.WORKER, true)).instance;
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const data = golgi.interface.encodeFunctionData("schedule", [owner.address, 1n, now + 1, "m"]);
    for (let i = 0; i < 64; i++) await (await colony.administer(rootAddr, golgi.target, data)).wait();
    await expect(colony.administer(rootAddr, golgi.target, data)).to.be.revertedWith("Golgi: logistics queue full");
    expect(await golgi.count()).to.equal(64);
    // raise the per-cycle ceiling AND the organ stipend so all 64 can ship;
    // they must prune to 0 (stipend default is already batch-sized)
    await colony.setCycleParams(0, 2500, ethers.parseEther("50"), 300);
    await colony.setGovernanceBounds(4_000_000, 24);
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);
    await (await chloro.connect(keeper).express()).wait();
    expect(await golgi.count()).to.equal(0);
    expect(await golgi.pendingTotal()).to.equal(0);
    // queue space freed
    await (await colony.administer(rootAddr, golgi.target, data)).wait();
  });

  it("A8b: peroxisome saturation drops flags (not reports) past MAX_FLAGGED", async function () {
    const ctx = await makeColony();
    const { colony, rootAddr } = ctx;
    const Perox = await ethers.getContractFactory("contracts/v2/organelles/Peroxisome.sol:Peroxisome");
    const perox = (await graft(colony, rootAddr, "peroxisome", Perox, ROLE.WORKER, true)).instance;
    // threshold 1 via administer (cell-core only setter)
    await (await colony.administer(rootAddr, perox.target, perox.interface.encodeFunctionData("configure", [ethers.ZeroAddress, ethers.ZeroAddress, 1]))).wait();
    const signers = await ethers.getSigners();
    const reporters = signers.slice(2, 8);
    const agents = [];
    for (let i = 0; i < 36; i++) agents.push(ethers.getAddress("0x" + (i + 1).toString(16).padStart(40, "0")));
    for (let a = 0; a < 36; a++) {
      await perox.connect(reporters[a % reporters.length]).report(agents[a]);
    }
    expect(await perox.flaggedCount()).to.equal(32); // MAX_FLAGGED
    expect(await perox.flagged(agents[35])).to.equal(false); // 33rd+ reported but not flagged
  });

  it("A9: ribosome translation queue is bounded", async function () {
    const { colony, rootAddr } = await makeColony();
    const Ribo = await ethers.getContractFactory("contracts/v2/organelles/Ribosome.sol:Ribosome");
    const ribo = (await graft(colony, rootAddr, "ribosome", Ribo, ROLE.WORKER, true)).instance;
    const Protein = await ethers.getContractFactory("contracts/mocks/MockProtein.sol:MockProtein");
    const proto = await Protein.deploy();
    await (await colony.administer(rootAddr, ribo.target, ribo.interface.encodeFunctionData("program", [proto.target, "p"]))).wait();
    const order = ribo.interface.encodeFunctionData("order", [0]);
    for (let i = 0; i < 32; i++) await (await colony.administer(rootAddr, ribo.target, order)).wait();
    await expect(colony.administer(rootAddr, ribo.target, order)).to.be.revertedWith("Ribosome: translation queue full");
  });

  it("A10: keeper-aging list is bounded (digest scan cannot grow unbounded)", async function () {
    const { energy } = await makeColony();
    expect(await energy.MAX_AGING_KEEPERS()).to.equal(512);
    expect(await energy.creditedListLength()).to.equal(0);
  });

  it("A11: ERC-4626 mock is immune to the first-depositor donation attack", async function () {
    const Vault = await ethers.getContractFactory("contracts/mocks/MockERC4626Vault.sol:MockERC4626Vault");
    const vault = await Vault.deploy();
    const [, whale, victim] = await ethers.getSigners();
    // attacker deposits a tiny amount first...
    await vault.connect(whale).deposit(1n, whale.address, { value: 1n });
    // ...then DONATES huge value to skew shares-per-asset...
    await whale.sendTransaction({ to: vault.target, value: ethers.parseEther("10") });
    // victim deposits 1 ether expecting ~1 ether redeemable
    const expectedShares = await vault.convertToShares(ethers.parseEther("1"));
    await vault.connect(victim).deposit(ethers.parseEther("1"), victim.address, { value: ethers.parseEther("1") });
    expect(await vault.balanceOf(victim.address)).to.equal(expectedShares);
    const redeemable = await vault.previewRedeem(expectedShares);
    // virtual offsets keep the skew to dust: the victim keeps 99%+ of value
    expect(redeemable).to.be.gte(ethers.parseEther("0.99"));
    // the attacker's shares are worth ~1/101 of the pool - the 10-ether
    // donation comes back only as a trickle; the attack is pure loss
    const whaleAssets = await vault.previewRedeem(await vault.balanceOf(whale.address));
    expect(whaleAssets).to.be.lte(ethers.parseEther("0.011"));
  });
});
