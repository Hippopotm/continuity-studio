"use client";

import { useEffect, useMemo, useState } from "react";

type Connection = {
  provider: "openai";
  provider_api_key: string;
  openai_project_id: string;
  openai_organization_id: string;
};
type Asset = { url: string; storage_url?: string; media_type?: string; role?: string; bytes?: number };
type RunState = { id?: string; status: string; error?: string | null; result?: { assets?: Asset[] } | null };
type Shot = { id: number; title: string; duration: number; score: number; copy: string; generations: Generation[]; selectedGenerationId?: string };
type Generation = { id: string; createdAt: string; videoUrl: string; finalFrameUrl?: string; label: string };
type Project = { id: string; title: string; brief: string; characterName: string; shots: Shot[]; finalVideoUrl?: string };

const starterBrief = "Mara waits alone on a 1930s railway platform at night. Fine rain catches the warm station lamps. She realizes the train is stopping for her.";
const starterShots: Shot[] = [
  { id: 1, title: "Arrival", duration: 4, score: 96, copy: "Mara waits under the iron canopy as rain crosses the platform.", generations: [] },
  { id: 2, title: "The signal", duration: 4, score: 93, copy: "A distant light catches her eye. Slow push-in, restrained fear.", generations: [] },
  { id: 3, title: "The train", duration: 4, score: 94, copy: "The locomotive emerges through steam without breaking screen direction.", generations: [] },
];
const identityLock = {
  schema_version: "1.2",
  character: {
    id: "mara_voss_v3",
    ordered_identity: ["woman, 32", "oval face and narrow chin", "warm medium-brown skin", "dark-brown almond eyes", "small scar above left eyebrow", "shoulder-length black 3B curls, center part"],
    wardrobe: "matte navy wool coat, brass buttons, cream scarf",
    voice: { register: "medium-low", pace: 0.94, delivery: "restrained, intimate" },
    negative: ["different person", "age shift", "straight hair", "missing scar", "wardrobe change", "animated look"],
  },
  environment: { place: "1930s railway platform", weather: "fine rain", light: "warm tungsten practicals", palette: "navy, oxidized teal, amber" },
  camera: { lens: "50mm", fps: 24, aspect_ratio: "16:9", motion: "subtle dolly push" },
};
const tutorial = [
  { title: "Create a project", body: "Start a real project instead of working only from the sample scene.", target: "top-left" },
  { title: "Connect OpenAI", body: "Only your OpenAI key is needed. Backblaze B2 is already configured on the worker.", target: "top-right" },
  { title: "Generate shot by shot", body: "Each new shot can use the previous selected shot's final frame as its continuity reference.", target: "center" },
  { title: "Pick the best take", body: "Every generated version stays attached to its shot, so you can go back to an older better take.", target: "bottom" },
  { title: "Assemble the film", body: "When all shots are selected, join them into one final video stored in B2.", target: "right" },
];
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function newProject(title = "Untitled Continuity Project"): Project {
  return {
    id: `project-${Date.now()}`,
    title,
    brief: starterBrief,
    characterName: "Mara Voss",
    shots: starterShots.map((shot) => ({ ...shot, generations: [] })),
  };
}
function readJson(response: Response) {
  return response.text().then((text) => {
    try { return JSON.parse(text); } catch { return { detail: text || `Request failed (${response.status})` }; }
  });
}
function videoAsset(run: RunState) {
  return run.result?.assets?.find((asset) => (asset.media_type || "").startsWith("video") || asset.url.toLowerCase().split("?")[0].endsWith(".mp4"));
}
function frameAsset(run: RunState) {
  return run.result?.assets?.find((asset) => asset.role === "final_frame" || (asset.media_type || "").startsWith("image"));
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [activeShotId, setActiveShotId] = useState(1);
  const [connection, setConnection] = useState<Connection>({ provider: "openai", provider_api_key: "", openai_project_id: "", openai_organization_id: "" });
  const [connected, setConnected] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("My AI short film");
  const [showSpec, setShowSpec] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [showTutorial, setShowTutorial] = useState(true);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("continuity-projects-v2");
    if (saved) {
      const parsed = JSON.parse(saved) as { projects: Project[]; projectId: string };
      setProjects(parsed.projects);
      setProjectId(parsed.projectId || parsed.projects[0]?.id || "");
      return;
    }
    const first = newProject("The Last Train");
    setProjects([first]);
    setProjectId(first.id);
  }, []);
  useEffect(() => {
    if (projects.length) window.localStorage.setItem("continuity-projects-v2", JSON.stringify({ projects, projectId }));
  }, [projects, projectId]);

  const project = projects.find((item) => item.id === projectId) || projects[0] || newProject("Loading");
  const current = project.shots.find((shot) => shot.id === activeShotId) || project.shots[0];
  const selectedGeneration = current.generations.find((item) => item.id === current.selectedGenerationId) || current.generations[0];
  const generatedVideo = videoAsset(run)?.url || selectedGeneration?.videoUrl;
  const isWorking = ["queued", "compiling", "generating"].includes(run.status);
  const cost = useMemo(() => (current.duration * 0.1).toFixed(2), [current.duration]);
  const selectedClips = project.shots.map((shot) => shot.generations.find((item) => item.id === shot.selectedGenerationId) || shot.generations[0]).filter(Boolean) as Generation[];
  const previousShot = project.shots.find((shot) => shot.id === current.id - 1);
  const previousSelected = previousShot?.generations.find((item) => item.id === previousShot.selectedGenerationId) || previousShot?.generations[0];
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3600); };
  const saveProject = (updated: Project) => setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));

  function createProject() {
    const created = newProject(newProjectTitle.trim() || "Untitled Continuity Project");
    setProjects((items) => [created, ...items]);
    setProjectId(created.id);
    setActiveShotId(1);
    setRun({ status: "idle" });
    setShowProjectModal(false);
    flash("New project created");
  }
  function updateBrief(brief: string) {
    saveProject({ ...project, brief });
  }
  function addShot() {
    const nextId = Math.max(...project.shots.map((shot) => shot.id)) + 1;
    saveProject({ ...project, shots: [...project.shots, { id: nextId, title: `Shot ${nextId}`, duration: 4, score: 91, copy: "Describe the next beat of the scene.", generations: [] }] });
    setActiveShotId(nextId);
  }
  function selectGeneration(generationId: string) {
    saveProject({ ...project, shots: project.shots.map((shot) => shot.id === current.id ? { ...shot, selectedGenerationId: generationId } : shot) });
  }
  async function connect() {
    setShowConnection(false);
    setConnected(true);
    flash("OpenAI connected. B2 storage is managed by Continuity.");
  }
  async function generate() {
    if (!connected || !connection.provider_api_key.trim()) { setShowConnection(true); return; }
    setRun({ status: "queued" });
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: project.id,
          shot_id: `shot-${current.id}`,
          provider: "openai",
          model: "sora-2",
          specification: { ...identityLock, project_brief: project.brief, shot: { ...current, duration: 4 }, handoff: previousSelected ? "Use the previous shot final frame as the first-frame identity and pose anchor." : "No previous shot handoff." },
          reference_urls: [],
          previous_clean_frame_url: previousSelected?.finalFrameUrl || null,
          budget_usd: Math.max(Number(cost), 0.1),
          connection,
        }),
      });
      const created = await readJson(response);
      if (!response.ok) throw new Error(created.detail || "Could not start generation");
      setRun({ id: created.id, status: created.status });
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await delay(attempt === 0 ? 1600 : 5000);
        const poll = await fetch(`/api/runs/${encodeURIComponent(created.id)}`, { cache: "no-store" });
        const update = await readJson(poll) as RunState & { detail?: string };
        if (!poll.ok) throw new Error(update.detail || "Could not read generation status");
        setRun(update);
        if (update.status === "complete") {
          const video = videoAsset(update);
          if (!video) throw new Error("The provider finished, but no playable video was returned.");
          const frame = frameAsset(update);
          const generation: Generation = {
            id: created.id,
            createdAt: new Date().toLocaleString(),
            videoUrl: video.url,
            finalFrameUrl: frame?.url,
            label: `Take ${current.generations.length + 1}`,
          };
          saveProject({ ...project, shots: project.shots.map((shot) => shot.id === current.id ? { ...shot, generations: [generation, ...shot.generations], selectedGenerationId: generation.id } : shot) });
          flash("Shot ready and stored in B2");
          return;
        }
        if (update.status === "failed") throw new Error(update.error || "The provider could not generate this shot");
      }
      throw new Error("Generation is taking longer than expected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      setRun((value) => ({ ...value, status: "failed", error: message }));
      flash(message);
    }
  }
  async function assembleFilm() {
    if (selectedClips.length < 2) { flash("Generate and select at least two shots first"); return; }
    setRun({ status: "generating" });
    try {
      const response = await fetch("/api/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: project.id, title: project.title, assets: selectedClips.map((clip) => clip.videoUrl), connection }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.detail || "Could not assemble final video");
      saveProject({ ...project, finalVideoUrl: body.asset.url });
      setRun({ status: "idle" });
      flash("Final video assembled and stored in B2");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assembly failed";
      setRun({ status: "failed", error: message });
      flash(message);
    }
  }

  return (
    <main className="studio-shell">
      <aside className="rail">
        <div className="logo">C</div>
        <button className="rail-button active"><span>✦</span><small>Create</small></button>
        <button className="rail-button" onClick={() => setShowTutorial(true)}><span>?</span><small>Guide</small></button>
        <button className="rail-button"><span>◫</span><small>Assets</small></button>
        <div className="rail-spacer" />
        <button className="rail-button" onClick={() => setShowConnection(true)}><span>⚙</span><small>Setup</small></button>
        <div className="avatar">LM</div>
      </aside>
      <section className="studio">
        <header className="topbar-new">
          <div className="project-title-block"><span className="eyebrow">CONTINUITY STUDIO / PROJECT</span><h1>{project.title} <em>{project.shots.length} shots</em></h1></div>
          <select className="project-picker" value={project.id} onChange={(event) => { setProjectId(event.target.value); setActiveShotId(1); setRun({ status: "idle" }); }}>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <div className="header-actions">
            <button className="connection-chip connected"><i /> B2 managed</button>
            <button className={connected ? "connection-chip connected" : "connection-chip"} onClick={() => setShowConnection(true)}><i />{connected ? "OpenAI connected" : "Connect OpenAI"}</button>
            <button className="primary-button ghost" onClick={() => setShowProjectModal(true)}>＋ New project</button>
            <button className="primary-button" onClick={generate} disabled={isWorking}>{isWorking ? "Generating..." : "Generate shot"}<span>↗</span></button>
          </div>
        </header>
        <div className="creation-grid">
          <aside className="story-panel glass-panel">
            <div className="section-kicker"><span>01</span> STORY DIRECTION</div>
            <label className="input-label" htmlFor="brief">Scene brief</label>
            <textarea id="brief" value={project.brief} onChange={(event) => updateBrief(event.target.value)} />
            <button className="compile-button" onClick={() => setShowSpec(true)}>✦ Compile continuity lock <span>JSON</span></button>
            <div className="divider" />
            <div className="section-title-row"><div className="section-kicker"><span>02</span> CHARACTER IDENTITY SHEET</div><b className="locked-badge">LOCKED</b></div>
            <div className="identity-card"><div className="identity-photo" /><div><h2>{project.characterName}</h2><p>Lead character · Identity v3</p><div className="confidence"><i /></div><small>96% reference confidence</small></div></div>
            <div className="trait-list"><span>Oval face</span><span>Brown almond eyes</span><span>3B curls</span><span>Left-brow scar</span><span>Navy wool</span><span>Cream scarf</span></div>
            <div className="reference-grid"><div className="reference front"><small>FRONT</small></div><div className="reference three-quarter"><small>3/4 VIEW</small></div><div className="reference profile"><small>PROFILE</small></div></div>
            <div className="voice-lock"><button>▶</button><div><b>Mara / restrained</b><small>Medium-low · 0.94 pace</small></div><span>▂▅▃▇▃▅▂▆</span></div>
          </aside>
          <section className="canvas-column">
            <div className="canvas-heading"><div><div className="section-kicker"><span>03</span> SHOT CANVAS</div><p>{selectedClips.length}/{project.shots.length} shots selected · final preview always visible</p></div><button onClick={addShot}>＋ Add shot</button></div>
            <div className="cinema-stage">
              <div className="stage-topline"><span>SHOT {String(current.id).padStart(2, "0")}</span><span>50MM · 24 FPS · 1280 × 720</span></div>
              {generatedVideo ? <video className="result-video" src={generatedVideo} controls playsInline /> : <div className="hero-frame" />}
              {!generatedVideo && <button className="stage-play" onClick={generate}>{isWorking ? <i className="spinner" /> : "▶"}</button>}
              {isWorking && <div className="progress-card"><div className="progress-icon"><i className="spinner" /></div><div><b>{run.status === "generating" ? "Generating media" : "Preparing continuity package"}</b><small>Keep this tab open. Video jobs can take several minutes.</small></div><span>LIVE</span></div>}
              {run.status === "failed" && <div className="error-card"><b>Generation stopped</b><span>{run.error}</span><button onClick={generate}>Try again</button></div>}
            </div>
            <div className="timeline-new">
              {project.shots.map((shot) => {
                const selected = shot.generations.find((item) => item.id === shot.selectedGenerationId) || shot.generations[0];
                return <button key={shot.id} onClick={() => { setActiveShotId(shot.id); setRun({ status: "idle" }); }} className={activeShotId === shot.id ? "timeline-card selected" : "timeline-card"}><div className={`timeline-image image-${Math.min(shot.id, 3)}`}><span>{selected ? "✓" : String(shot.id).padStart(2, "0")}</span><small>{shot.duration}s</small></div><div><b>{shot.title}</b><p>{shot.copy}</p><small><i /> {shot.generations.length} saved takes</small></div></button>;
              })}
              <button className="new-shot" onClick={addShot}>＋<span>New shot</span></button>
            </div>
          </section>
          <aside className="control-panel glass-panel">
            <div className="shot-heading"><span>SHOT {String(current.id).padStart(2, "0")}</span><h2>{current.title}</h2><p>{current.copy}</p></div>
            <div className="control-block"><label>Generation history</label>{current.generations.length ? current.generations.map((generation) => <button key={generation.id} className={generation.id === selectedGeneration?.id ? "take-row active" : "take-row"} onClick={() => selectGeneration(generation.id)}><span>{generation.label}</span><small>{generation.createdAt}</small></button>) : <p className="empty-note">No takes yet. Generate this shot to save versions here.</p>}</div>
            <div className="control-block"><label>Multi-shot handoff</label><div className="anchor-row"><div className="frame-icon">⌗</div><div><b>Previous final frame</b><small>{previousSelected?.finalFrameUrl ? "Will anchor this shot" : "Generate previous shot first"}</small></div><span className="status-dot">{previousSelected?.finalFrameUrl ? "ON" : "WAIT"}</span></div></div>
            <div className="control-block"><label>Final film preview</label><div className="film-strip">{project.shots.map((shot) => <button key={shot.id} onClick={() => setActiveShotId(shot.id)} className={shot.generations.length ? "film-cell ready" : "film-cell"}>{String(shot.id).padStart(2, "0")}</button>)}</div><button className="generate-cta" onClick={assembleFilm} disabled={isWorking || selectedClips.length < 2}>Join selected shots</button>{project.finalVideoUrl && <video className="mini-final" src={project.finalVideoUrl} controls playsInline />}</div>
            <div className="score-card"><div><span>CONTINUITY FORECAST</span><strong>{current.score}<small>%</small></strong></div>{[["Identity",96],["Wardrobe",100],["Environment",91],["Handoff",previousSelected?.finalFrameUrl ? 98 : 72]].map(([label, score]) => <div className="score-line" key={label}><span>{label}</span><i><em style={{ width: `${score}%` }} /></i><b>{score}%</b></div>)}</div>
            <button className="generate-cta" onClick={generate} disabled={isWorking}>{isWorking ? "Generation in progress..." : `Generate shot · $${cost}`}</button>
            <p className="b2-note">Cloud storage is managed by Continuity with Backblaze B2</p>
          </aside>
        </div>
      </section>

      {showTutorial && <div className="tutorial-card"><div className={`tutorial-arrow ${tutorial[tutorialStep].target}`} /> <span className="eyebrow">STEP {tutorialStep + 1} / {tutorial.length}</span><h2>{tutorial[tutorialStep].title}</h2><p>{tutorial[tutorialStep].body}</p><div><button onClick={() => setShowTutorial(false)}>Skip</button><button onClick={() => tutorialStep === tutorial.length - 1 ? setShowTutorial(false) : setTutorialStep(tutorialStep + 1)}>Next</button></div></div>}
      {showProjectModal && <div className="modal-backdrop" onClick={() => setShowProjectModal(false)}><section className="connection-modal-new project-modal" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">NEW PROJECT</span><h2>Create a real project</h2><p>Name your film, then build shots from an empty project space.</p></div><button onClick={() => setShowProjectModal(false)}>×</button></header><div className="connection-form single"><label>Project title<input value={newProjectTitle} onChange={(event) => setNewProjectTitle(event.target.value)} /></label></div><footer><span><i /> Saved in this browser</span><button className="primary-button" onClick={createProject}>Create project<b>↗</b></button></footer></section></div>}
      {showConnection && <div className="modal-backdrop" onClick={() => setShowConnection(false)}><section className="connection-modal-new" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">OPENAI ONLY</span><h2>Connect your video provider</h2><p>Backblaze B2 is already configured on the server. Users only enter their OpenAI API key.</p></div><button onClick={() => setShowConnection(false)}>×</button></header><div className="connection-form"><label>OpenAI API key<input type="password" autoComplete="off" value={connection.provider_api_key} onChange={(event) => setConnection({ ...connection, provider_api_key: event.target.value })} placeholder="sk-..." /></label><label>OpenAI project ID<input value={connection.openai_project_id} onChange={(event) => setConnection({ ...connection, openai_project_id: event.target.value })} placeholder="Optional · proj_..." /></label><label>OpenAI organization ID<input value={connection.openai_organization_id} onChange={(event) => setConnection({ ...connection, openai_organization_id: event.target.value })} placeholder="Optional · org_..." /></label><div className="storage-managed"><b>Backblaze B2</b><span>Managed by Continuity · no user key needed</span></div></div><footer><span><i /> Session-only OpenAI key</span><button className="primary-button" onClick={connect} disabled={!connection.provider_api_key.trim()}>{connection.provider_api_key.trim() ? "Connect" : "Enter key"}<b>↗</b></button></footer></section></div>}
      {showSpec && <div className="modal-backdrop" onClick={() => setShowSpec(false)}><section className="spec-modal" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">PROMPT LOCK</span><h2>Compiled continuity JSON</h2></div><button onClick={() => setShowSpec(false)}>×</button></header><pre>{JSON.stringify({ ...identityLock, project_brief: project.brief, shot: current, previous_final_frame: previousSelected?.finalFrameUrl || null }, null, 2)}</pre></section></div>}
      {notice && <div className={run.status === "failed" ? "toast-new error" : "toast-new"}><span>{run.status === "failed" ? "!" : "✓"}</span>{notice}</div>}
    </main>
  );
}
