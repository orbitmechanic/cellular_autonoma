import React from "react";
import { ORGANELLE_INFO } from "../lib/abis.js";

const CAST_KEYS = ["nucleus", "energy", "chloroplast", "mitochondrion", "membrane", "adipocyte", "ribosome", "golgi", "lysosome", "peroxisome", "vacuole"];

export default function Landing({ onLaunch, connected }) {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1><span className="glow-word">Self-replicating</span> digital organisms that <em>pay their own bills</em>.</h1>
          <p className="lede">
            A <b>cellular autonoma</b> colony is a family of smart-contract <i>cells</i> — nucleus, chloroplast,
            mitochondrion, membrane — that store capital, do useful work for on-chain agents, reimburse their own
            keepers from their own earnings, divide when they can afford it, and <b>harvest profit back to your wallet</b>.
            You deploy one in a browser. It lives on-chain forever.
          </p>
          <div className="hero-ctas">
            <button className="cta big" onClick={onLaunch}>{connected ? "open the organism console ▸" : "connect wallet & begin ▸"}</button>
            <a className="ghostlink" href="https://github.com/orbitmechanic/cellular_autonoma/blob/main/DESIGN.md" target="_blank" rel="noreferrer">read the science ↗</a>
          </div>
          <ul className="stat-strip">
            <li><b>85</b> passing tests</li>
            <li><b>18</b> audit findings dispositioned</li>
            <li><b>0</b> open highs</li>
            <li><b>$0.03</b> metabolism on Base</li>
          </ul>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="dish">
            <div className="dish-ring" />
            <div className="dish-ring r2" />
            <img src="./assets/mitosis_animated.gif" alt="" className="mitosis-img" loading="eager" />
            <span className="orbit-glyph g1">≋</span>
            <span className="orbit-glyph g2">❂</span>
            <span className="orbit-glyph g3">◍</span>
            <span className="orbit-glyph g4">⧉</span>
            <span className="orbit-glyph g5">☣</span>
            <span className="orbit-glyph g6">⁘</span>
          </div>
          <div className="hero-caption">mitosis — as performed by smart contracts</div>
        </div>
      </section>

      <section className="how">
        <h2>Three steps to a living colony</h2>
        <div className="how-grid">
          <div className="step"><span className="stepnum">1</span><h3>Plant the root</h3><p>One click deploys your Colony (its own organelle genome included) and plants a root cell funded with whatever capital you choose.</p></div>
          <div className="step"><span className="stepnum">2</span><h3>Equip organs</h3><p>Pick your creature: yield-staking mitochondria, a service-selling membrane, scheduled-payroll Golgi, even fat cells that bank cheap gas.</p></div>
          <div className="step"><span className="stepnum">3</span><h3>Let it work</h3><p>Keepers and AI agents run its metabolism — <b>paid by the cell itself</b>. It earns, divides, and you harvest the surplus to your wallet.</p></div>
        </div>
      </section>

      <section className="economics">
        <div className="econ-text">
          <h2>Why it doesn't die of hunger</h2>
          <p>The EVM hard rule: a contract can never send its own transaction. So a cell can't literally act alone —
          but it can be <b>economically autonomous</b>. Every function a stranger can trigger (division, metabolic
          cycles, gas-rendering) <i>reimburses its trigger from the cell's own food</i>, capped so nobody can loot it.
          Working for your organism is a paying job — which means keepers, bots and agents compete to keep it alive.</p>
          <ul className="econ-list">
            <li><b>Mitochondrion</b> — idle capital breathes: staked into any ERC-4626 vault (Aave, Morpho), accrued yield lands as food.</li>
            <li><b>Membrane</b> — priced service receptors: AI agents in the ERC-8004 economy pay per bind.</li>
            <li><b>Adipocyte</b> — fat cells bank cheap gas as expensive storage and rebate keepers when gas is dear (EIP-3529-honest).</li>
            <li><b>Lysosome</b> — sweeps expired keeper credits and condemned organs back into the larder. Nothing rots.</li>
          </ul>
        </div>
        <div className="econ-art">
          <figure className="vintage"><img src="./assets/Kuensting_plantmitosis_color.gif" alt="1882 cell division drawings, colored" loading="lazy" /><figcaption>cell division, drawn 1882 — your contracts do the same thing since 2026</figcaption></figure>
          <figure className="streaming"><img src="./assets/Elodea-ciclose.gif" alt="cytoplasmic streaming in Elodea cells" loading="lazy" /><figcaption>cytoplasmic streaming — capital moving where the organism needs it</figcaption></figure>
        </div>
      </section>

      <section className="zoo">
        <h2>The organelle cast</h2>
        <p className="sub">Every organ below is an optional, graftable module. Cells share one genome; colonies differentiate.</p>
        <div className="zoo-grid">
          {CAST_KEYS.map((k) => {
            const info = ORGANELLE_INFO[k];
            return (
              <div className="zoo-card" key={k} style={{ "--zc": info.color }}>
                <span className="zoo-glyph">{info.glyph}</span>
                <h4>{info.label}</h4>
                <p>{info.blurb}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="trust">
        <h2>Built like software, audited like DeFi</h2>
        <div className="trust-grid">
          <div><b>Standards-aligned</b><span>ERC-165 registry gates · ERC-4626 yield · ERC-8004 agent discovery · EIP-3529-correct gas economics · EIP-6780-safe</span></div>
          <div><b>Full audit on the record</b><span>18 findings, per-organ gas stipends, clone-init race closed, bounded-growth everywhere — AUDIT.md, PR #28</span></div>
          <div><b>No oracle, no admin keys over funds in flight</b><span>Capability lives in on-chain registries. Evict an organ and its power dies mid-block.</span></div>
        </div>
        <div className="final-cta">
          <button className="cta big" onClick={onLaunch}>{connected ? "open console ▸" : "connect wallet ▸"}</button>
          <span>works on Ethereum L1, Base, Arbitrum, OP, Sonic, Polygon — any EVM</span>
        </div>
      </section>
    </div>
  );
}
