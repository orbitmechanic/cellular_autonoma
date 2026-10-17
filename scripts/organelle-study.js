const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v2.1 exploratory study: cost of the full organism.
//  - express() cycle with the complete WORKER cast vs an idle cell
//  - keeper-credit vs shipped-value per cycle (is the day-job profitable?)
//  - mitosis with a full proteome (birth clones + inits every organ)
//  - harvest sweep over a 3-generation, organ-rich colony
// ---------------------------------------------------------------------------

async function main() {
  const [owner, keeper] = await ethers.getSigners();
  const out = {};

  const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
  const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
  const Chloro = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
  const colony = await Colony.deploy();
  await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
  await colony.setCycleParams(0, 2500, ethers.parseEther("10"), 30 * 86400);

  async function plant(name) {
    const tx = await colony.plantRoot(name, { value: ethers.parseEther("100") });
    const r = await tx.wait();
    return r.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "RootPlanted").args.nucleus;
  }

  async function graftAll(cell) {
    const names = [
      ["mitochondrion", "Mitochondrion", 6n],
      ["ribosome", "Ribosome", 6n],
      ["golgi", "GolgiApparatus", 6n],
      ["lysosome", "Lysosome", 6n],
      ["peroxisome", "Peroxisome", 6n],
      ["vacuole", "Vacuole", 6n],
      ["membrane", "Membrane", 5n],
    ];
    for (const [name, file, role] of names) {
      const F = await ethers.getContractFactory(`contracts/v2/organelles/${file}.sol:${file}`);
      const tmpl = await F.deploy(await colony.getAddress());
      const g = await colony.graftTemplate(cell, name, tmpl.target, role, true);
      await g.wait();
    }
  }

  const bare = await plant("bare");
  const full = await plant("full");
  await graftAll(full);

  const nucFull = Nucleus.attach(full);
  const chloroFull = Chloro.attach(await nucFull.getOrganelleByRole(3));
  const nucBare = Nucleus.attach(bare);
  const chloroBare = Chloro.attach(await nucBare.getOrganelleByRole(3));

  // income: give the full cell a service and one bind per cycle
  const memb = await nucFull.organelleByName("membrane");
  const Membrane = await ethers.getContractFactory("contracts/v2/organelles/Membrane.sol:Membrane");
  const membrane = Membrane.attach(memb.instance);
  const SVC = ethers.id("study.svc");
  await (await colony.administer(full, membrane.target, membrane.interface.encodeFunctionData("registerService", [SVC, ethers.parseEther("0.5"), 60, 1000]))).wait();
  await membrane.bind(SVC, { value: ethers.parseEther("0.5") });

  const eIdle = await chloroBare.connect(keeper).express.estimateGas();
  const eFull = await chloroFull.connect(keeper).express.estimateGas();
  out.express_idle_gas = Number(eIdle);
  out.express_full_cast_gas = Number(eFull);

  // one live full cycle from a tx receipt (worker spends: none due, so pure overhead)
  await (await chloroFull.connect(keeper).express()).wait();
  out.express_cycle2_gas = Number((await chloroFull.connect(keeper).express.estimateGas()));

  // mitosis with full proteome: mother divides; daughter gets 7 fresh organs
  const tx = await chloroFull.connect(keeper).replicate(ethers.parseEther("5"));
  const r = await tx.wait();
  const child = r.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Birth").args.child;
  out.replicate_with_proteome_gas = Number(r.gasUsed);
  const childNuc = Nucleus.attach(child);
  out.daughter_organelles = Number(await childNuc.organelleCount());
  out.daughter_workers = Number(await childNuc.workersCount());
  await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));

  console.log(JSON.stringify(out, null, 2));
  require("fs").writeFileSync("organelle-study.json", JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
