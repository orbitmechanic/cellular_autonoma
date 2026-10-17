import React, { useEffect, useState } from "react";
import { loadOrgs, saveOrg, forgetOrg } from "../lib/store.js";
import { colonyCapital } from "../lib/wire.js";
import Deploy from "./Deploy.jsx";
import CellView from "./CellView.jsx";

export default function Console({ session }) {
  const [orgs, setOrgs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const [caps, setCaps] = useState({});

  useEffect(() => { setOrgs(loadOrgs()); }, []);

  useEffect(() => {
    let alive = true;
    async function poll() {
      for (const o of orgs) {
        if (o.chainId !== session.chainId) continue;
        try {
          const c = await colonyCapital(session.provider, o.colony, o.owner);
          if (alive) setCaps((p) => ({ ...p, [o.colony]: c }));
        } catch { /* keep last */ }
      }
    }
    if (orgs.length) { poll(); const t = setInterval(poll, 20000); return () => { alive = false; clearInterval(t); }; }
    return () => { alive = false; };
  }, [orgs, session]);

  const mine = orgs.filter((o) => o.chainId === session.chainId);

  return (
    <div className="console-grid">
      <aside className="orglist">
        <div className="orglist-head">
          <h3>Your organisms</h3>
          <button className="cta small" onClick={() => setDeploying(true)}>+ new organism</button>
        </div>
        {mine.length === 0 && !deploying && <p className="muted">No colonies on this chain yet. Plant a root — it takes about a minute.</p>}
        {mine.map((o) => (
          <div key={o.colony} className={"org-card" + (selected?.colony === o.colony ? " sel" : "")}
               onClick={() => { setDeploying(false); setSelected(o); }}>
            <span className="org-name">{o.name}</span>
            <span className="mono tiny">{o.colony.slice(0, 10)}…</span>
            {caps[o.colony] && <span className="org-capital">{fmtEth(caps[o.colony].food + caps[o.colony].staked + caps[o.colony].locked)} ETH · {caps[o.colony].nodes} cells</span>}
          </div>
        ))}
        {orgs.filter((o) => o.chainId !== session.chainId).length > 0 && (
          <p className="muted tiny">({orgs.filter((o) => o.chainId !== session.chainId).length} organism(s) saved on other chains)</p>
        )}
      </aside>

      <section className="workspace">
        {deploying && (
          <Deploy session={session}
            onDone={(org) => { saveOrg(org); setOrgs(loadOrgs()); setSelected(org); setDeploying(false); }}
            onCancel={() => setDeploying(false)} />
        )}
        {!deploying && selected && (
          <CellView session={session} org={selected} onForget={() => { forgetOrg(selected.colony, selected.chainId); setOrgs(loadOrgs()); setSelected(null); }} />
        )}
        {!deploying && !selected && mine.length > 0 && <p className="muted center">select an organism ←</p>}
        {!deploying && !selected && mine.length === 0 && (
          <div className="empty-stage">
            <div className="empty-cell">◍</div>
            <p>Nothing alive here yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function fmtEth(wei) {
  const n = Number(wei) / 1e18;
  return n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(3) : n.toFixed(5);
}
