import React, { useState } from "react";
import { connect } from "./lib/wire.js";
import Landing from "./components/Landing.jsx";
import Console from "./components/Console.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState("landing"); // landing | console
  const [err, setErr] = useState(null);

  async function onConnect() {
    setErr(null);
    try {
      const s = await connect();
      setSession(s);
    } catch (e) {
      setErr(e.shortMessage || e.message);
    }
  }

  return (
    <div className="world">
      <div className="plankton" aria-hidden="true">
        {Array.from({ length: 26 }).map((_, i) => (
          <span key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, animationDelay: `${(i % 9) * 1.7}s`, animationDuration: `${14 + (i % 7) * 3}s` }} />
        ))}
      </div>
      <header className="topbar">
        <button className="brandlink" onClick={() => setView("landing")}>
          <span className="brand-glyph">❍</span> cellular<b>autonoma</b>
        </button>
        <nav>
          {session ? (
            <>
              <button className={"navbtn" + (view === "console" ? " active" : "")} onClick={() => setView("console")}>organism console</button>
              <span className="chip">{session.address.slice(0, 6)}…{session.address.slice(-4)} · chain {session.chainId}</span>
            </>
          ) : (
            <button className="cta" onClick={onConnect}>connect wallet</button>
          )}
        </nav>
      </header>
      {err && <div className="banner error">{err}</div>}
      <main>
        {view === "landing" || !session
          ? <Landing onLaunch={session ? () => setView("console") : onConnect} connected={!!session} />
          : <Console session={session} />}
      </main>
      <footer className="sitefoot">
        <span>open source · MIT · <a href="https://github.com/orbitmechanic/cellular_autonoma" target="_blank" rel="noreferrer">github.com/orbitmechanic/cellular_autonoma</a></span>
        <span>cell animations: Wikimedia Commons contributors, CC BY-SA (see assets/ATTRIBUTION.md)</span>
      </footer>
    </div>
  );
}
