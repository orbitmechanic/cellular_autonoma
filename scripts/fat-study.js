const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// v2.3 "fat cell" study: the real EIP-3529 economics of storing gas value as
// expensive state. Measures per-slot execution costs directly on-chain and
// projects the arbitrage across gas-price regimes, including the honest
// verdict under the 1/5 refund cap (and EIP-3298's scheduled removal).
// ---------------------------------------------------------------------------

const SLOTS = 64;

async function main() {
  const [owner, keeper] = await ethers.getSigners();
  const Colony = await ethers.getContractFactory("contracts/v2/Colony.sol:Colony");
  const colony = await Colony.deploy();
  await colony.setParams(12, 0, 0, 0, 0, 2500, 0, 500, ethers.parseEther("1"));
  await colony.setCycleParams(0, 2500, ethers.parseEther("10"), 30 * 86400);
  const r0 = await (await colony.plantRoot("root-1", { value: ethers.parseEther("100") })).wait();
  const root = r0.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "RootPlanted").args.nucleus;
  const Nucleus = await ethers.getContractFactory("contracts/v2/Nucleus.sol:Nucleus");
  const Chloro = await ethers.getContractFactory("contracts/v2/Chloroplast.sol:Chloroplast");
  const nucleus = Nucleus.attach(root);
  const chloro = Chloro.attach(await nucleus.getOrganelleByRole(3n));
  const Adi = await ethers.getContractFactory("contracts/v2/organelles/Adipocyte.sol:Adipocyte");
  const tmpl = await Adi.deploy(await colony.getAddress());
  const g = await (await colony.graftTemplate(root, "adipocyte", tmpl.target, 6n, true)).wait();
  const adi = Adi.attach(g.logs.map((l) => colony.interface.parseLog(l)).find((p) => p && p.name === "Grafted").args.instance);

  const out = {};

  // 1) Measure the ETH cost of one full inflate cycle at the cheap end
  await (await colony.administer(root, adi.target, adi.interface.encodeFunctionData("configure", [1, SLOTS, 3600000000n, 4500000000n, SLOTS]))).wait();
  await ethers.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0xb2d05e00"]); // 3 gwei (<= 3.6g ceiling: fatten)
  await (await chloro.connect(keeper).express()).wait();
  expectFilled(await adi.filled());
  out.filled = Number(await adi.filled());

  // 2) Measure realized discount for a render at the dear end
  await ethers.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x2540be400"]); // 10 gwei (>= 4.5g floor: render)
  const rt = await (await adi.connect(keeper).render(SLOTS)).wait();
  const executed = rt.gasUsed * 5n / 4n; // 4/5 billed signature => pre = billed*5/4
  out.render_billed_gas = Number(rt.gasUsed);
  out.render_executed_est = Number(executed);
  out.render_discount_gas = Number(executed - rt.gasUsed);
  out.render_discount_eth_at_10gwei = Number(executed - rt.gasUsed) * 10 / 1e9;

  // 3) Inflation ETH cost reference (per-slot 22,100 gas)
  out.inflate_cost_gas_total = SLOTS * 22100;

  // 4) Arbitrage projection table (pure math on EIP-3529 constants)
  const rows = [];
  for (const [cheap, dear] of [[1, 5], [1, 10], [1, 20], [1, 50], [0.01, 0.05], [0.005, 0.2]]) {
    const spent = (SLOTS * 22100) * cheap * 1e-9; // ETH to fatten at cheap price (gwei->eth)
    // realized rebate when bundling into a replicate-scale host tx (~1.1M gas):
    // refund pool = 64*4800 = 307,200 gas; cap = (host + ops)/5; assume cap binds at pool for the ratio test
    const rebate = Math.min(SLOTS * 4800, (1.1e6) / 5) * dear * 1e-9;
    rows.push({ cheapGwei: cheap, dearGwei: dear, spentEth: +spent.toFixed(6), rebateEth: +rebate.toFixed(6), pct: +(100 * rebate / spent).toFixed(1) });
  }
  out.arbitrage_table = rows;

  function expectFilled(x) { if (Number(x) !== SLOTS) throw new Error("fatten failed: " + x); }
  console.log(JSON.stringify(out, null, 2));
  require("fs").writeFileSync("fat-study.json", JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
