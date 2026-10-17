import React, { useState } from "react";
import { ethers } from "ethers";
import { BYTECODES } from "../lib/bytecodes.js";
import { ABI } from "../lib/abis.js";
import { ORGANELLE_INFO } from "../lib/abis.js";

const EQUIPABLE = [
  { key: "mitochondrion", contract: "Mitochondrion", role: 6 },
  { key: "membrane", contract: "Membrane", role: 5 },
  { key: "adipocyte", contract: "Adipocyte", role: 6 },
  { key: "ribosome", contract: "Ribosome", role: 6 },
  { key: "golgi", contract: "GolgiApparatus", role: 6 },
  { key: "lysosome", contract: "Lysosome", role: 6 },
  { key: "peroxisome", contract: "Peroxisome", role: 6 },
  { key: "vacuole", contract: "Vacuole", role: 6 },
];

const EXPLORERS = { 1: "https://etherscan.io", 8453: "https://basescan.org", 10: "https://optimism.etherscan.io", 42161: "https://arbiscan.io", 146: "https://sonicscan.org", 137: "https://polygonscan.com", 31337: "", 11155111: "https://sepolia.etherscan.io", 84532: "https://base-sepolia.etherscan.io" };

export default function Deploy({ session, onDone, onCancel }) {
  const [step, setStep] = useState(0); // 0 config, 1 running, 2 done
  const [name, setName] = useState("primordium");
  const [endowment, setEndowment] = useState("0.5");
  const [equip, setEquip] = useState(["membrane", "mitochondrion", "lysosome", "adipocyte"]);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  function push(msg, hash) {
    setLog((l) => [...l, { msg, hash, at: new Date().toLocaleTimeString() }]);
  }

  async function run() {
    setStep(1);
    setErr(null);
    try {
      const signer = session.signer;
      const ColonyF = new ethers.ContractFactory(ABI.Colony, BYTECODES.Colony, signer);
      push("deploying Colony (it auto-deploys its own genome templates)…");
      const colony = await ColonyF.deploy();
      await colony.waitForDeployment();
      const colonyAddr = await colony.getAddress();
      push("colony deployed", EXPLORERS[session.chainId] ? `${EXPLORERS[session.chainId]}/address/${colonyAddr}` : colonyAddr);

      push(`planting root cell "${name}" with ${endowment} ETH…`);
      const t0 = await colony.plantRoot(name, { value: ethers.parseEther(endowment || "0") });
      const r0 = await t0.wait();
      let rootAddr = null;
      for (const lg of r0.logs) {
        try {
          const ev = colony.interface.parseLog(lg);
          if (ev?.name === "RootPlanted") rootAddr = ev.args.nucleus;
        } catch { /* foreign log */ }
      }
      push("root cell alive", rootAddr);

      for (const key of equip) {
        const spec = EQUIPABLE.find((e) => e.key === key);
        const F = new ethers.ContractFactory(ABI[spec.contract], BYTECODES[spec.contract], signer);
        push(`forging ${ORGANELLE_INFO[key].label} template…`);
        const tmpl = await F.deploy(colonyAddr);
        await tmpl.waitForDeployment();
        push(`grafting ${ORGANELLE_INFO[key].label}…`);
        const g = await colony.graftTemplate(rootAddr, spec.key, await tmpl.getAddress(), spec.role, true);
        const gr = await g.wait();
        let inst = null;
        for (const lg of gr.logs) {
          try {
            const ev = colony.interface.parseLog(lg);
            if (ev?.name === "Grafted" && ev.args.name === spec.key) inst = ev.args.instance;
          } catch { /* foreign */ }
        }
        push(`${ORGANELLE_INFO[key].label} installed`, inst);
      }

      const org = { colony: colonyAddr, root: rootAddr, name, chainId: session.chainId, owner: session.address, createdAt: Date.now() };
      setResult(org);
      setStep(2);
    } catch (e) {
      setErr(e.shortMessage || e.message);
      setStep(0);
    }
  }

  return (
    <div className="deploy card">
      <div className="deploy-head"><h3>plant a new organism</h3><button className="x" onClick={onCancel}>×</button></div>

      {step === 0 && (
        <div className="deploy-form">
          <label>colony name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></label>
          <label>root endowment (ETH)<input value={endowment} onChange={(e) => setEndowment(e.target.value)} /></label>
          <div className="equip-block">
            <span className="equip-label">organs to graft (each ≈ 2 transactions)</span>
            <div className="equip-grid">
              {EQUIPABLE.map((s) => (
                <label key={s.key} className={"equip-chip" + (equip.includes(s.key) ? " on" : "")} style={{ "--zc": ORGANELLE_INFO[s.key].color }}>
                  <input type="checkbox" checked={equip.includes(s.key)}
                    onChange={(e) => setEquip(e.target.checked ? [...equip, s.key] : equip.filter((k) => k !== s.key))} />
                  {ORGANELLE_INFO[s.key].glyph} {ORGANELLE_INFO[s.key].label}
                </label>
              ))}
            </div>
          </div>
          {err && <div className="banner error">{err}</div>}
          <button className="cta big" onClick={run}>deploy organism ({2 + equip.length * 2} transactions)</button>
          <p className="muted tiny">Everything runs from your wallet · contracts are the audited v2.3 set · gas estimate appears per signature</p>
        </div>
      )}

      {step >= 1 && (
        <div className="deploy-run">
          <ul className="txlog">
            {log.map((l, i) => (
              <li key={i}><span className="tick">▸</span> {l.msg} {l.hash && typeof l.hash === "string" && l.hash.startsWith("0x") && l.hash.length > 42 && <a className="mono tiny" href={l.hash} target="_blank" rel="noreferrer">{l.hash.slice(0, 12)}…</a>}</li>
            ))}
          </ul>
          {step === 1 && <div className="spinner" />}
          {step === 2 && result && (
            <div className="deploy-done">
              <p className="born">❍ organism alive</p>
              <button className="cta" onClick={() => onDone(result)}>open its cell view ▸</button>
            </div>
          )}
          {err && <div className="banner error">{err}</div>}
        </div>
      )}
    </div>
  );
}
