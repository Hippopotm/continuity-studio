"use client";

import { useMemo, useState } from "react";

type Shot = {
  id: number;
  label: string;
  description: string;
  duration: number;
  continuity: number;
  status: "approved" | "ready";
  color: string;
};

const initialShots: Shot[] = [
  {
    id: 1,
    label: "Arrival",
    description: "Mara waits beneath the station canopy, watching the empty tracks.",
    duration: 4,
    continuity: 96,
    status: "approved",
    color: "station-one",
  },
  {
    id: 2,
    label: "The signal",
    description: "She turns toward a distant light. Slow push in, restrained fear.",
    duration: 5,
    continuity: 93,
    status: "ready",
    color: "station-two",
  },
];

const characterSpec = {
  schema_version: "1.0",
  character: {
    id: "mara_v3",
    identity_lock: {
      ordered_description: [
        "woman, approximately 32",
        "oval face, narrow chin",
        "warm medium-brown skin",
        "dark-brown almond eyes",
        "small scar above left eyebrow",
        "shoulder-length black 3B curls, center part",
      ],
      immutable: ["face geometry", "eye color", "scar position", "hair texture"],
      negative: ["different person", "straight hair", "missing scar", "age change"],
    },
    wardrobe_lock: "matte navy wool coat, brass buttons, cream scarf",
    voice_lock: { profile: "Mara / restrained", pace: 0.94, pitch: "medium-low" },
  },
  continuity: { reference_strength: 0.88, preserve_screen_direction: true },
};

export default function Home() {
  const [brief, setBrief] = useState("Mara waits alone on a 1930s railway platform at night. Light rain, warm station lamps, distant train. She realizes the train is stopping for her.");
  const [shots, setShots] = useState(initialShots);
  const [activeShot, setActiveShot] = useState(2);
  const [activeNav, setActiveNav] = useState("Create");
  const [isGenerating, setIsGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [referenceLock, setReferenceLock] = useState(true);
  const [frameHandoff, setFrameHandoff] = useState(true);
  const [budget, setBudget] = useState("Balanced");

  const estimatedCost = useMemo(() => {
    const seconds = shots.reduce((sum, shot) => sum + shot.duration, 0);
    const multiplier = budget === "Draft" ? 0.035 : budget === "Cinema" ? 0.14 : 0.075;
    return (seconds * multiplier + 0.06).toFixed(2);
  }, [shots, budget]);

  const toast = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const compile = () => {
    setShowJson(true);
    toast("Continuity specification compiled and locked");
  };

  const generate = () => {
    if (!connected) {
      toast("Demo pipeline running — connect a provider for live generation");
    }
    setIsGenerating(true);
    window.setTimeout(() => {
      setIsGenerating(false);
      setShots((current) => current.map((shot) => shot.id === activeShot ? { ...shot, status: "approved", continuity: 95 } : shot));
      toast("Shot approved · final frame stored for the next scene");
    }, 1800);
  };

  const exportSpec = () => {
    const payload = { ...characterSpec, project_brief: brief, shots };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "continuity-spec.json";
    anchor.click();
    URL.revokeObjectURL(url);
    toast("Continuity specification exported");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><span>Continuity</span></div>
        <nav aria-label="Primary navigation">
          {["Create", "Assets", "Runs"].map((item) => (
            <button key={item} className={activeNav === item ? "nav-active" : ""} onClick={() => { setActiveNav(item); toast(`${item} workspace selected`); }}>{item}</button>
          ))}
        </nav>
        <div className="top-actions">
          <div className="storage-pill"><i /><span><b>2.4 GB</b> of 10 GB</span></div>
          <button className={connected ? "provider-button connected" : "provider-button"} onClick={() => { setConnected(!connected); toast(connected ? "Provider disconnected" : "GMI Cloud connected for this session"); }}>
            <span>{connected ? "●" : "+"}</span>{connected ? "GMI Cloud" : "Connect provider"}
          </button>
          <div className="avatar" aria-label="Profile">LM</div>
        </div>
      </header>

      <section className="projectbar">
        <div>
          <button className="back-button" aria-label="Back">‹</button>
          <div><p>PROJECT / SHORT FILM</p><h1>The Last Train <span>v3</span></h1></div>
        </div>
        <div className="project-actions">
          <span className="saved"><i /> Saved to B2</span>
          <button className="ghost-button" onClick={exportSpec}>Export JSON</button>
          <button className="render-button" onClick={generate}><span>▶</span> Render film</button>
        </div>
      </section>

      <section className="workspace">
        <aside className="left-panel">
          <div className="panel-heading"><p>01 / STORY</p><span className="step-done">✓</span></div>
          <label className="field-label" htmlFor="brief">Scene brief</label>
          <textarea id="brief" value={brief} onChange={(event) => setBrief(event.target.value)} />
          <div className="prompt-footer"><span>{brief.length} characters</span><button onClick={compile}>✦ Compile locks</button></div>

          <div className="section-rule" />
          <div className="panel-heading character-heading"><p>02 / CHARACTER BIBLE</p><span className="locked">⌾ LOCKED</span></div>
          <div className="character-card">
            <div className="portrait portrait-main"><span>M</span></div>
            <div><h3>Mara Voss</h3><p>Lead · Identity v3</p><div className="score"><span style={{ width: "96%" }} /> </div><small>96% reference confidence</small></div>
            <button aria-label="Character options">•••</button>
          </div>
          <div className="traits">
            <span>Oval face</span><span>Brown eyes</span><span>3B curls</span><span>Left-brow scar</span><span>Navy coat</span><span>Cream scarf</span>
          </div>
          <div className="reference-strip">
            <div className="portrait angle-one"><small>FRONT</small></div>
            <div className="portrait angle-two"><small>¾ VIEW</small></div>
            <div className="portrait angle-three"><small>PROFILE</small></div>
            <button onClick={() => toast("Reference upload ready")}>+<small>ADD REF</small></button>
          </div>
          <button className="voice-card" onClick={() => toast("Voice preview: restrained, medium-low, 0.94 pace")}>
            <span className="play">▶</span><span><b>Mara / restrained</b><small>Voice lock · 0:07</small></span><span className="wave">▂▅▃▆▂▇▃▅</span>
          </button>
        </aside>

        <section className="center-panel">
          <div className="stage-toolbar">
            <div><p>03 / SHOT SEQUENCE</p><span>{shots.length} shots · {shots.reduce((sum, s) => sum + s.duration, 0)} sec</span></div>
            <button onClick={() => { const next = shots.length + 1; setShots([...shots, { id: next, label: `Shot ${next}`, description: "A new continuity-linked moment.", duration: 4, continuity: 90, status: "ready", color: "station-three" }]); setActiveShot(next); }}>+ Add shot</button>
          </div>

          <div className="film-stage">
            <div className={`scene-preview ${shots.find((shot) => shot.id === activeShot)?.color || "station-one"}`}>
              <div className="rain" />
              <div className="scene-person"><div className="head" /><div className="coat" /></div>
              <div className="station-lamp lamp-one" /><div className="station-lamp lamp-two" />
              <div className="frame-guides"><span /><span /><span /><span /></div>
              <div className="shot-badge">SHOT {String(activeShot).padStart(2, "0")}</div>
              <button className="preview-play" onClick={generate}>{isGenerating ? "···" : "▶"}</button>
              <div className="preview-meta"><span>50mm</span><span>24 fps</span><span>16:9</span></div>
              {isGenerating && <div className="generating-overlay"><span /><b>Generating continuity pass</b><small>Anchoring face, wardrobe & light…</small></div>}
            </div>
          </div>

          <div className="timeline">
            {shots.map((shot, index) => (
              <button key={shot.id} onClick={() => setActiveShot(shot.id)} className={activeShot === shot.id ? "shot-card selected" : "shot-card"}>
                <div className={`shot-thumb ${shot.color}`}><span>{shot.status === "approved" ? "✓" : index + 1}</span><small>{shot.duration}s</small></div>
                <div><strong>{String(shot.id).padStart(2, "0")} · {shot.label}</strong><p>{shot.description}</p><span className="continuity-dot" /> <small>{shot.continuity}% continuity</small></div>
              </button>
            ))}
            <button className="add-shot-card" onClick={() => toast("Add a third shot from the ending frame")}>+<span>Add shot</span></button>
          </div>
        </section>

        <aside className="right-panel">
          <div className="inspector-title"><div><p>SHOT {String(activeShot).padStart(2, "0")}</p><h2>{shots.find((s) => s.id === activeShot)?.label}</h2></div><button>•••</button></div>

          <div className="inspector-section">
            <label className="field-label">Continuity anchors</label>
            <label className="toggle-row"><span><b>Character reference</b><small>Use approved identity sheet</small></span><input type="checkbox" checked={referenceLock} onChange={(e) => setReferenceLock(e.target.checked)} /><i /></label>
            <label className="toggle-row"><span><b>Previous final frame</b><small>Preserve pose & screen direction</small></span><input type="checkbox" checked={frameHandoff} onChange={(e) => setFrameHandoff(e.target.checked)} /><i /></label>
            {frameHandoff && <div className="anchor-frame"><div className="mini-frame station-one"><span>✓</span></div><div><b>shot_01 / clean-end.png</b><small>SHA · a48c…9e12</small></div><em>USED</em></div>}
          </div>

          <div className="inspector-section">
            <label className="field-label">Motion direction</label>
            <div className="segmented"><button>← Left</button><button className="active">Centered</button><button>Right →</button></div>
            <label className="range-label"><span>Motion intensity</span><b>Subtle</b></label>
            <input className="range" type="range" min="0" max="100" defaultValue="28" />
          </div>

          <div className="inspector-section">
            <label className="field-label">Generation plan</label>
            <div className="provider-row"><span className="provider-logo">G</span><span><b>GMI Cloud</b><small>Kling Image2Video V2.1</small></span><button onClick={() => toast("Model routing panel opened")}>Change</button></div>
            <div className="budget-select">
              {["Draft", "Balanced", "Cinema"].map((item) => <button key={item} onClick={() => setBudget(item)} className={budget === item ? "active" : ""}>{item}</button>)}
            </div>
            <div className="cost-row"><span>Estimated run</span><b>${estimatedCost}</b></div>
            <p className="cost-note">1 preview · 1 retry max · cache enabled</p>
          </div>

          <div className="continuity-report">
            <div><span>CONTINUITY CHECK</span><strong>{shots.find((s) => s.id === activeShot)?.continuity}</strong></div>
            {[['Face identity', 96], ['Wardrobe', 100], ['Environment', 91], ['Frame handoff', 94]].map(([label, score]) => (
              <div className="metric" key={label as string}><span>{label}</span><i><em style={{ width: `${score}%` }} /></i><b>{score}%</b></div>
            ))}
          </div>

          <button className="generate-button" onClick={generate} disabled={isGenerating}>{isGenerating ? "Generating shot…" : `Generate shot · $${estimatedCost}`}</button>
          <p className="storage-note">☁ Output, final frame & provenance save to B2</p>
        </aside>
      </section>

      {showJson && <div className="modal-backdrop" onClick={() => setShowJson(false)}><section className="json-modal" onClick={(e) => e.stopPropagation()}><header><div><p>LOCKED SPECIFICATION</p><h2>Continuity JSON</h2></div><button onClick={() => setShowJson(false)}>×</button></header><pre>{JSON.stringify(characterSpec, null, 2)}</pre><footer><span>Schema valid · 8 immutable traits</span><button onClick={exportSpec}>Download JSON</button></footer></section></div>}
      {notice && <div className="toast"><span>✓</span>{notice}</div>}
    </main>
  );
}
