const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// Exploratory cost study. Produces the numbers used in the findings deck:
//  - v1 mitosis gas profile (new Nucleus deploy + proxy-of-proxy clones)
//  - v1 inherited proxy-depth bloat (identity() call gas by lineage depth)
//  - v2 mitosis gas profile (template clones, flat call cost)
//  - projected cost per division across L1 / L2 / near-free chains
// ---------------------------------------------------------------------------

const CHAINS = [
  { name: "Ethereum L1", gwei: 15, eth: 3000 },
  { name: "Arbitrum One", gwei: 0.10, eth: 3000 },
  { name: "OP Mainnet (base)", gwei: 0.05, eth: 3000 },
  { name: "Base", gwei: 0.01, eth: 3000 },
  { name: "Sonic", gwei: 1.0, eth: 0.35 },
  { name: "Polygon PoS", gwei: 30, eth: 0.5 },
];

function usd(gas, gwei, ethUsd) {
  return (Number(gas) * gwei * 1e9 * ethUsd) / 1e18;
}

async function measure(fn) {
  const tx = await fn();
  const r = await tx.wait();
  return r.gasUsed;
}

async function main() {
  const [owner, keeper] = await ethers.getSigners();
  const out = {};

  // ---------------- v1 ----------------
  {
    const Nucleus = await ethers.getContractFactory("contracts/Nucleus.sol:Nucleus");
    const Leucoplast = await ethers.getContractFactory("contracts/Leucoplast.sol:Leucoplast");
    const Chloroplast = await ethers.getContractFactory("contracts/Chloroplast.sol:Chloroplast");
    const nucleus = await Nucleus.deploy();
    await nucleus.initialize("Cell1", owner.address, [], [], []);
    const leuco = await Leucoplast.deploy();
    await leuco.initialize(nucleus.target);
    await owner.sendTransaction({ to: leuco.target, value: ethers.parseEther("50") });
    const chloro = await Chloroplast.deploy();
    await chloro.initialize(nucleus.target, leuco.target, ethers.parseEther("5"));
    await nucleus.registerOrganelle("Leucoplast", leuco.target, true);
    await nucleus.registerOrganelle("Chloroplast", chloro.target, false);

    const gas = await measure(() => chloro.connect(keeper).replicate());
    out.v1_replicate_gas = Number(gas);

    // proxy-depth bloat: chain cloneCell and time identity() reads
    let current = nucleus;
    const depths = [];
    for (let g = 0; g < 6; g++) {
      const est = await current.identity.estimateGas();
      depths.push(Number(est));
      const addr = await current.cloneCell.staticCall();
      await current.cloneCell();
      current = Nucleus.attach(addr);
    }
    out.v1_identity_call_gas_by_depth = depths;

    let cur2 = nucleus;
    const ids = [];
    for (let g = 0; g < 6; g++) {
      const predicted = await cur2.cloneCell.staticCall();
      await cur2.cloneCell();
      cur2 = Nucleus.attach(predicted);
      ids.push((await cur2.identity()).length);
    }
    out.v1_identity_length_by_gen = ids;
  }

  // ---------------- v2 ----------------
  {
    const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
    const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
    const colony = await Colony.deploy();
    await colony.setParams(12, 0, 0, 0, 1000, 2500, 0, 500, ethers.parseEther("1"));
    const tx0 = await colony.plantRoot("root-1", { value: ethers.parseEther("200") });
    const r0 = await tx0.wait();
    const rootAddr = r0.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "RootPlanted").args.nucleus;
    const root = Nucleus.attach(rootAddr);
    const chloroAddr = await root.getOrganelleByRole(3);
    const Chloroplast = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
    const chloro = Chloroplast.attach(chloroAddr);

    out.v2_plantRoot_gas = Number(r0.gasUsed);
    out.v2_replicate_gas = Number(await measure(() => chloro.connect(keeper).replicate(ethers.parseEther("2"))));

    // flat call cost across generations (gen3)
    let cur = colony;
    let cellAddr = rootAddr;
    const callGases = [];
    for (let g = 1; g <= 6; g++) {
      const N = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
      const nuc = N.attach(cellAddr);
      const energy = await nuc.getOrganelleByRole(2);
      const E = await ethers.getContractFactory("contracts/v2/EnergyStore.sol:EnergyStore");
      callGases.push(Number(await E.attach(energy).getBalance.estimateGas()));
      if (g < 6) {
        const C = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
        const tx = await C.attach(await nuc.getOrganelleByRole(3)).connect(keeper).replicate(ethers.parseEther("0.2"));
        const r = await tx.wait();
        cellAddr = r.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Birth").args.child;
        // fund the child's energy so it can afford to divide too
        const childNuc = Nucleus.attach(cellAddr);
        const childEnergy = await childNuc.getOrganelleByRole(2);
        await owner.sendTransaction({ to: childEnergy, value: ethers.parseEther("10") });
      }
    }
    out.v2_energy_call_gas_by_depth = callGases;

    let a = rootAddr;
    const names = [];
    for (let g = 0; g < 5; g++) {
      const C = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
      const nuc = Nucleus.attach(a);
      const tx = await C.attach(await nuc.getOrganelleByRole(3)).connect(keeper).replicate(ethers.parseEther("0.2"));
      const r = await tx.wait();
      a = r.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Birth").args.child;
      const nn = Nucleus.attach(a);
      await owner.sendTransaction({ to: await nn.getOrganelleByRole(2), value: ethers.parseEther("10") });
      names.push(await nn.name());
    }
    out.v2_name_by_gen = names;
  }

  // cost projections for one v2 division (~1.1M gas) across chains
  const V2 = out.v2_replicate_gas;
  out.cost_per_v2_division_usd = CHAINS.map((c) => ({
    chain: c.name,
    usd: Number(usd(V2, c.gwei, c.eth).toFixed(6)),
  }));
  out.cost_per_v1_division_usd = CHAINS.map((c) => ({
    chain: c.name,
    usd: Number(usd(out.v1_replicate_gas, c.gwei, c.eth).toFixed(6)),
  }));

  console.log(JSON.stringify(out, null, 2));
  require("fs").writeFileSync("gas-study.json", JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
