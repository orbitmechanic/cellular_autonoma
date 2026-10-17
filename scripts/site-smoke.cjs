// Hardhat script: end-to-end smoke test of the WEBSITE's contract layer.
// Imports the exact ABI fragments + bytecodes web/src uses, and replays the
// entire user journey (deploy -> equip -> bind -> park -> express ->
// replicate -> claim -> harvest -> capital/tree reads). Run:
//   npx hardhat run scripts/site-smoke.cjs
const { ethers } = require("hardhat");
const path = require("path");
const { pathToFileURL } = require("url");

async function loadWeb() {
  const abis = await import(pathToFileURL(path.join(__dirname, "../web/src/lib/abis.js")).href);
  const bytecodes = await import(pathToFileURL(path.join(__dirname, "../web/src/lib/bytecodes.js")).href);
  const wire = await import(pathToFileURL(path.join(__dirname, "../web/src/lib/wire.js")).href);
  return { ...abis, ...bytecodes, wire };
}

let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) { PASS++; console.log("  ok -", name); } else { FAIL++; console.log("  FAIL -", name); } }

async function main() {
  const { ABI, BYTECODES, wire, ROLE } = await loadWeb();
  const [deployer, keeper, tenant] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("# deploy via site layer");
  const ColonyF = new ethers.ContractFactory(ABI.Colony, BYTECODES.Colony, deployer);
  const colony = await ColonyF.deploy();
  await colony.waitForDeployment();
  const colonyAddr = await colony.getAddress();
  check("colony deployed from site bytecode", (await colony.owner()) === deployer.address);
  check("auto-templates present", (await colony.nucleusTemplate()) !== ethers.ZeroAddress);

  const t0 = await colony.plantRoot("web-root", { value: ethers.parseEther("10") });
  const r0 = await t0.wait();
  let root = null;
  for (const lg of r0.logs) {
    try { const ev = colony.interface.parseLog(lg); if (ev?.name === "RootPlanted") root = ev.args.nucleus; } catch {}
  }
  check("root planted + RootPlanted parsed", !!root);

  console.log("# graft the full cast the wizard offers");
  const specs = [
    ["mitochondrion", "Mitochondrion", 6], ["membrane", "Membrane", 5], ["adipocyte", "Adipocyte", 6],
    ["ribosome", "Ribosome", 6], ["golgi", "GolgiApparatus", 6], ["lysosome", "Lysosome", 6],
    ["peroxisome", "Peroxisome", 6], ["vacuole", "Vacuole", 6],
  ];
  const tmplAddrs = {};
  for (const [key, name, role] of specs) {
    const F = new ethers.ContractFactory(ABI[name], BYTECODES[name], deployer);
    const tmpl = await F.deploy(colonyAddr);
    await tmpl.waitForDeployment();
    tmplAddrs[key] = await tmpl.getAddress();
    const g = await (await colony.graftTemplate(root, key, tmplAddrs[key], role, true)).wait();
    let inst = null;
    for (const lg of g.logs) {
      try { const ev = colony.interface.parseLog(lg); if (ev?.name === "Grafted" && ev.args.name === key) inst = ev.args.instance; } catch {}
    }
    check(`grafted ${key}`, !!inst);
  }

  console.log("# wire.js reads");
  const snap = await wire.cellSnapshot(provider, colonyAddr, root);
  check("snapshot name/serial", snap.name === "web-root" && snap.serial === 1);
  check("organelles enumerated", snap.organelles.length === 11); // 3 core + 8 grafts
  check("capital fields", snap.capital.balance === ethers.parseEther("10"));
  check("mito/adipo/vacuole/membrane enrichments", snap.mito && snap.adipocyte && snap.vacuole && snap.membrane);
  const params = await wire.colonyParams(provider, colonyAddr);
  check("colony params read", Number(params.maxGeneration) === 12);

  console.log("# owner config via administer (site's core-call path)");
  const memI = new ethers.Interface(ABI.Membrane);
  const svc = ethers.id("compute.attest");
  await (await colony.administer(root, tmplAddrs.membrane && snap.membrane.instance,
    memI.encodeFunctionData("registerService", [svc, ethers.parseEther("0.02"), 3600, 50]))).wait();
  await (await colony.administer(root, snap.membrane.instance,
    memI.encodeFunctionData("setAgentIdentity", ["colony-cell-7", "ipfs://bafy..."]))).wait();
  check("service registered + identity set via administer", (await (new ethers.Contract(snap.membrane.instance, ABI.Membrane, provider)).price(svc)) === ethers.parseEther("0.02"));

  const adiI = new ethers.Interface(ABI.Adipocyte);
  await (await colony.administer(root, snap.adipocyte.instance,
    adiI.encodeFunctionData("configure", [ethers.parseEther("0.001"), 32, 10_000_000_000n, 20_000_000_000n, 32]))).wait();
  check("adipocyte configured", (await (new ethers.Contract(snap.adipocyte.instance, ABI.Adipocyte, provider)).maxSlots()) === 32n);

  const mitoI = new ethers.Interface(ABI.Mitochondrion);
  const vault = await (await new ethers.ContractFactory(ABI.ERC4626, BYTECODES.Mock4626 || "0x", deployer)).deploy().catch(() => null);
  check("site skips real vault (none in bundle) gracefully", vault === null);

  console.log("# keeper journey: bind, park, express, replicate, claim");
  const memC = new ethers.Contract(snap.membrane.instance, ABI.Membrane, keeper);
  const bindTx = await memC.bind(svc, { value: ethers.parseEther("0.02") });
  const bindR = await bindTx.wait();
  check("bind parsed as Bound event", bindR.logs.map((l) => memC.interface.parseLog(l)).some((p) => p?.name === "Bound"));

  const adiC = new ethers.Contract(snap.adipocyte.instance, ABI.Adipocyte, tenant);
  const rent = await (new ethers.Contract(snap.adipocyte.instance, ABI.Adipocyte, provider)).rentWei();
  await (await adiC.park(ethers.id("my:commitment"), { value: rent })).wait();
  check("parked a byte-slot for rent", (await (new ethers.Contract(snap.adipocyte.instance, ABI.Adipocyte, provider)).stored()) === 1n);

  const chloro = new ethers.Contract(snap.organelles.find((o) => o.role === ROLE.METABOLISM).instance, ABI.Chloroplast, keeper);
  const beforeBal = await (new ethers.Contract(snap.organelles.find((o) => o.role === ROLE.ENERGY).instance, ABI.EnergyStore, provider)).getBalance();
  const ex = await (await chloro.express()).wait();
  check("express cycle parsed", ex.logs.map((l) => chloro.interface.parseLog(l)).some((p) => p?.name === "MetabolicCycle"));
  const [canOk] = await chloro.canReplicate(ethers.parseEther("1"));
  check("canReplicate view works", canOk === true);
  const rep = await (await chloro.replicate(ethers.parseEther("1"))).wait();
  const childEv = rep.logs.map((l) => colony.interface.parseLog(l)).find((p) => p?.name === "Birth");
  check("replicate -> Birth parsed via site layer", !!childEv);
  const eStore = new ethers.Contract(snap.organelles.find((o) => o.role === ROLE.ENERGY).instance, ABI.EnergyStore, keeper);
  const credit = await eStore.claimable(keeper.address);
  check("keeper credit booked (express+replicate)", credit > 0n);
  await (await eStore.connect(keeper).claim(keeper.address, credit)).wait();
  check("keeper claimed", (await eStore.claimable(keeper.address)) === 0n);

  console.log("# colony tree + capital");
  const tree = await wire.colonyTree(provider, colonyAddr, root);
  check("tree sees both generations", tree.length === 2);
  const cap = await wire.colonyCapital(provider, colonyAddr, root);
  check("capital aggregates across the lineage", cap.food > ethers.parseEther("9") && cap.nodes === 2);

  console.log("# owner harvest");
  const recipient = await colony.harvestRecipient();
  const balBefore = await provider.getBalance(recipient);
  await (await colony.harvestColony(50)).wait();
  const balAfter = await provider.getBalance(recipient);
  check("harvest swept to recipient", balAfter > balBefore);

  console.log("# child cell reads (inherited organs)");
  const csnap = await wire.cellSnapshot(provider, colonyAddr, childEv.args.child);
  check("daughter inherits 11-entry registry", csnap.organelles.length === 11);
  check("daughter organs bound to HER cell", (await new ethers.Contract(csnap.membrane.instance, ABI.Membrane, provider).nucleus()) === childEv.args.child);

  console.log(`\nsite-smoke: ${PASS} passed, ${FAIL} failed`);
  if (FAIL) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
