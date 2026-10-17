import { ethers } from "ethers";
import { ABI, ROLE, roleColor } from "./abis.js";

export const iface = (name) => new ethers.Interface(ABI[name]);

export async function connect() {
  if (!window.ethereum) throw new Error("No injected wallet found (MetaMask/Rabby/Frame?)");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const net = await provider.getNetwork();
  return { provider, signer, address: await signer.getAddress(), chainId: Number(net.chainId) };
}

export async function readProvider() {
  return new ethers.BrowserProvider(window.ethereum);
}

// ------------------------------ reads --------------------------------------

export async function attachColony(provider, addr) {
  return new ethers.Contract(addr, ABI.Colony, provider);
}

export async function cellSnapshot(provider, colonyAddr, cellAddr) {
  const n = new ethers.Contract(cellAddr, ABI.Nucleus, provider);
  const [name, serial, generation, parentCell, alive, count, names, childrenLen] = await Promise.all([
    n.name(), n.serial(), n.generation(), n.parentCell(), n.alive(),
    n.organelleCount(), n.organelleNames(), n.childrenLength(),
  ]);
  const organelles = [];
  for (let i = 0; i < Number(count); i++) {
    const o = await n.organelleAt(i);
    organelles.push({
      name: names[i],
      instance: o.instance,
      template: o.template,
      role: Number(o.role),
      replicable: o.replicable,
      color: colorFor(names[i], Number(o.role)),
    });
  }
  // enrich the two organs that drive the headline numbers
  const energy = organelles.find((o) => o.role === ROLE.ENERGY);
  const chloro = organelles.find((o) => o.role === ROLE.METABOLISM);
  let capital = { balance: 0n, available: 0n, outstanding: 0n, totalFood: 0n, cycleNonce: 0n };
  let chloroStats = { births: 0n, cycles: 0n, lastBirth: 0n, lastExpress: 0n };
  let mito = null, adipocyte = null, vacuole = null, membrane = null, ribosome = null;
  if (energy) {
    const e = new ethers.Contract(energy.instance, ABI.EnergyStore, provider);
    [capital.balance, capital.available, capital.outstanding, capital.totalFood, capital.cycleNonce] =
      await Promise.all([e.getBalance(), e.available(), e.outstandingCredits(), e.totalFood(), e.cycleNonce()]);
  }
  if (chloro) {
    const c = new ethers.Contract(chloro.instance, ABI.Chloroplast, provider);
    [chloroStats.births, chloroStats.cycles, chloroStats.lastBirth, chloroStats.lastExpress] =
      await Promise.all([c.births(), c.cycles(), c.lastBirth(), c.lastExpress()]);
  }
  const mitoO = organelles.find((o) => o.name === "mitochondrion");
  if (mitoO && mitoO.instance !== ethers.ZeroAddress) {
    const m = new ethers.Contract(mitoO.instance, ABI.Mitochondrion, provider);
    const [vault, staked] = await Promise.all([m.vault(), m.stakedAssets()]);
    mito = { instance: mitoO.instance, vault, staked };
  }
  const adiO = organelles.find((o) => o.name === "adipocyte");
  if (adiO && adiO.instance !== ethers.ZeroAddress) {
    const a = new ethers.Contract(adiO.instance, ABI.Adipocyte, provider);
    const [filled, rent, blubber, ceiling] = await Promise.all([a.filled(), a.rentEarned(), a.blubberValue(), a.inflateBasefeeCeiling()]);
    adipocyte = { instance: adiO.instance, filled, rent, blubber, ceiling };
  }
  const vacO = organelles.find((o) => o.name === "vacuole");
  if (vacO && vacO.instance !== ethers.ZeroAddress) {
    const v = new ethers.Contract(vacO.instance, ABI.Vacuole, provider);
    vacuole = { instance: vacO.instance, pressure: await v.pressure() };
  }
  const memO = organelles.find((o) => o.name === "membrane");
  if (memO && memO.instance !== ethers.ZeroAddress) {
    const m = new ethers.Contract(memO.instance, ABI.Membrane, provider);
    const [totalBinds, lifetimeFees, agentName] = await Promise.all([m.totalBinds(), m.lifetimeFees(), m.agentName()]);
    membrane = { instance: memO.instance, totalBinds, lifetimeFees, agentName };
  }
  const ribO = organelles.find((o) => o.name === "ribosome");
  if (ribO && ribO.instance !== ethers.ZeroAddress) {
    const r = new ethers.Contract(ribO.instance, ABI.Ribosome, provider);
    ribosome = { instance: ribO.instance, proteins: await r.proteinsMade() };
  }
  return {
    addr: cellAddr, name, serial: Number(serial), generation: Number(generation),
    parentCell, alive, childrenLen: Number(childrenLen), organelles,
    capital, chloroStats, mito, adipocyte, vacuole, membrane, ribosome,
  };
}

function colorFor(name, role) {
  const known = {
    nucleus: "#9be8ff", energy: "#ffd166", chloroplast: "#06d6a0", mitochondrion: "#b388ff",
    ribosome: "#f78c6b", golgi: "#4ecdc4", lysosome: "#cfd8dc", peroxisome: "#ef5350",
    vacuole: "#81d4fa", membrane: "#aed581", adipocyte: "#ffe082",
  };
  return known[name] || roleColor(Number(role));
}

export async function colonyTree(provider, colonyAddr, cellAddr, maxNodes = 60) {
  // BFS over children pointers, returns flat list of {depth, addr}
  const out = [];
  const queue = [{ depth: 0, addr: cellAddr }];
  const colony = new ethers.Contract(colonyAddr, ABI.Colony, provider);
  const rootsN = Number(await colony.rootsLength());
  for (let r = 0; r < rootsN && out.length < maxNodes; r++) {
    queue.push({ depth: 0, addr: await colony.roots(r) });
  }
  while (queue.length && out.length < maxNodes) {
    const { depth, addr } = queue.shift();
    if (out.some((o) => o.addr.toLowerCase() === addr.toLowerCase())) continue;
    out.push({ depth, addr });
    try {
      const n = new ethers.Contract(addr, ABI.Nucleus, provider);
      const kids = Number(await n.childrenLength());
      for (let i = 0; i < kids; i++) queue.push({ depth: depth + 1, addr: await n.children(i) });
    } catch { /* not a nucleus; skip */ }
  }
  return out;
}

export async function colonyCapital(provider, colonyAddr, colonyOwnerAddr) {
  const colony = new ethers.Contract(colonyAddr, ABI.Colony, provider);
  const roots = [];
  const rn = Number(await colony.rootsLength());
  for (let r = 0; r < rn; r++) roots.push(await colony.roots(r));
  const nodes = await colonyTree(provider, colonyAddr, roots[0] || ethers.ZeroAddress);
  let food = 0n, keeperReserve = 0n, staked = 0n, locked = 0n, fat = 0n;
  for (const { addr } of nodes) {
    try {
      const snap = await cellSnapshot(provider, colonyAddr, addr);
      food += snap.capital.balance;
      keeperReserve += snap.capital.outstanding;
      if (snap.mito) staked += snap.mito.staked;
      if (snap.vacuole) locked += snap.vacuole.pressure;
      if (snap.adipocyte) fat += snap.adipocyte.blubber;
    } catch { /* transient */ }
  }
  const treasury = await provider.getBalance(colonyAddr);
  return { nodes: nodes.length, food, keeperReserve, staked, locked, fat, treasury, owner: colonyOwnerAddr };
}

export async function colonyParams(provider, colonyAddr) {
  const c = new ethers.Contract(colonyAddr, ABI.Colony, provider);
  const keys = ["owner", "harvestRecipient", "maxGeneration", "minBirthInterval", "minReserve", "birthFee",
    "titheBps", "harvestBps", "keeperStipend", "birthGasBudget", "maxRefundBps", "maxRefundCap",
    "cycleMinInterval", "workerBudgetBps", "perWorkerCeiling", "creditTTL", "workerGasStipend", "maxAuxiliaryOrganelles"];
  const out = {};
  for (const k of keys) out[k] = await c[k]();
  return out;
}

// ------------------------------ writes --------------------------------------

export async function tx(signer, contract, method, args = [], overrides = {}) {
  const t = await contract[method](...args, overrides);
  const r = await t.wait();
  return { tx: t, receipt: r };
}

// wrap an organelle-core call through colony.administer
export function adminData(organelleAbiName, fnFragment, args) {
  return iface(organelleAbiName).encodeFunctionData(fnFragment.split("(")[0], args);
}
