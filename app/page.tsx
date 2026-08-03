"use client";

import { useMemo, useState } from "react";

type Connection = {
  provider: string; provider_api_key: string; b2_key_id: string;
  openai_project_id: string; openai_organization_id: string;
  b2_app_key: string; b2_bucket: string; b2_endpoint: string;
};
type RunState = { id?: string; status: string; error?: string | null; result?: { assets?: { url: string; media_type?: string }[] } | null };
type RunUpdate = RunState & { detail?: string };

const shots = [
  { id: 1, title: "Arrival", duration: 4, score: 96, copy: "Mara waits under the iron canopy as rain crosses the platform." },
  { id: 2, title: "The signal", duration: 4, score: 93, copy: "A distant light catches her eye. Slow push-in, restrained fear." },
  { id: 3, title: "The train", duration: 4, score: 94, copy: "The locomotive emerges through steam without breaking screen direction." },
];

const identityLock = {
  schema_version: "1.1",
  character: {
    id: "mara_voss_v3",
    ordered_identity: ["woman, 32", "oval face and narrow chin", "warm medium-brown skin", "dark-brown almond eyes", "small scar above left eyebrow", "shoulder-length black 3B curls, center part"],
    wardrobe: "matte navy wool coat, brass buttons, cream scarf",
    voice: { register: "medium-low", pace: 0.94, delivery: "restrained, intimate" },
    negative: ["different person", "age shift", "straight hair", "missing scar", "wardrobe change"],
  },
  environment: { place: "1930s railway platform", weather: "fine rain", light: "warm tungsten practicals", palette: "navy, oxidized teal, amber" },
  camera: { lens: "50mm", fps: 24, aspect_ratio: "16:9", motion: "subtle dolly push" },
};

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { detail: text || `Request failed (${response.status})` }; }
}

function findVideoUrl(update: RunUpdate) {
  return update.result?.assets?.find((asset) => {
    const mediaType = asset.media_type || "";
    return mediaType.startsWith("video") || asset.url.toLowerCase().split("?")[0].endsWith(".mp4");
  })?.url;
}

export default function Home() {
  const [activeShot, setActiveShot] = useState(2);
  const [brief, setBrief] = useState("Mara waits alone on a 1930s railway platform at night. Fine rain catches the warm station lamps. She realizes the train is stopping for her.");
  const [connection, setConnection] = useState<Connection>({ provider: "openai", provider_api_key: "", openai_project_id: "", openai_organization_id: "", b2_key_id: "", b2_app_key: "", b2_bucket: "ContinuityProject", b2_endpoint: "https://s3.us-west-004.backblazeb2.com" });
  const [connected, setConnected] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showSpec, setShowSpec] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [notice, setNotice] = useState("");
  const current = shots.find((shot) => shot.id === activeShot)!;
  const generatedVideo = findVideoUrl(run);
  const isWorking = ["queued", "compiling", "generating"].includes(run.status);
  const cost = useMemo(() => connection.provider === "openai" ? (current.duration * 0.1).toFixed(2) : "0.73", [connection.provider, current.duration]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3600); };

  async function connect() {
    setConnecting(true);
    try {
      const response = await fetch("/api/connections/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(connection) });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.detail || "Connection failed");
      setConnected(true); setShowConnection(false); flash("OpenAI and Backblaze B2 are ready");
    } catch (error) { flash(error instanceof Error ? error.message : "Connection failed"); }
    finally { setConnecting(false); }
  }

  async function generate() {
    if (!connected) { setShowConnection(true); return; }
    setRun({ status: "queued" });
    try {
      const response = await fetch("/api/runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: "the-last-train", shot_id: `shot-${activeShot}`,
          provider: connection.provider,
          model: connection.provider === "openai" ? "sora-2" : "Kling-Image2Video-V2.1-Master",
          specification: { ...identityLock, project_brief: brief, shot: { ...current, duration: 4 } },
          reference_urls: [], previous_clean_frame_url: null,
          budget_usd: Math.max(Number(cost), 0.1), connection,
        }),
      });
      const created = await readJson(response);
      if (!response.ok) throw new Error(created.detail || "Could not start generation");
      setRun({ id: created.id, status: created.status });
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await delay(attempt === 0 ? 1600 : 5000);
        const poll = await fetch(`/api/runs/${encodeURIComponent(created.id)}`, { cache: "no-store" });
        const update = await readJson(poll);
        if (!poll.ok) throw new Error(update.detail || "Could not read generation status");
        setRun(update);
        if (update.status === "complete") {
          const videoUrl = findVideoUrl(update);
          if (!videoUrl) throw new Error("The provider finished, but no playable video was returned. Please try again.");
          flash("Your video is ready and stored in B2");
          return;
        }
        if (update.status === "failed") throw new Error(update.error || "The provider could not generate this shot");
      }
      throw new Error("Generation is taking longer than expected. The run remains available in Runs.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      setRun((value) => ({ ...value, status: "failed", error: message })); flash(message);
    }
  }

  return (
    <main className="studio-shell">
      <aside className="rail">
        <div className="logo">C</div>
        <button className="rail-button active" aria-label="Create"><span>✦</span><small>Create</small></button>
        <button className="rail-button" aria-label="Assets"><span>◫</span><small>Assets</small></button>
        <button className="rail-button" aria-label="Runs"><span>↗</span><small>Runs</small></button>
        <div className="rail-spacer" />
        <button className="rail-button" aria-label="Settings" onClick={() => setShowConnection(true)}><span>⚙</span><small>Setup</small></button>
        <div className="avatar">LM</div>
      </aside>

      <section className="studio">
        <header className="topbar-new">
          <div><span className="eyebrow">CONTINUITY STUDIO / SHORT FILM</span><h1>The Last Train <em>v3</em></h1></div>
          <div className="header-actions">
            <span className="cloud-status"><i /> B2 synced</span>
            <button className={connected ? "connection-chip connected" : "connection-chip"} onClick={() => setShowConnection(true)}><i />{connected ? `${connection.provider === "openai" ? "OpenAI" : "GMI Cloud"} connected` : "Connect stack"}</button>
            <button className="primary-button" onClick={generate} disabled={isWorking}>{isWorking ? "Generating…" : "Generate shot"}<span>↗</span></button>
          </div>
        </header>

        <div className="creation-grid">
          <aside className="story-panel glass-panel">
            <div className="section-kicker"><span>01</span> STORY DIRECTION</div>
            <label className="input-label" htmlFor="brief">Scene brief</label>
            <textarea id="brief" value={brief} onChange={(event) => setBrief(event.target.value)} />
            <button className="compile-button" onClick={() => setShowSpec(true)}>✦ Compile continuity lock <span>⌘ K</span></button>
            <div className="divider" />
            <div className="section-title-row"><div className="section-kicker"><span>02</span> CHARACTER BIBLE</div><b className="locked-badge">LOCKED</b></div>
            <div className="identity-card">
              <div className="identity-photo" />
              <div><h2>Mara Voss</h2><p>Lead character · Identity v3</p><div className="confidence"><i /></div><small>96% reference confidence</small></div>
            </div>
            <div className="trait-list"><span>Oval face</span><span>Brown almond eyes</span><span>3B curls</span><span>Left-brow scar</span><span>Navy wool</span><span>Cream scarf</span></div>
            <div className="reference-grid"><div className="reference front"><small>FRONT</small></div><div className="reference three-quarter"><small>¾ VIEW</small></div><div className="reference profile"><small>PROFILE</small></div></div>
            <div className="voice-lock"><button>▶</button><div><b>Mara / restrained</b><small>Medium-low · 0.94 pace</small></div><span>▂▅▃▇▃▅▂▆</span></div>
          </aside>

          <section className="canvas-column">
            <div className="canvas-heading"><div><div className="section-kicker"><span>03</span> SHOT CANVAS</div><p>{shots.length} shots · 12 seconds · 16:9</p></div><button>＋ Add shot</button></div>
            <div className="cinema-stage">
              <div className="stage-topline"><span>SHOT {String(activeShot).padStart(2, "0")}</span><span>50MM&nbsp;&nbsp; • &nbsp;&nbsp;24 FPS&nbsp;&nbsp; • &nbsp;&nbsp;1280 × 720</span></div>
              {generatedVideo ? <video className="result-video" src={generatedVideo} controls autoPlay playsInline onError={() => { const message = "The generated video URL could not be played. Please generate again to refresh the B2 playback link."; setRun((value) => ({ ...value, status: "failed", error: message })); flash(message); }} /> : <div className="hero-frame" />}
              {!generatedVideo && <button className="stage-play" onClick={generate}>{isWorking ? <i className="spinner" /> : "▶"}</button>}
              {isWorking && <div className="progress-card"><div className="progress-icon"><i className="spinner" /></div><div><b>{run.status === "generating" ? "Generating with your provider" : "Preparing continuity package"}</b><small>Keep this tab open. Video jobs can take several minutes.</small></div><span>LIVE</span></div>}
              {run.status === "failed" && <div className="error-card"><b>Generation stopped</b><span>{run.error}</span><button onClick={generate}>Try again</button></div>}
            </div>
            <div className="timeline-new">
              {shots.map((shot) => <button key={shot.id} onClick={() => { setActiveShot(shot.id); setRun({ status: "idle" }); }} className={activeShot === shot.id ? "timeline-card selected" : "timeline-card"}><div className={`timeline-image image-${shot.id}`}><span>{shot.id === 1 ? "✓" : String(shot.id).padStart(2, "0")}</span><small>{shot.duration}s</small></div><div><b>{shot.title}</b><p>{shot.copy}</p><small><i /> {shot.score}% continuity</small></div></button>)}
              <button className="new-shot">＋<span>New shot</span></button>
            </div>
          </section>

          <aside className="control-panel glass-panel">
            <div className="shot-heading"><span>SHOT {String(activeShot).padStart(2, "0")}</span><h2>{current.title}</h2><p>{current.copy}</p></div>
            <div className="control-block"><label>Continuity anchors</label><div className="anchor-row"><div className="tiny-ref" /><div><b>Character identity</b><small>6 traits locked in fixed order</small></div><span className="status-dot">ON</span></div><div className="anchor-row"><div className="frame-icon">⌗</div><div><b>Prompt handoff</b><small>Screen direction + environment</small></div><span className="status-dot">ON</span></div></div>
            <div className="control-block"><label>Motion direction</label><div className="motion-picker"><button>← Left</button><button className="active">Centered</button><button>Right →</button></div><div className="range-row"><span>Motion intensity</span><b>Subtle</b></div><input type="range" defaultValue="28" /></div>
            <div className="control-block"><label>Generation plan</label><div className="model-card"><span>{connection.provider === "openai" ? "O" : "G"}</span><div><b>{connection.provider === "openai" ? "OpenAI Sora 2" : "GMI Cloud Kling"}</b><small>Image-to-video · synced output</small></div><button onClick={() => setShowConnection(true)}>Change</button></div><div className="quality-picker"><button>Draft</button><button className="active">Balanced</button><button>Cinema</button></div><div className="cost-line"><span>Estimated provider cost</span><b>${cost}</b></div></div>
            <div className="score-card"><div><span>CONTINUITY FORECAST</span><strong>{current.score}<small>%</small></strong></div>{[["Identity",96],["Wardrobe",100],["Environment",91],["Motion",94]].map(([label, score]) => <div className="score-line" key={label}><span>{label}</span><i><em style={{ width: `${score}%` }} /></i><b>{score}%</b></div>)}</div>
            <button className="generate-cta" onClick={generate} disabled={isWorking}>{isWorking ? "Generation in progress…" : `Generate shot · $${cost}`}</button>
            <p className="b2-note">☁ Video, final frame and provenance save to Backblaze B2</p>
          </aside>
        </div>
      </section>

      {showConnection && <div className="modal-backdrop" onClick={() => setShowConnection(false)}><section className="connection-modal-new" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">BRING YOUR OWN KEYS</span><h2>Connect your creative stack</h2><p>Credentials are used only for connection tests and generation requests. They are never included in provenance records.</p></div><button onClick={() => setShowConnection(false)}>×</button></header><div className="connection-form"><label>Video provider<select value={connection.provider} onChange={(e) => setConnection({ ...connection, provider: e.target.value })}><option value="openai">OpenAI · Sora 2</option><option value="gmicloud">GMI Cloud · Kling</option></select></label><label>Provider API key<input type="password" autoComplete="off" value={connection.provider_api_key} onChange={(e) => setConnection({ ...connection, provider_api_key: e.target.value })} placeholder="Enter provider key" /></label><label>OpenAI project ID<input value={connection.openai_project_id} onChange={(e) => setConnection({ ...connection, openai_project_id: e.target.value })} placeholder="Optional · proj_..." /></label><label>OpenAI organization ID<input value={connection.openai_organization_id} onChange={(e) => setConnection({ ...connection, openai_organization_id: e.target.value })} placeholder="Optional · org_..." /></label><div className="form-divider"><span>BACKBLAZE B2 STORAGE</span></div><label>Key ID<input type="password" autoComplete="off" value={connection.b2_key_id} onChange={(e) => setConnection({ ...connection, b2_key_id: e.target.value })} placeholder="Application key ID" /></label><label>Application key<input type="password" autoComplete="off" value={connection.b2_app_key} onChange={(e) => setConnection({ ...connection, b2_app_key: e.target.value })} placeholder="Application key" /></label><label>Bucket<input value={connection.b2_bucket} onChange={(e) => setConnection({ ...connection, b2_bucket: e.target.value })} /></label><label>S3 endpoint<input value={connection.b2_endpoint} onChange={(e) => setConnection({ ...connection, b2_endpoint: e.target.value })} /></label></div><footer><span><i /> Session-only credentials</span><button className="primary-button" onClick={connect} disabled={connecting}>{connecting ? "Verifying stack…" : "Verify & connect"}<b>↗</b></button></footer></section></div>}
      {showSpec && <div className="modal-backdrop" onClick={() => setShowSpec(false)}><section className="spec-modal" onClick={(e) => e.stopPropagation()}><header><div><span className="eyebrow">PROMPT LOCK</span><h2>Compiled continuity JSON</h2></div><button onClick={() => setShowSpec(false)}>×</button></header><pre>{JSON.stringify({ ...identityLock, project_brief: brief, shot: current }, null, 2)}</pre></section></div>}
      {notice && <div className={run.status === "failed" ? "toast-new error" : "toast-new"}><span>{run.status === "failed" ? "!" : "✓"}</span>{notice}</div>}
    </main>
  );
}
