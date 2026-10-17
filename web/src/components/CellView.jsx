import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { ABI, ORGANELLE_INFO, CONTROLS, ROLE } from "../lib/abis.js";
import { cellSnapshot, colonyTree, colonyParams, colonyCapital, iface } from "../lib/wire.js";
import { fmtEth } from "./Console.jsx";

const CENTER = { x: 0, y: 0 };

function nodePos(o, i, n) {
  const core = [1, 2, 3].includes(o.role); // NUCLEUS/ENERGY/METABOLISM inner ring
  if (o.role === ROLE.NUCLEUS) return CENTER;
  const a = (i / n) * 2 * Math.PI - Math.PI / 2;
  const R = core ? 130 : 215;
  return { x: Math.cos(a) * R, y: Math.sin(a) * R };
}

export default function CellView({ session, org, onForget }) {
  const [cell, setCell] = useState(org.root);
  const [snap, setSnap] = useState(null);
  const [params, setParams] = useState(null);
  const [sel, setSel] = useState(null); // selected organelle name
  const [fee, setFee] = useState(null);
  const [claimable, setClaimable] = useState(0n);
  const [tree, setTree] = useState(null);
  const [cap, setCap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  const provider = session.provider;
  const colony = useMemo(() => new ethers.Contract(org.colony, ABI.Colony, provider), [org.colony, provider]);
  const isOwner = params && session.address.toLowerCase() === params.owner.toLowerCase();

  async function refresh() {
    try {
      const s = await cellSnapshot(provider, org.colony, cell);
      setSnap(s);
      const p = await colonyParams(provider, org.colony);
      setParams(p);
      const f = await provider.getFeeData();
      setFee(f);
      const energy = s.organelles.find((o) => o.role === ROLE.ENERGY);
      if (energy) {
        const e = new ethers.Contract(energy.instance, ABI.EnergyStore, provider);
        setClaimable(await e.claimable(session.address));
      }
      const tr = await colonyTree(provider, org.colony, org.root);
      setTree(tr);
      const c = await colonyCapital(provider, org.colony, org.root);
      setCap(c);
    } catch (e) { setErr(e.shortMessage || e.message); }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [cell, org.colony]);

  const selO = snap?.organelles.find((o) => o.name === sel);
  const info = sel ? ORGANELLE_INFO[sel] || { label: sel, color: selO?.color || "#ccc", glyph: "◦", blurb: "grafted module" } : null;

  async function run(label, fn) {
    setBusy(true); setErr(null); setOk(null);
    try { await fn(); setOk(`${label}: transaction confirmed`); await refresh(); }
    catch (e) { setErr(e.shortMessage || e.reason || e.message); }
    finally { setBusy(false); }
  }

  function controlAction(c, values) {
    return run(c.label, async () => {
      const target = selO.instance;
      const parseEth = (v) => ethers.parseEther(v || "0");
      if (c.special === "feed") {
        const energy = snap.organelles.find((o) => o.role === ROLE.ENERGY);
        await (await session.signer.sendTransaction({ to: energy.instance, value: parseEth(values.amount) })).wait();
        return;
      }
      if (c.special === "claim") {
        const energy = snap.organelles.find((o) => o.role === ROLE.ENERGY);
        const e = new ethers.Contract(energy.instance, ABI.EnergyStore, session.signer);
        await (await e.claim(session.address, claimable)).wait();
        return;
      }
      if (c.special === "lock") {
        const v = new ethers.Contract(target, ABI.Vacuole, session.signer);
        await (await v.lock(BigInt(Math.floor(Number(values.days) * 86400)), { value: parseEth(values.amount) })).wait();
        return;
      }
      if (c.special === "park") {
        const a = new ethers.Contract(target, ABI.Adipocyte, session.signer);
        const data = ethers.id(values.text || "commit");
        const rent = await a.rentWei();
        await (await a.park(data, { value: rent })).wait();
        return;
      }
      if (c.special === "bind") {
        const m = new ethers.Contract(target, ABI.Membrane, session.signer);
        const cnt = Number(await m.serviceCount());
        if (!cnt) throw new Error("the cell registers no services yet (owner can do that below)");
        const sid = await m.serviceAt(BigInt(cnt - 1));
        const price = await m.price(sid);
        await (await m.bind(sid, { value: price })).wait();
        return;
      }
      if (c.special === "harvest") {
        await (await colony.harvestOne(cell)).wait();
        return;
      }
      // generic function path, possibly admin-wrapped
      const base = c.fn.split("(")[0];
      const argCount = c.fn.split("(")[1].split(")")[0].split(",").filter(Boolean).length;
      const args = [];
      for (let i = 0; i < argCount; i++) {
        const spec = c.args?.[i];
        const raw = values[spec.name];
        if (spec.type === "eth") args.push(parseEth(raw));
        else if (spec.type === "number") args.push(spec.name.match(/Gwei$/) ? ethers.parseUnits(raw || "0", "gwei") : BigInt(Math.floor(Number(raw))));
        else if (spec.type === "timestamp") args.push(BigInt(Math.floor(new Date(raw).getTime() / 1000) || Number(raw) || 0));
        else args.push(raw);
      }
      if (c.admin) {
        const data = iface(abiNameFor(sel)).encodeFunctionData(base, args);
        await (await colony.administer(cell, target, data)).wait();
      } else {
        const ct = new ethers.Contract(target, ABI[abiNameFor(sel)], session.signer);
        await (await ct[base](...args)).wait();
      }
    });
  }

  function abiNameFor(name) {
    return { membrane: "Membrane", mitochondrion: "Mitochondrion", ribosome: "Ribosome", golgi: "GolgiApparatus", lysosome: "Lysosome", peroxisome: "Peroxisome", vacuole: "Vacuole", adipocyte: "Adipocyte", chloroplast: "Chloroplast", energy: "EnergyStore", nucleus: "Nucleus" }[name] || "Nucleus";
  }

  return (
    <div className="cellview">
      <div className="cell-head">
        <button className="backlink" onClick={() => setCell(org.root)} disabled={cell === org.root}>← root</button>
        <h3>{snap ? `${snap.name}` : "…"} <span className="mono tiny">#{snap?.serial ?? "?"} · gen {snap?.generation ?? "?"}</span></h3>
        <span className={"health " + (snap?.alive ? "ok" : "dead")}>{snap?.alive ? "alive" : "dead"}</span>
        {snap && !isOwner && <span className="chip tiny">keeper mode — you get reimbursed for waking it</span>}
        {fee && (
          <span className="chip tiny">base fee {Number(fee.baseFeePerGas ?? 0n) / 1e9} gwei
            {snap?.adipocyte && snap.adipocyte.filled > 0n && ` · ${fmtEth(snap.adipocyte.blubber)} of fat ready`}
          </span>
        )}
        {claimable > 0n && <button className="chip claimable" onClick={() => controlAction({ special: "claim", label: "claim" }, {})}>claim {fmtEth(claimable)} keeper credit</button>}
        <span className="spacer" />
        {isOwner && <button className="ghost danger" onClick={onForget}>unwatch</button>}
      </div>

      {err && <div className="banner error">{err}</div>}
      {ok && <div className="banner good">{ok}</div>}
      {busy && <div className="banner">transaction in flight — sign in your wallet…</div>}

      {snap && (
        <div className="cell-grid">
          <div className="graph-wrap card">
            <svg viewBox="-260 -260 520 520" className="cellgraph">
              <defs>
                <radialGradient id="cyto"><stop offset="0%" stopColor="#0d3b52" /><stop offset="100%" stopColor="#051423" /></radialGradient>
              </defs>
              <circle className="membrane" r="250" />
              <circle r="250" fill="url(#cyto)" opacity="0.8" />
              {snap.organelles.map((o, i) => {
                const p = nodePos(o, i, Math.max(1, snap.organelles.length));
                if (o.role === ROLE.NUCLEUS) return null;
                return <line key={"l" + o.name} x1={CENTER.x} y1={CENTER.y} x2={p.x} y2={p.y} stroke={o.color} strokeOpacity="0.25" strokeWidth="1.5" />;
              })}
              {snap.organelles.map((o, i) => {
                const p = nodePos(o, i, Math.max(1, snap.organelles.length));
                const isNuc = o.role === ROLE.NUCLEUS;
                const r = isNuc ? 46 : o.role === ROLE.ENERGY ? 34 : o.role === ROLE.METABOLISM ? 32 : 26;
                const info2 = ORGANELLE_INFO[o.name] || {};
                const glyph = info2.glyph || "◦";
                const dead = o.instance === ethers.ZeroAddress;
                return (
                  <g key={o.name} transform={`translate(${p.x},${p.y})`} className={"node" + (dead ? " tomb" : "") + (sel === o.name ? " selnode" : "")}
                     onClick={() => !dead && setSel(o.name)} style={{ "--nc": o.color }}>
                    <circle r={r} className="halo" />
                    <circle r={r} className="body" />
                    <text className="glyph" y={isNuc ? 6 : 5}>{isNuc ? "◉" : glyph}</text>
                    <text className="nlabel" y={r + 16}>{dead ? "▸recycled" : (info2.label || o.name)}</text>
                    {o.role === ROLE.ENERGY && <text className="nvalue" y={r + 30}>{fmtEth(snap.capital.balance)} Ξ</text>}
                  </g>
                );
              })}
              {!snap.alive && <text className="deadviz" y="0">DEAD</text>}
            </svg>
            <div className="graph-legend">
              <span><i style={{ background: "#ffd166" }} /> larder {fmtEth(snap.capital.balance)} Ξ (reserve owed to keepers: {fmtEth(snap.capital.outstanding)})</span>
              <span><i style={{ background: "#06d6a0" }} /> cycles {String(snap.chloroStats.cycles)} · divisions {String(snap.chloroStats.births)}</span>
              {snap.mito && <span><i style={{ background: "#b388ff" }} /> staked {fmtEth(snap.mito.staked)} Ξ</span>}
              {snap.adipocyte && <span><i style={{ background: "#ffe082" }} /> fat {String(snap.adipocyte.filled)} slots</span>}
              {snap.membrane && <span><i style={{ background: "#aed581" }} /> {String(snap.membrane.totalBinds)} services sold · {fmtEth(snap.membrane.lifetimeFees)} Ξ earned</span>}
            </div>
          </div>

          <div className="panel card">
            {!sel && (
              <div className="panel-empty">
                <h4>the organism</h4>
                <p className="muted">Click any organelle to inspect it and open its controls. Health reads straight from the chain.</p>
                <ul className="facts">
                  <li><b>lineage</b> {snap.generation > 1 ? <>child of <span className="mono tiny">{snap.parentCell.slice(0, 10)}…</span></> : "root of its line"}</li>
                  <li><b>progeny</b> {snap.childrenLen} daughter cell(s)</li>
                  <li><b>auxiliary organs</b> {snap.organelles.filter((o) => ![1, 2, 3].includes(o.role)).length}</li>
                  <li><b>terminal?</b> {params && snap.generation >= Number(params.maxGeneration) ? "yes — last generation" : `no — can reach gen ${params ? params.maxGeneration : "?"}`}</li>
                </ul>
              </div>
            )}
            {sel && (
              <div>
                <div className="panel-head" style={{ "--nc": info.color }}>
                  <span className="panel-glyph">{info.glyph}</span>
                  <div><h4>{info.label}</h4><span className="mono tiny">{selO.instance.slice(0, 18)}…</span></div>
                  <button className="x" onClick={() => setSel(null)}>×</button>
                </div>
                <p className="panel-blurb">{info.blurb}</p>
                <OrganelleDetail name={sel} snap={snap} provider={provider} />
                <div className="controls">
                  {(CONTROLS[sel] || []).map((c) => {
                    const blockedByScope = c.scope === "owner" && !isOwner;
                    if (c.scope === "owner" && !isOwner) return null;
                    return <ControlForm key={c.id} c={c} disabled={busy} run={controlAction} snap={snap} fee={fee} params={params} claimable={claimable} />;
                  })}
                  {!CONTROLS[sel] && <p className="muted tiny">passive organ — its behavior is exercised automatically by the cell's cycles.</p>}
                </div>
              </div>
            )}
          </div>

          <div className="capital card">
            <h4>colony capital</h4>
            {cap && <TotalCapital cap={cap} />}
            <h4>lineage</h4>
            {tree && (
              <ul className="tree">
                {tree.map((t) => (
                  <li key={t.addr} style={{ paddingLeft: `${t.depth * 16}px` }}
                      className={t.addr === cell ? "now" : ""} onClick={() => { setCell(t.addr); setSel(null); }}>
                    <span className="dot" /> <span className="mono tiny">{t.addr.slice(0, 12)}…</span> gen {t.depth + snap.generation - (tree.find((x) => x.addr === org.root)?.depth ?? 0)}
                  </li>
                ))}
              </ul>
            )}
            {isOwner && <AdminPanel colony={colony} session={session} params={params} refresh={refresh} cell={cell} setBusy={setBusy} setErr={setErr} setOk={setOk} />}
          </div>
        </div>
      )}
    </div>
  );
}

function OrganelleDetail({ name, snap, provider }) {
  const [extra, setExtra] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const o = snap.organelles.find((x) => x.name === name);
      if (!o) return setExtra(null);
      try {
        if (name === "membrane") {
          const m = new ethers.Contract(o.instance, ABI.Membrane, provider);
          const [cnt, shield] = await Promise.all([m.serviceCount(), m.shield()]);
          const services = [];
          for (let i = 0; i < Number(cnt); i++) {
            const sid = await m.serviceAt(BigInt(i));
            services.push({ sid, price: await m.price(sid), open: await m.isOpen(sid) });
          }
          if (live) setExtra({ kind: "services", services, shield });
        } else if (name === "ribosome") {
          const r = new ethers.Contract(o.instance, ABI.Ribosome, provider);
          const pc = Number(await r.programCount());
          const progs = [];
          for (let i = 0; i < pc; i++) { const p = await r.programs(BigInt(i)); progs.push(p); }
          if (live) setExtra({ kind: "programs", progs, pending: String(await r.ordersPending()) });
        } else if (name === "vacuole") {
          const v = new ethers.Contract(o.instance, ABI.Vacuole, provider);
          const tc = Number(await v.trancheCount());
          const tranches = [];
          for (let i = Math.max(0, tc - 5); i < tc; i++) tranches.push(await v.tranches(BigInt(i)));
          if (live) setExtra({ kind: "tranches", tranches });
        } else if (live) setExtra(null);
      } catch { if (live) setExtra(null); }
    })();
    return () => { live = false; };
  }, [name, snap]);
  if (!extra) return null;
  if (extra.kind === "services") return (
    <div className="mini-list">
      {extra.services.length === 0 && <p className="muted tiny">no services registered — the owner can list one below.</p>}
      {extra.services.map((s) => <p key={s.sid}><span className="mono tiny">{ethsToLabel(s.sid)}</span> · {fmtEth(s.price)} Ξ · {s.open ? "open" : "closed"}</p>)}
    </div>
  );
  if (extra.kind === "programs") return (
    <div className="mini-list">{extra.progs.map((p, i) => <p key={i}>gene #{i}: {p.label} · {p.active ? "expressed" : "silenced"}</p>)}
      <p className="muted tiny">{extra.pending} order(s) queued</p></div>
  );
  if (extra.kind === "tranches") return (
    <div className="mini-list">{extra.tranches.map((t, i) => <p key={i}>{fmtEth(t.amount)} Ξ · {t.released ? "released" : t.quarantined ? "QUARANTINED (jury only)" : `until ${new Date(Number(t.dueAt) * 1000).toLocaleDateString()}`}</p>)}</div>
  );
  return null;
}

function ethsToLabel(bytes32) {
  try {
    const s = ethers.toUtf8String(bytes32).replace(/\0+$/, "");
    if (/^[\x20-\x7e]+$/.test(s)) return s;
  } catch {}
  return bytes32.slice(0, 10) + "…";
}

function ControlForm({ c, disabled, run, snap, fee, params, claimable }) {
  const [values, setValues] = useState(Object.fromEntries((c.args || []).map((a) => [a.name, a.default || ""])));
  const baseGwei = fee ? Number(fee.baseFeePerGas ?? 0n) / 1e9 : null;
  const hint2 = c.special === "render" && baseGwei !== null && snap?.adipocyte ? `current base fee ${baseGwei.toFixed(1)} gwei — render pays off above the fat cell's floor` : null;
  return (
    <div className="control">
      <div className="control-top">
        <b>{c.label}</b><span className={"scope " + c.scope}>{c.scope === "keeper" ? "you're reimbursed" : "owner"}</span>
      </div>
      <p className="hint">{c.hint}{hint2 && <> <i>({hint2})</i></>}</p>
      <div className="control-form">
        {(c.args || []).map((a) => (
          <label key={a.name} className="arg">
            <span>{a.name}{a.type === "eth" ? " (Ξ)" : a.type === "timestamp" ? " (YYYY-MM-DD)" : a.name.match(/Gwei$/) ? " (gwei)" : ""}</span>
            {a.type === "timestamp"
              ? <input type="date" value={values[a.name]} onChange={(e) => setValues({ ...values, [a.name]: e.target.value })} />
              : <input value={values[a.name]} placeholder={a.type === "address" ? "0x…" : ""} onChange={(e) => setValues({ ...values, [a.name]: e.target.value })} />}
          </label>
        ))}
        {c.special === "claim" && (claimable === 0n ? <span className="muted tiny">no credit waiting for you</span> : null)}
        {c.special === "bind" && <span className="muted tiny">pays the latest listed service at its price</span>}
        {c.special === "park" && <span className="muted tiny">rent fetched from the fat cell</span>}
        <button className="cta small" disabled={disabled || (c.special === "claim" && claimable === 0n)}
                onClick={() => run(c, values)}>execute</button>
      </div>
    </div>
  );
}

function TotalCapital({ cap }) {
  const total = cap.food + cap.staked + cap.locked + cap.treasury + cap.fat;
  const seg = [
    { k: "in larders", v: cap.food, c: "#ffd166" },
    { k: "staked (mito)", v: cap.staked, c: "#b388ff" },
    { k: "locked (vacuole)", v: cap.locked, c: "#81d4fa" },
    { k: "gas option (fat)", v: cap.fat, c: "#ffe082" },
    { k: "treasury fees", v: cap.treasury, c: "#4ecdc4" },
  ];
  const nz = seg.filter((s) => s.v > 0n);
  return (
    <div className="total">
      <div className="total-num">{fmtEth(total)} <small>Ξ</small></div>
      <div className="bar">{nz.map((s) => <i key={s.k} style={{ width: `${Number((s.v * 10000n) / (total || 1n)) / 100}%`, background: s.c }} />)}</div>
      <ul className="seg-list">{nz.map((s) => <li key={s.k}><i style={{ background: s.c }} /> {s.k} · {fmtEth(s.v)} Ξ</li>)}</ul>
      <p className="muted tiny">{cap.nodes} cells scanned · keeper reserve (not spendable): {fmtEth(cap.keeperReserve)} Ξ</p>
    </div>
  );
}

function AdminPanel({ colony, session, params, refresh, cell, setBusy, setErr, setOk }) {
  async function act(label, fn) {
    setBusy(true); setErr(null); setOk(null);
    try { await (await fn()).wait(); setOk(label); await refresh(); }
    catch (e) { setErr(e.shortMessage || e.message); }
    finally { setBusy(false); }
  }
  const [f, setF] = useState({ harvestBps: "2500", titheBps: "1000", minReserve: "0.1", recipient: "" });
  return (
    <div className="admin">
      <h4>owner controls</h4>
      <div className="admin-grid">
        <button onClick={() => act("harvested this cell", () => colony.harvestOne(cell))}>harvest this cell</button>
        <button onClick={() => act("harvested the colony", () => colony.harvestColony(50))}>harvest whole colony (≤50 cells)</button>
        <button onClick={() => act("root planted", () => colony.plantRoot("satellite", { value: ethers.parseEther("0.05") }))}>plant satellite root (0.05 Ξ)</button>
      </div>
      <div className="control-form inline">
        <label className="arg"><span>harvestBps</span><input value={f.harvestBps} onChange={(e) => setF({ ...f, harvestBps: e.target.value })} /></label>
        <label className="arg"><span>titheBps</span><input value={f.titheBps} onChange={(e) => setF({ ...f, titheBps: e.target.value })} /></label>
        <label className="arg"><span>minReserve Ξ</span><input value={f.minReserve} onChange={(e) => setF({ ...f, minReserve: e.target.value })} /></label>
        <button className="cta small" onClick={() => act("params set", () =>
          colony.setParams(params.maxGeneration, params.minBirthInterval, ethers.parseEther(f.minReserve || "0"), params.birthFee,
            f.titheBps, f.harvestBps, params.keeperStipend, params.maxRefundBps, params.maxRefundCap))}>apply economics</button>
      </div>
      <div className="control-form inline">
        <label className="arg"><span>harvest recipient</span><input placeholder="0x…" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} /></label>
        <button className="cta small" onClick={() => act("recipient set", () => colony.setHarvestRecipient(f.recipient))}>set recipient</button>
      </div>
      <p className="muted tiny">birth interval & refund caps are edited in DESIGN-grade params; extend as needed — every call is on-chain and verifiable.</p>
    </div>
  );
}
