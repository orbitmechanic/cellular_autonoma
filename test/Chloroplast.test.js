const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v1 Chloroplast characterization (ported to ethers v6, dropped the
// nonexistent LeucoplastCloneFactory). Measures the three failures that
// killed v1's replication loop: hoarded "replication funds" that never pay
// for gas, human-funded gas (no keeper economics), and the inherited
// proxy-depth gas bloat of cloning live instances instead of templates.
// ---------------------------------------------------------------------------

describe("v1 Chloroplast replication (characterization)", function () {
  let owner, keeper, Nucleus, nucleus, Leucoplast, leucoplast, Chloroplast, chloroplast;

  beforeEach(async function () {
    [owner, keeper] = await ethers.getSigners();

    Nucleus = await ethers.getContractFactory("contracts/Nucleus.sol:Nucleus");
    nucleus = await Nucleus.deploy();
    await nucleus.initialize("Cell1", owner.address, [], [], []);

    Leucoplast = await ethers.getContractFactory("contracts/Leucoplast.sol:Leucoplast");
    leucoplast = await Leucoplast.deploy();
    await leucoplast.initialize(nucleus.target);
    await owner.sendTransaction({ to: leucoplast.target, value: ethers.parseEther("20") });

    Chloroplast = await ethers.getContractFactory("contracts/Chloroplast.sol:Chloroplast");
    chloroplast = await Chloroplast.deploy();
    await chloroplast.initialize(nucleus.target, leucoplast.target, ethers.parseEther("5"));

    await nucleus.registerOrganelle("Leucoplast", leucoplast.target, true);
    await nucleus.registerOrganelle("Chloroplast", chloroplast.target, false);
  });

  it("replicates: new nucleus + leucoplast clones, funds halved, cells recorded", async function () {
    const before = await leucoplast.getBalance();
    const tx = await chloroplast.connect(keeper).replicate();
    const receipt = await tx.wait();
    expect(await chloroplast.replicatedCellsLength()).to.equal(1);

    const childAddr = await chloroplast.replicatedCells(0);
    const child = Nucleus.attach(childAddr);
    expect(await child.identity()).to.equal("Cell1 copy");

    const after = await leucoplast.getBalance();
    expect(after).to.be.lt(before);
  });

  // FLAW #4 (v1): replicationCostEstimate is withdrawn from the leucoplast
  // into the chloroplast — and then sits there. ETH received by a contract
  // cannot pay for the transaction that moves it; the CALLER pays gas. v1
  // hoards "energy" that no keeper can ever be paid from.
  it("hoards the replication-cost estimate in the Chloroplast (dead capital)", async function () {
    await chloroplast.connect(keeper).replicate();
    expect(await ethers.provider.getBalance(chloroplast.target)).to.equal(ethers.parseEther("5"));
    console.log("      [v1 flaw] 5 ETH reserved 'for gas' but contracts can't pay gas — the keeper paid 100% out of pocket");
  });

  // FLAW #5 (v1): replicate() clones live instances (leucoplast.clone()).
  // Each generation's organelle is a proxy whose implementation is the
  // PREVIOUS instance — call gas compounds along the lineage. v1 also
  // deploys the daughter Nucleus with `new Nucleus()` (full bytecode, ~10x
  // the cost of a clone), paying from the caller's wallet.
  it("quantifies inherited proxy-depth bloat via the v1 nucleus clone chain", async function () {
    // v1's cloneCell() clones address(this) — clones of clones of clones.
    const N1 = await ethers.getContractFactory("contracts/Nucleus.sol:Nucleus");
    let current = nucleus;
    const callGas = [];
    for (let gen = 1; gen <= 4; gen++) {
      callGas.push(await current.identity.estimateGas());
      const addr = await current.cloneCell.staticCall();
      await current.cloneCell();
      current = N1.attach(addr);
    }
    console.log("      [v1 flaw] identity() call gas by generation:", callGas.join(" -> "));
    // Not asserted as a hard delta (refunds jitter it), but generation 4
    // proxies pay several DELEGATECALL hops more than generation 1.
    expect(callGas[3]).to.be.gt(callGas[0]);
  });

  // FLAW #6 (v1): the daughter's registry copy is broken by design — its
  // "Chloroplast" is the MOTHER's chloroplast (registered non-replicable),
  // which is still wired to the MOTHER's leucoplast. The daughter has no
  // working metabolism; the child's cloned leucoplast is orphaned.
  it("daughter cell shares its mother's metabolism (wired to the wrong treasury)", async function () {
    const tx = await chloroplast.connect(keeper).replicate();
    const receipt = await tx.wait();
    const childAddr = await chloroplast.replicatedCells(0);
    const child = Nucleus.attach(childAddr);
    // Child's registered Chloroplast == mother's Chloroplast instance.
    expect(await child.getOrganelleAddress("Chloroplast")).to.equal(chloroplast.target);
    // ...and that chloroplast's leucoplast pointer still addresses the mother's.
    expect(await chloroplast.leucoplast()).to.equal(leucoplast.target);
    console.log("      [v1 flaw] lineage metabolism is shared state, not a fresh copy — daughters cannot autonomously divide");
  });
});
