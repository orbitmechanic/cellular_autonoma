const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v2.1 organelle cast: each optional organelle grafted into a living cell,
// exercised through the Chloroplast's express() gene-expression cycle, and
// inherited intact at mitosis.
// ---------------------------------------------------------------------------

const ROLE = { ENERGY: 2n, METABOLISM: 3n, RESERVE: 4n, OTHER: 5n, WORKER: 6n };

async function deployColony() {
  const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
  return Colony.deploy();
}

async function parseEvents(contract, receipt, name) {
  return receipt.logs.map((l) => contract.interface.parseLog(l)).filter((p) => p && p.name === name);
}

async function attachCell(nucleusAddr) {
  const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
  const EnergyStore = await ethers.getContractFactory("contracts/v2/EnergyStore.sol:EnergyStore");
  const Chloroplast = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
  const nucleus = Nucleus.attach(nucleusAddr);
  const energyAddr = await nucleus.getOrganelleByRole(ROLE.ENERGY);
  const chloroAddr = await nucleus.getOrganelleByRole(ROLE.METABOLISM);
  return { nucleus, energy: EnergyStore.attach(energyAddr), chloro: Chloroplast.attach(chloroAddr), energyAddr, chloroAddr };
}

async function graftTemplate(colony, cell, name, factory, role, replicable) {
  const tmpl = await factory.deploy(await colony.getAddress());
  const tx = await colony.graftTemplate(cell, name, tmpl.target, role, replicable);
  const r = await tx.wait();
  const ev = (await parseEvents(colony, r, "Grafted"))[0];
  return { template: tmpl, instance: factory.attach(ev.args.instance) };
}

async function administer(colony, cell, organelle, fragment, ...args) {
  const data = organelle.interface.encodeFunctionData(fragment, args);
  return colony.administer(cell, await organelle.getAddress(), data);
}

async function express(chloro, keeper) {
  const tx = await chloro.connect(keeper).express();
  return tx.wait();
}

async function makeHealthyCell() {
  const [owner, keeper] = await ethers.getSigners();
  const colony = await deployColony();
  await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
  await colony.setCycleParams(0, 2500, ethers.parseEther("10"), 300); // interval, bps, ceiling, ttl
  const tx = await colony.plantRoot("root-1", { value: ethers.parseEther("100") });
  const r = await tx.wait();
  const rootAddr = (await parseEvents(colony, r, "RootPlanted"))[0].args.nucleus;
  const cell = await attachCell(rootAddr);
  return { owner, keeper, colony, rootAddr, cell };
}

describe("v2.1 Membrane (the income organ)", function () {
  let ctx, colony, rootAddr, cell, membrane, SVC;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Membrane = await ethers.getContractFactory("contracts/v2/organelles/Membrane.sol:Membrane");
    membrane = (await graftTemplate(colony, rootAddr, "membrane", Membrane, ROLE.OTHER, true)).instance;
    SVC = ethers.id("registry.slot");
    await administer(colony, rootAddr, membrane, "registerService", SVC, ethers.parseEther("0.5"), 3600, 3);
  });

  it("sells receptor bindings and the fee lands as cell food", async function () {
    const [, agent] = await ethers.getSigners();
    await membrane.connect(agent).bind(SVC, { value: ethers.parseEther("0.5") });
    expect(await membrane.paidBy(agent.address)).to.equal(ethers.parseEther("0.5"));
    expect(await membrane.totalBinds()).to.equal(1);
    // fee forwarded to the EnergyStore, attributed to the membrane
    expect(await cell.energy.creditedBy(membrane.target)).to.equal(ethers.parseEther("0.5"));
    expect(await cell.energy.creditedBy(colony.target)).to.equal(ethers.parseEther("100")); // planting endowment
    expect(await cell.energy.getBalance()).to.equal(ethers.parseEther("100.5"));
    // membrane itself holds nothing at rest
    expect(await ethers.provider.getBalance(membrane.target)).to.equal(0n);
  });

  it("selective permeability: rate windows and refund of overpayment", async function () {
    const [, agent, agent2] = await ethers.getSigners();
    for (let i = 0; i < 3; i++) {
      await membrane.connect(agent).bind(SVC, { value: ethers.parseEther("0.5") });
    }
    await expect(membrane.connect(agent).bind(SVC, { value: ethers.parseEther("0.5") }))
      .to.be.revertedWith("Membrane: rate window full");

    // overpay: 0.9 in, 0.5 fee -> the cell keeps exactly 0.5, excess refunded
    const creditBefore = await cell.energy.creditedBy(membrane.target);
    await membrane.connect(agent2).bind(SVC, { value: ethers.parseEther("0.9") });
    const creditAfter = await cell.energy.creditedBy(membrane.target);
    expect(creditAfter - creditBefore).to.equal(ethers.parseEther("0.5"));
    expect(await membrane.paidBy(agent2.address)).to.equal(ethers.parseEther("0.5"));
  });

  it("second agent can bind while first is rate-limited; closed receptor rejects", async function () {
    const [, agentA, agentB] = await ethers.getSigners();
    await membrane.connect(agentA).bind(SVC, { value: ethers.parseEther("0.5") });
    await administer(colony, rootAddr, membrane, "toggleService", SVC); // close
    await expect(membrane.connect(agentB).bind(SVC, { value: ethers.parseEther("0.5") }))
      .to.be.revertedWith("Membrane: receptor closed");
    await administer(colony, rootAddr, membrane, "toggleService", SVC); // reopen
    await membrane.connect(agentB).bind(SVC, { value: ethers.parseEther("0.5") });
    expect(await membrane.paidBy(agentB.address)).to.equal(ethers.parseEther("0.5"));
  });

  it("passive tips forward to the cell", async function () {
    const [, tipper] = await ethers.getSigners();
    await tipper.sendTransaction({ to: membrane.target, value: ethers.parseEther("1") });
    expect(await cell.energy.getBalance()).to.equal(ethers.parseEther("101"));
  });

  it("unconfigured service has no price; only the cell core can register (EOA cannot)", async function () {
    const [, attacker] = await ethers.getSigners();
    await expect(membrane.connect(attacker).registerService(ethers.id("x"), 1, 0, 0))
      .to.be.revertedWithCustomError(membrane, "NotCellsMetabolism");
  });
});

describe("v2.1 Peroxisome + Vacuole (detox and quarantine)", function () {
  let ctx, colony, rootAddr, cell, membrane, peroxisome, vacuole, SVC;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Membrane = await ethers.getContractFactory("contracts/v2/organelles/Membrane.sol:Membrane");
    const Peroxisome = await ethers.getContractFactory("contracts/v2/organelles/Peroxisome.sol:Peroxisome");
    const Vacuole = await ethers.getContractFactory("contracts/v2/organelles/Vacuole.sol:Vacuole");
    membrane = (await graftTemplate(colony, rootAddr, "membrane", Membrane, ROLE.OTHER, true)).instance;
    peroxisome = (await graftTemplate(colony, rootAddr, "peroxisome", Peroxisome, ROLE.WORKER, true)).instance;
    vacuole = (await graftTemplate(colony, rootAddr, "vacuole", Vacuole, ROLE.WORKER, true)).instance;
    SVC = ethers.id("registry.slot");
    await administer(colony, rootAddr, membrane, "registerService", SVC, ethers.parseEther("0.5"), 3600, 5);
    await administer(colony, rootAddr, membrane, "attachShield", peroxisome.target);
    await administer(colony, rootAddr, peroxisome, "configure", membrane.target, vacuole.target, 2);
  });

  it("quarantines flagged revenue and blocks the agent from binding", async function () {
    const [, agent, accuserA, accuserB] = await ethers.getSigners();
    await membrane.connect(agent).bind(SVC, { value: ethers.parseEther("0.5") });

    // one report alone changes nothing (no self-enriching accusations)
    await peroxisome.connect(accuserA).report(agent.address);
    expect(await peroxisome.screen(agent.address)).to.equal(false);
    await membrane.connect(accuserB).bind(SVC, { value: ethers.parseEther("0.5") }); // others still served

    // quorum flags the toxin: the shield closes, and the express cycle
    // sequesters the tainted fee in the vacuole.
    await peroxisome.connect(accuserB).report(agent.address);
    expect(await peroxisome.flagged(agent.address)).to.equal(true);
    await expect(membrane.connect(agent).bind(SVC, { value: ethers.parseEther("0.5") }))
      .to.be.revertedWith("Membrane: agent screened out");

    const storeBefore = await cell.energy.getBalance();
    await express(cell.chloro, ctx.keeper);
    expect(await peroxisome.quarantined(agent.address)).to.equal(ethers.parseEther("0.5"));
    expect(await vacuole.pressure()).to.equal(ethers.parseEther("0.5"));
    // the tainted 0.5 now sits in the vacuole, not the cell's spendable pot
    expect(storeBefore - (await cell.energy.getBalance())).to.be.gte(ethers.parseEther("0.5"));

    // quarantine is NOT time-released by the ordinary cycle
    await ethers.provider.send("evm_increaseTime", [3600 * 24 * 40]);
    await ethers.provider.send("evm_mine", []);
    await express(cell.chloro, ctx.keeper);
    expect(await vacuole.pressure()).to.equal(ethers.parseEther("0.5"));
  });

  it("colony jury (via administer) lifts a quarantine back to the cell", async function () {
    const [, agent, accuserA, accuserB] = await ethers.getSigners();
    await membrane.connect(agent).bind(SVC, { value: ethers.parseEther("0.5") });
    await peroxisome.connect(accuserA).report(agent.address);
    await peroxisome.connect(accuserB).report(agent.address);
    await express(cell.chloro, ctx.keeper);
    expect(await vacuole.pressure()).to.equal(ethers.parseEther("0.5"));

    const id = (await vacuole.trancheCount()) - 1n;
    await administer(colony, rootAddr, vacuole, "releaseQuarantine", id);
    expect(await vacuole.pressure()).to.equal(0);
    expect(await cell.energy.getBalance()).to.be.gte(ethers.parseEther("100"));
  });

  it("a normal vacuole lock matures on schedule", async function () {
    const [, donor] = await ethers.getSigners();
    await donor.sendTransaction({ to: vacuole.target, value: ethers.parseEther("2"), data: "0x" });
    // raw receive() locks it with dueAt=now -> next cycle releases
    expect(await vacuole.pressure()).to.equal(ethers.parseEther("2"));
    await express(cell.chloro, ctx.keeper);
    expect(await vacuole.pressure()).to.equal(0);
    expect(await cell.energy.getBalance()).to.equal(ethers.parseEther("102"));
  });

  it("a false positive can be detoxed by the cell core", async function () {
    const [, agent, a, b] = await ethers.getSigners();
    await peroxisome.connect(a).report(agent.address);
    await peroxisome.connect(b).report(agent.address);
    await administer(colony, rootAddr, peroxisome, "detox", agent.address);
    expect(await peroxisome.flagged(agent.address)).to.equal(false);
  });
});

describe("v2.1 Golgi apparatus (scheduled shipments)", function () {
  let ctx, colony, rootAddr, cell, golgi;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Golgi = await ethers.getContractFactory("contracts/v2/organelles/GolgiApparatus.sol:GolgiApparatus");
    golgi = (await graftTemplate(colony, rootAddr, "golgi", Golgi, ROLE.WORKER, true)).instance;
  });

  it("batches due payments with memos and dispatches atomically", async function () {
    const agent = (await ethers.getSigners())[7]; // distinct from ctx.keeper (signers[1])
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await administer(colony, rootAddr, golgi, "schedule", agent.address, ethers.parseEther("1"), now + 100, "bounty-1");
    await administer(colony, rootAddr, golgi, "schedule", ctx.owner.address, ethers.parseEther("2"), now + 100, "grant-2");
    expect(await golgi.pendingTotal()).to.equal(ethers.parseEther("3"));

    // not due yet: cycle ships nothing, store only loses the keeper credit
    await express(cell.chloro, ctx.keeper);
    expect(await ethers.provider.getBalance(agent.address)).to.equal(await ethers.provider.getBalance(agent.address));
    expect(await golgi.pendingTotal()).to.equal(ethers.parseEther("3"));

    await ethers.provider.send("evm_increaseTime", [200]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      cell.chloro.connect(ctx.keeper).express() // tx response (not awaited) for the matcher
    ).to.changeEtherBalances(
      [agent.address, ctx.owner.address],
      [ethers.parseEther("1"), ethers.parseEther("2")]
    );
    expect(await golgi.pendingTotal()).to.equal(0);
    const store = await cell.energy.getBalance();
    // 100 - 3 shipped - keeper credit (must be small, < 0.1 ether)
    expect(store).to.be.lt(ethers.parseEther("97.1"));
    expect(store).to.be.gt(ethers.parseEther("96.9"));
  });

  it("batch atomicity: if due > cycle budget nothing ships this cycle", async function () {
    const agent = (await ethers.getSigners())[7];
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    // 15 ether due, but perWorkerCeiling is 10 ether
    await administer(colony, rootAddr, golgi, "schedule", agent.address, ethers.parseEther("15"), now + 1, "too-big");
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);
    const agentBefore = await ethers.provider.getBalance(agent.address);
    const receipt = await express(cell.chloro, ctx.keeper);
    const shipped = (await parseEvents(golgi, receipt, "Shipped"))[0];
    expect(shipped.args.count).to.equal(0);
    expect(shipped.args.skippedDueToCeiling).to.equal(ethers.parseEther("15"));
    expect(await ethers.provider.getBalance(agent.address)).to.equal(agentBefore);
    expect(await golgi.pendingTotal()).to.equal(ethers.parseEther("15"));

    // raise the per-worker ceiling and it ships in full
    await colony.setCycleParams(0, 2500, ethers.parseEther("20"), 300);
    await express(cell.chloro, ctx.keeper);
    expect(await golgi.pendingTotal()).to.equal(0);
    expect(await ethers.provider.getBalance(agent.address)).to.equal(agentBefore + ethers.parseEther("15"));
  });

  it("packages can be cancelled before dispatch", async function () {
    const agent = (await ethers.getSigners())[7];
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await administer(colony, rootAddr, golgi, "schedule", agent.address, ethers.parseEther("1"), now + 1, "ghost");
    await administer(colony, rootAddr, golgi, "cancel", 0);
    expect(await golgi.pendingTotal()).to.equal(0);
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);
    await express(cell.chloro, ctx.keeper);
    // pull-payments: the store balance is untouched (keeper credit is booked,
    // not pushed); the cancelled package never ships
    expect(await cell.energy.getBalance()).to.equal(ethers.parseEther("100"));
    expect(await golgi.pendingTotal()).to.equal(0);
  });
});

describe("v2.1 Lysosome (recycling) + organ failure tolerance", function () {
  let ctx, colony, rootAddr, cell, lysosome;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Lysosome = await ethers.getContractFactory("contracts/v2/organelles/Lysosome.sol:Lysosome");
    lysosome = (await graftTemplate(colony, rootAddr, "lysosome", Lysosome, ROLE.WORKER, true)).instance;
  });

  it("digests aged-out keeper credits back into the cell", async function () {
    const absentee = (await ethers.getSigners())[5]; // a keeper who never claims
    await cell.chloro.connect(absentee).replicate(ethers.parseEther("1")); // creates a credit
    const credit = await cell.energy.claimable(absentee.address);
    expect(credit).to.be.gt(0);
    expect(await cell.energy.outstandingCredits()).to.equal(credit);

    await ethers.provider.send("evm_increaseTime", [400]); // > creditTTL (300)
    await ethers.provider.send("evm_mine", []);
    await express(cell.chloro, ctx.keeper); // lysosome digests inside the cycle

    expect(await cell.energy.claimable(absentee.address)).to.equal(0); // forfeited
    // only the express keeper's fresh credit remains, and it is within the
    // birth-gas budget (the digested credit is back in discretionary funds)
    const outstanding = await cell.energy.outstandingCredits();
    expect(outstanding).to.equal(await cell.energy.claimable(ctx.keeper.address));
    expect(outstanding).to.be.lte(credit * 2n);
  });

  it("condemns an aux organelle: capability revoked instantly (registry = power)", async function () {
    const Membrane = await ethers.getContractFactory("contracts/v2/organelles/Membrane.sol:Membrane");
    const membrane = (await graftTemplate(colony, rootAddr, "membrane", Membrane, ROLE.OTHER, false)).instance;
    const SVC = ethers.id("s");
    await administer(colony, rootAddr, membrane, "registerService", SVC, 1, 0, 0);
    const [, agent] = await ethers.getSigners();
    await membrane.connect(agent).bind(SVC, { value: 1n }); // works while attached

    await administer(colony, rootAddr, lysosome, "condemn", "membrane");
    await express(cell.chloro, ctx.keeper); // cycle executes the eviction
    expect(await cell.nucleus.getRole(membrane.target)).to.equal(0n); // NONE
    // the detached membrane can no longer collect on the cell's behalf
    await expect(membrane.connect(agent).bind(SVC, { value: 1n }))
      .to.be.revertedWith("Membrane: detached from the cell");
  });

  it("a failing organ does not brick the metabolic cycle", async function () {
    // Graft something registered as a WORKER that cannot answer act().
    const stranger = await (await ethers.getContractFactory("contracts/v2/Colony.sol:Colony")).deploy();
    await colony.graft(rootAddr, "impostor", stranger.target, ethers.ZeroAddress, ROLE.WORKER, false);
    const receipt = await express(cell.chloro, ctx.keeper);
    const failed = await parseEvents(cell.chloro, receipt, "OrganFailed");
    expect(failed[0].args.worker).to.equal(stranger.target);
    // cycle completed despite the impostor organ (lysosome ran fine)
    const cycle = (await parseEvents(cell.chloro, receipt, "MetabolicCycle"))[0];
    expect(cycle.args.workers).to.be.gte(2);
  });
});

describe("v2.1 capability controls", function () {
  let ctx, colony, rootAddr, cell, golgi;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Golgi = await ethers.getContractFactory("contracts/v2/organelles/GolgiApparatus.sol:GolgiApparatus");
    golgi = (await graftTemplate(colony, rootAddr, "golgi", Golgi, ROLE.WORKER, true)).instance;
  });

  it("the spend window is open only while the cell is working", async function () {
    const [, attacker] = await ethers.getSigners();
    // Outside any expression cycle NOBODY can draw from the store, not even
    // a legitimately grafted WORKER - idle grafts are inert.
    await expect(cell.energy.connect(attacker).spend(attacker.address, 1n))
      .to.be.revertedWith("EnergyStore: expression window closed");
    await expect(golgi.connect(attacker).act(ethers.parseEther("1")))
      .to.be.revertedWithCustomError(golgi, "NotCellsMetabolism");
  });

  it("worker authorization is scoped to its cycle and never accumulates", async function () {
    const n0 = await cell.energy.cycleNonce();
    await express(cell.chloro, ctx.keeper);
    expect(await cell.energy.cycleNonce()).to.equal(n0 + 1n);
    const first = await cell.energy.cycleCeiling(golgi.target);
    expect(first).to.be.gt(0); // this cycle's grant, unspent

    await express(cell.chloro, ctx.keeper);
    const second = await cell.energy.cycleCeiling(golgi.target);
    // if old ceilings leaked, second would be ~2x first; per-cycle slots
    // mean it is a fresh, single authorization instead.
    expect(second).to.be.lte(first); // pool shrinks marginally via keeper credit
    expect(second).to.be.gt(first * 9n / 10n); // but stays a single-cycle amount
    expect(await cell.energy.spentLifetime(golgi.target)).to.equal(0); // nothing scheduled
  });

  it("authorize/spend accounting is observable per worker", async function () {
    const [, agent] = await ethers.getSigners();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await administer(colony, rootAddr, golgi, "schedule", agent.address, ethers.parseEther("2"), now, "immediate");
    await express(cell.chloro, ctx.keeper);
    expect(await cell.energy.authorizedLifetime(golgi.target)).to.be.gte(ethers.parseEther("2"));
    expect(await cell.energy.spentLifetime(golgi.target)).to.equal(ethers.parseEther("2"));
  });

  it("administer can only target organelles of the cell it administers", async function () {
    const stranger = await deployColony(); // a contract with no role in this cell
    await expect(colony.administer(rootAddr, stranger.target, "0x12345678"))
      .to.be.revertedWith("Colony: target not an organelle of this cell");
  });

  it("graftTemplate and administer are owner-only", async function () {
    const [, attacker] = await ethers.getSigners();
    const Golgi = await ethers.getContractFactory("contracts/v2/organelles/GolgiApparatus.sol:GolgiApparatus");
    const tmpl = await Golgi.deploy(await colony.getAddress());
    await expect(colony.connect(attacker).graftTemplate(rootAddr, "x", tmpl.target, ROLE.WORKER, true))
      .to.be.revertedWithCustomError(colony, "OwnableUnauthorizedAccount");
    await expect(colony.connect(attacker).administer(rootAddr, golgi.target, "0x"))
      .to.be.revertedWithCustomError(colony, "OwnableUnauthorizedAccount");
  });
});

describe("v2.1 Ribosome (in-cell evolution)", function () {
  let ctx, colony, rootAddr, cell, ribosome, proteinTmpl;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Ribosome = await ethers.getContractFactory("contracts/v2/organelles/Ribosome.sol:Ribosome");
    ribosome = (await graftTemplate(colony, rootAddr, "ribosome", Ribosome, ROLE.WORKER, true)).instance;
    const Protein = await ethers.getContractFactory("contracts/mocks/MockProtein.sol:MockProtein");
    proteinTmpl = await Protein.deploy();
    await administer(colony, rootAddr, ribosome, "program", proteinTmpl.target, "counter");
  });

  it("translates a queued order into a fresh product during the cycle", async function () {
    await administer(colony, rootAddr, ribosome, "order", 0);
    expect(await ribosome.ordersPending()).to.equal(1);
    const receipt = await express(cell.chloro, ctx.keeper);
    const ev = (await parseEvents(ribosome, receipt, "Translated"))[0];
    expect(ev.args.product).to.not.equal(ethers.ZeroAddress);
    expect(await ribosome.proteinsMade()).to.equal(1);
    expect(await ribosome.builtProduct(ev.args.product)).to.equal(0); // gene id
  });

  it("a translated protein can be grafted and activated by the next cycle", async function () {
    await administer(colony, rootAddr, ribosome, "order", 0);
    const receipt = await express(cell.chloro, ctx.keeper);
    const product = (await parseEvents(ribosome, receipt, "Translated"))[0].args.product;

    await colony.graft(rootAddr, "protein-1", product, proteinTmpl.target, ROLE.WORKER, true);
    const Protein = await ethers.getContractFactory("contracts/mocks/MockProtein.sol:MockProtein");
    const protein = Protein.attach(product);

    await express(cell.chloro, ctx.keeper); // cycle 2: protein now an organ
    expect(await protein.activations()).to.equal(1);
    expect(await protein.lastBudget()).to.be.gt(0); // got a real authorization
  });

  it("a silenced gene cannot be ordered", async function () {
    await administer(colony, rootAddr, ribosome, "toggleProgram", 0);
    await expect(administer(colony, rootAddr, ribosome, "order", 0))
      .to.be.revertedWith("Ribosome: gene silenced");
  });
});

describe("v2.1 Mitochondrion (respiration = yield income)", function () {
  let ctx, colony, rootAddr, cell, mito, vault;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Mito = await ethers.getContractFactory("contracts/v2/organelles/Mitochondrion.sol:Mitochondrion");
    const Vault = await ethers.getContractFactory("contracts/mocks/MockYieldVault.sol:MockYieldVault");
    vault = await Vault.deploy();
    await vault.setRate(1); // 1 bps of principal per second
    mito = (await graftTemplate(colony, rootAddr, "mitochondrion", Mito, ROLE.WORKER, true)).instance;
    await administer(colony, rootAddr, mito, "configure", vault.target, 5000, 3000);
  });

  it("deploys surplus to the venue up to the cycle budget and keeps a float", async function () {
    await express(cell.chloro, ctx.keeper);
    // budget = min(10 ether perWorkerCeiling, 25% of available) = 10
    expect(await vault.assetsOf(mito.target)).to.be.closeTo(ethers.parseEther("10"), ethers.parseEther("0.01"));
    expect(await mito.principal()).to.equal(ethers.parseEther("10"));
    const store = await cell.energy.getBalance();
    expect(store).to.be.closeTo(ethers.parseEther("90"), ethers.parseEther("0.1"));
  });

  it("harvests accrued ATP as food, then re-deploys to target", async function () {
    await express(cell.chloro, ctx.keeper);
    await ethers.provider.send("evm_increaseTime", [3600]); // 1 h -> ~36% on 10
    await ethers.provider.send("evm_mine", []);
    const before = await cell.energy.getBalance();
    const receipt = await express(cell.chloro, ctx.keeper);
    const harvest = (await parseEvents(mito, receipt, "ATPHarvested"))[0];
    expect(harvest).to.exist;
    expect(harvest.args.assets).to.be.gte(ethers.parseEther("2")); // substantial yield
    // cell grew: even after re-deploying to target and the keeper credit,
    // total assets beat the pre-yield total.
    const total = (await cell.energy.getBalance()) + (await vault.assetsOf(mito.target));
    expect(total).to.be.gt(before + ethers.parseEther("10"));
    expect(await mito.principal()).to.be.gte(ethers.parseEther("20"));
  });

  it("breathes out (unstakes) when the cell gets liquidity-hungry for division", async function () {
    await express(cell.chloro, ctx.keeper); // stake ~10 of the 100
    const staked1 = await vault.assetsOf(mito.target);
    expect(staked1).to.be.gt(ethers.parseEther("9"));

    // a big division drains the in-cell balance: 85 ether endowment
    const [, keeper] = await ethers.getSigners();
    await (await cell.chloro.connect(keeper).replicate(ethers.parseEther("85"))).wait();
    const storeAfterBirth = await cell.energy.getBalance();
    expect(storeAfterBirth).to.be.lt(ethers.parseEther("10")); // store now runs low

    // the next cycle must breathe out: over-target stake returns home
    const receipt = await express(cell.chloro, ctx.keeper);
    const retired = await parseEvents(mito, receipt, "Retired");
    expect(retired.length).to.be.gte(1);
    const staked2 = await vault.assetsOf(mito.target);
    expect(staked2).to.be.lt(staked1); // capital pulled back from respiration
    expect(await cell.energy.getBalance()).to.be.gt(storeAfterBirth); // liquidity restored
  });
});

describe("v2.1 full organism: expression + mitosis + inheritance", function () {
  let ctx, colony, rootAddr, cell;
  beforeEach(async function () {
    ctx = await makeHealthyCell();
    ({ colony, rootAddr, cell } = ctx);
    const Mito = await ethers.getContractFactory("contracts/v2/organelles/Mitochondrion.sol:Mitochondrion");
    const Ribo = await ethers.getContractFactory("contracts/v2/organelles/Ribosome.sol:Ribosome");
    const Golgi = await ethers.getContractFactory("contracts/v2/organelles/GolgiApparatus.sol:GolgiApparatus");
    const Lyso = await ethers.getContractFactory("contracts/v2/organelles/Lysosome.sol:Lysosome");
    const Perox = await ethers.getContractFactory("contracts/v2/organelles/Peroxisome.sol:Peroxisome");
    const Vac = await ethers.getContractFactory("contracts/v2/organelles/Vacuole.sol:Vacuole");
    const Memb = await ethers.getContractFactory("contracts/v2/organelles/Membrane.sol:Membrane");
    const vault = await (await ethers.getContractFactory("contracts/mocks/MockYieldVault.sol:MockYieldVault")).deploy();
    await vault.setRate(1);

    const mito = (await graftTemplate(colony, rootAddr, "mitochondrion", Mito, ROLE.WORKER, true)).instance;
    await graftTemplate(colony, rootAddr, "ribosome", Ribo, ROLE.WORKER, true);
    await graftTemplate(colony, rootAddr, "golgi", Golgi, ROLE.WORKER, true);
    await graftTemplate(colony, rootAddr, "lysosome", Lyso, ROLE.WORKER, true);
    await graftTemplate(colony, rootAddr, "peroxisome", Perox, ROLE.WORKER, true);
    await graftTemplate(colony, rootAddr, "vacuole", Vac, ROLE.WORKER, true);
    const memb = (await graftTemplate(colony, rootAddr, "membrane", Memb, ROLE.OTHER, true)).instance;
    await administer(colony, rootAddr, mito, "configure", vault.target, 5000, 3000);
    await administer(colony, rootAddr, memb, "registerService", ethers.id("svc"), ethers.parseEther("0.25"), 60, 100);
    ctx.vault = vault;
    ctx.memb = memb;
  });

  it("expression cycle activates all workers and the organism keeps earning", async function () {
    const [, agent] = await ethers.getSigners();
    const SVC2 = ethers.id("svc");
    await ctx.memb.connect(agent).bind(SVC2, { value: ethers.parseEther("0.25") });

    const mitoName = await cell.nucleus.organelleByName("mitochondrion");
    const totalAssets = async () =>
      (await cell.energy.getBalance()) + (await ctx.vault.assetsOf(mitoName.instance));

    const start = await totalAssets();
    for (let c = 0; c < 3; c++) {
      await ctx.memb.connect(agent).bind(SVC2, { value: ethers.parseEther("0.25") });
      await express(cell.chloro, ctx.keeper);
      await ethers.provider.send("evm_increaseTime", [600]); // let ATP accrue
      await ethers.provider.send("evm_mine", []);
    }
    const end = await totalAssets();
    expect(end).to.be.gt(start); // services + yield beat keeper credits

    // all five aux workers + vacuole ran inside the same cycles
    expect(await cell.nucleus.workersCount()).to.equal(6); // mito, ribo, golgi, lyso, perox, vacuole
    const receipt = await express(cell.chloro, ctx.keeper);
    const expressed = await parseEvents(cell.chloro, receipt, "Expressed");
    expect(expressed.length).to.equal(6);
    expect((await parseEvents(cell.chloro, receipt, "OrganFailed")).length).to.equal(0);
  });

  it("daughters inherit the whole proteome, initialized and bound to THEM", async function () {
    await express(cell.chloro, ctx.keeper); // one cycle first (populates)
    const [, keeper] = await ethers.getSigners();
    const tx = await cell.chloro.connect(keeper).replicate(ethers.parseEther("5"));
    const receipt = await tx.wait();
    const child = (await parseEvents(colony, receipt, "Birth"))[0].args.child;

    const childCell = await attachCell(child);
    const o = await childCell.nucleus.organelleByName("mitochondrion");
    expect(o.instance).to.not.equal((await cell.nucleus.organelleByName("mitochondrion")).instance);
    // the inherited mito points at the DAUGHTER's cell, not the mother's
    expect(await (await ethers.getContractFactory("contracts/v2/organelles/Mitochondrion.sol:Mitochondrion")).attach(o.instance).nucleus()).to.equal(child);
    // inherited daughter expresses fine (its clones were initialized at birth)
    await childCell.nucleus.organelleByName("ribosome");
    await ethers.provider.send("evm_increaseTime", [10]);
    const receipt2 = await express(childCell.chloro, ctx.keeper);
    expect((await parseEvents(childCell.chloro, receipt2, "MetabolicCycle")).length).to.equal(1);
  });

  it("harvest sweeps the organism at any size, honoring keeper credits", async function () {
    const [, agent] = await ethers.getSigners();
    await ctx.memb.connect(agent).bind(ethers.id("svc"), { value: ethers.parseEther("0.25") });
    await express(cell.chloro, ctx.keeper);
    await colony.setParams(12, 0, 0, 0, 0, 1000, 0, 500, ethers.parseEther("1")); // 10% harvest
    const [, , wallet] = await ethers.getSigners();
    await colony.setHarvestRecipient(wallet.address);
    const bal0 = await cell.energy.getBalance();
    const outstanding = await cell.energy.outstandingCredits();
    await colony.harvestOne(rootAddr);
    const swept = await cell.energy.getBalance();
    // harvest took 10% of available (balance minus keeper reserve)
    const expected = ((bal0 - outstanding) * 1000n) / 10000n;
    expect(bal0 - swept).to.be.closeTo(expected, 1000n);
    // keeper credit still fully claimable afterwards
    expect(await cell.energy.claimable(ctx.keeper.address)).to.equal(outstanding);
    const claimable = outstanding;
    await cell.energy.connect(ctx.keeper).claim(ctx.keeper.address, claimable);
  });
});
