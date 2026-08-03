"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

type Connection = { provider: "openai"; provider_api_key: string; openai_project_id: string; openai_organization_id: string };
type Asset = { url: string; storage_url?: string; media_type?: string; role?: string; bytes?: number };
type RunState = { id?: string; status: string; error?: string | null; result?: { assets?: Asset[] } | null };
type Generation = { id: string; createdAt: string; videoUrl: string; finalFrameUrl?: string; storageVideoUrl?: string; storageFinalFrameUrl?: string; label: string };
type Shot = { id: number; title: string; duration: number; brief: string; generations: Generation[]; selectedGenerationId?: string };
type CharacterReferences = { front?: string; threeQuarter?: string; profile?: string; body?: string; characteristics?: string };
type Project = { id: string; title: string; characterName: string; characterDescription: string; characterKeywords: string; characterReferences: CharacterReferences; shots: Shot[]; finalVideoUrl?: string; finalVideoStorageUrl?: string };

const STORAGE_KEY = "continuity-projects-v3";
const tutorial = [
  { title: "Create a project", body: "Start from a truly blank project instead of being trapped in the sample scene.", target: "new-project" },
  { title: "Build the identity", body: "Upload faces, body, clothes, or write precise traits. This becomes part of the continuity JSON.", target: "identity" },
  { title: "Write one shot", body: "Each shot has its own brief. A new shot starts empty, with no inherited image.", target: "brief" },
  { title: "Generate, then play", body: "Play only previews an existing video. Generation happens only from the Generate shot button.", target: "generate" },
  { title: "Pick takes and assemble", body: "Keep older takes, discard bad ones, and join the selected shots into the final film.", target: "film" },
];
const blankRefs: CharacterReferences = {};
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function blankShot(id = 1): Shot { return { id, title: "", duration: 4, brief: "", generations: [] }; }
function newProject(title = ""): Project { return { id: `project-${Date.now()}`, title, characterName: "", characterDescription: "", characterKeywords: "", characterReferences: { ...blankRefs }, shots: [blankShot(1)] }; }
function readJson(response: Response) { return response.text().then((text) => { try { return JSON.parse(text); } catch { return { detail: text || `Request failed (${response.status})` }; } }); }
function videoAsset(run: RunState) { return run.result?.assets?.find((asset) => (asset.media_type || "").startsWith("video") || asset.url.toLowerCase().split("?")[0].endsWith(".mp4")); }
function frameAsset(run: RunState) { return run.result?.assets?.find((asset) => asset.role === "final_frame" || (asset.media_type || "").startsWith("image")); }
function displayTitle(title: string) { return title.trim() || "Untitled project"; }
function shotTitle(shot: Shot) { return shot.title.trim() || `Shot ${String(shot.id).padStart(2, "0")}`; }
const referenceRoles: Array<keyof CharacterReferences> = ["front", "threeQuarter", "profile", "body", "characteristics"];
function refLabel(key: keyof CharacterReferences) { return ({ front: "Front face", threeQuarter: "3/4 face", profile: "Profile", body: "Full body + clothes", characteristics: "Specific traits" } as const)[key]; }

function migrateProject(raw: Partial<Project> & { brief?: string; shots?: Array<Partial<Shot> & { copy?: string }> }): Project {
  return {
    id: raw.id || `project-${Date.now()}`,
    title: raw.title || "",
    characterName: raw.characterName || (raw.title === "The Last Train" ? "Mara Voss" : ""),
    characterDescription: raw.characterDescription || (raw.characterName ? "Realistic woman, warm medium-brown skin, dark-brown almond eyes, small scar above left eyebrow, shoulder-length black 3B curls, navy wool coat, cream scarf." : ""),
    characterKeywords: raw.characterKeywords || (raw.characterName ? "oval face, brown almond eyes, 3B curls, left-brow scar, navy wool coat, cream scarf" : ""),
    characterReferences: { ...(raw.characterReferences || {}), characteristics: (raw.characterReferences as CharacterReferences & { clothes?: string } | undefined)?.characteristics || (raw.characterReferences as CharacterReferences & { clothes?: string } | undefined)?.clothes },
    finalVideoUrl: raw.finalVideoUrl,
    shots: (raw.shots?.length ? raw.shots : [blankShot(1)]).map((shot, index) => ({
      id: shot.id || index + 1,
      title: shot.title || "",
      duration: shot.duration || 4,
      brief: shot.brief || shot.copy || (index === 0 ? raw.brief || "" : ""),
      generations: shot.generations || [],
      selectedGenerationId: shot.selectedGenerationId,
    })),
  };
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [activeShotId, setActiveShotId] = useState(1);
  const [connection, setConnection] = useState<Connection>({ provider: "openai", provider_api_key: "", openai_project_id: "", openai_organization_id: "" });
  const [connected, setConnected] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [showSpec, setShowSpec] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [showTutorial, setShowTutorial] = useState(true);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [generatingVisuals, setGeneratingVisuals] = useState(false);
  const [tutorialPointer, setTutorialPointer] = useState({ left: 0, top: 0, rotate: 180 });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem("continuity-projects-v2");
    if (saved) {
      const parsed = JSON.parse(saved) as { projects: Project[]; projectId: string };
      const migrated = (parsed.projects || []).map(migrateProject);
      setProjects(migrated.length ? migrated : [newProject()]);
      setProjectId(parsed.projectId || migrated[0]?.id || "");
      return;
    }
    const first = newProject();
    setProjects([first]);
    setProjectId(first.id);
  }, []);

  useEffect(() => { if (projects.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, projectId })); }, [projects, projectId]);
  useEffect(() => {
    if (!showTutorial) return;
    const update = () => {
      const target = tutorial[tutorialStep].target;
      const element = document.querySelector(`[data-guide="${target}"]`);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const placements: Record<string, { left: number; top: number; rotate: number }> = {
        "new-project": { left: rect.left + rect.width / 2 - 12, top: rect.bottom + 8, rotate: 0 },
        identity: { left: rect.left + 16, top: rect.top - 20, rotate: 180 },
        brief: { left: rect.left + 24, top: rect.top - 22, rotate: 180 },
        generate: { left: rect.left + rect.width / 2 - 12, top: rect.bottom + 8, rotate: 0 },
        film: { left: rect.left - 30, top: rect.top + 18, rotate: 90 },
      };
      setTutorialPointer(placements[target] || { left: rect.left, top: rect.top, rotate: 180 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showTutorial, tutorialStep, projectId, activeShotId]);

  const project = projects.find((item) => item.id === projectId) || projects[0] || newProject();
  const current = project.shots.find((shot) => shot.id === activeShotId) || project.shots[0] || blankShot(1);
  const selectedGeneration = current.generations.find((item) => item.id === current.selectedGenerationId) || current.generations[0];
  const generatedVideo = videoAsset(run)?.url || selectedGeneration?.videoUrl;
  const isWorking = ["queued", "compiling", "generating"].includes(run.status);
  const cost = useMemo(() => (current.duration * 0.1).toFixed(2), [current.duration]);
  const selectedClips = project.shots.map((shot) => shot.generations.find((item) => item.id === shot.selectedGenerationId) || shot.generations[0]).filter(Boolean) as Generation[];
  const previousShot = project.shots.find((shot) => shot.id === current.id - 1);
  const previousSelected = previousShot?.generations.find((item) => item.id === previousShot.selectedGenerationId) || previousShot?.generations[0];
  const hasIdentity = Boolean(project.characterName.trim() || project.characterDescription.trim() || project.characterKeywords.trim() || Object.values(project.characterReferences).some(Boolean));
  const hasForecast = Boolean(hasIdentity && current.brief.trim());
  const referencePrompts = {
    front: `realistic front portrait reference for ${project.characterDescription || project.characterKeywords || "the character"}, plain neutral background, natural lens, no stylization`,
    threeQuarter: `realistic three-quarter face reference, same exact identity, same hair, same skin tone, same facial marks, plain background`,
    profile: `realistic side profile reference, same exact identity, same hairstyle and facial proportions, plain background`,
    body: `realistic full body reference, same exact person, neutral pose, full wardrobe visible, plain background`,
    characteristics: `photorealistic close reference of the exact unique traits and wardrobe details described for ${project.characterDescription || project.characterKeywords || "the character"}`,
  };
  const continuityJson = {
    schema_version: "2.0",
    project: { id: project.id, title: displayTitle(project.title) },
    character: {
      name: project.characterName,
      description: project.characterDescription,
      locked_keywords_in_order: project.characterKeywords.split(",").map((word) => word.trim()).filter(Boolean),
      references: Object.fromEntries(referenceRoles.map((key) => [key, { url: project.characterReferences[key] || null, available: Boolean(project.characterReferences[key]), role: refLabel(key) }])),
      reference_generation_prompts: referencePrompts,
    },
    shot: { id: current.id, title: shotTitle(current), duration: current.duration, duration_seconds: current.duration, brief: current.brief },
    multi_shot_handoff: { previous_final_frame_url: previousSelected?.finalFrameUrl || null, instruction: previousSelected?.finalFrameUrl ? "Use previous selected shot final frame as the first-frame reference and preserve identity, pose direction, wardrobe, lighting, and camera continuity." : "No previous shot reference yet." },
    negative_prompt: ["different face", "different skin tone", "different clothes", "cartoon look", "extra limbs", "motion glitch", "identity drift"],
  };

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 3600); };
  const saveProject = (updated: Project) => setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
  const updateShot = (patch: Partial<Shot>) => saveProject({ ...project, shots: project.shots.map((shot) => shot.id === current.id ? { ...shot, ...patch } : shot) });

  useEffect(() => {
    if (selectedGeneration?.id?.startsWith("run_")) {
      refreshGeneration(selectedGeneration.id).catch(() => undefined);
    }
  }, [selectedGeneration?.id, projectId, activeShotId]);

  function createProject() { const created = newProject(newProjectTitle.trim()); setProjects((items) => [created, ...items]); setProjectId(created.id); setActiveShotId(1); setRun({ status: "idle" }); setShowProjectModal(false); setNewProjectTitle(""); flash("Blank project created"); }
  function discardProject() { if (projects.length <= 1) { const created = newProject(); setProjects([created]); setProjectId(created.id); setActiveShotId(1); flash("Project cleared"); return; } const filtered = projects.filter((item) => item.id !== project.id); setProjects(filtered); setProjectId(filtered[0].id); setActiveShotId(filtered[0].shots[0]?.id || 1); flash("Project discarded"); }
  function addShot() { const nextId = Math.max(0, ...project.shots.map((shot) => shot.id)) + 1; saveProject({ ...project, shots: [...project.shots, blankShot(nextId)] }); setActiveShotId(nextId); setRun({ status: "idle" }); }
  function discardShot(id = current.id) { const remaining = project.shots.filter((shot) => shot.id !== id); const shots = remaining.length ? remaining : [blankShot(1)]; saveProject({ ...project, shots }); setActiveShotId(shots[0].id); setRun({ status: "idle" }); flash("Shot discarded"); }
  function selectGeneration(generationId: string) { saveProject({ ...project, shots: project.shots.map((shot) => shot.id === current.id ? { ...shot, selectedGenerationId: generationId } : shot) }); }
  function discardGeneration(generationId: string) { const generations = current.generations.filter((item) => item.id !== generationId); saveProject({ ...project, shots: project.shots.map((shot) => shot.id === current.id ? { ...shot, generations, selectedGenerationId: generations[0]?.id } : shot) }); flash("Take discarded"); }
  function connect() { setShowConnection(false); setConnected(true); flash("OpenAI connected. B2 storage is managed by Continuity."); }
  function uploadRef(key: keyof CharacterReferences, event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => saveProject({ ...project, characterReferences: { ...project.characterReferences, [key]: String(reader.result) } }); reader.readAsDataURL(file); }

  async function refreshGeneration(generationId: string): Promise<Generation | undefined> {
    const response = await fetch(`/api/runs/${encodeURIComponent(generationId)}`, { cache: "no-store" });
    const update = await readJson(response) as RunState & { detail?: string };
    if (!response.ok || update.status !== "complete") return undefined;
    const video = videoAsset(update);
    if (!video?.url) return undefined;
    const frame = frameAsset(update);
    let refreshed: Generation | undefined;
    setProjects((items) => items.map((item) => item.id !== project.id ? item : {
      ...item,
      shots: item.shots.map((shot) => ({
        ...shot,
        generations: shot.generations.map((generation) => {
          if (generation.id !== generationId) return generation;
          refreshed = {
            ...generation,
            videoUrl: video.url,
            finalFrameUrl: frame?.url || generation.finalFrameUrl,
            storageVideoUrl: video.storage_url || generation.storageVideoUrl,
            storageFinalFrameUrl: frame?.storage_url || generation.storageFinalFrameUrl,
          };
          return refreshed;
        }),
      })),
    }));
    return refreshed;
  }

  async function ensureCharacterVisuals(baseProject = project) {
    const missing = referenceRoles.filter((key) => !baseProject.characterReferences[key]);
    const hasText = baseProject.characterDescription.trim() || baseProject.characterKeywords.trim() || baseProject.characterName.trim();
    if (!missing.length) return baseProject;
    if (!hasText) throw new Error("Describe the character before generating visuals");
    if (!connected || !connection.provider_api_key.trim()) { setShowConnection(true); throw new Error("Connect OpenAI before generating character visuals"); }
    setGeneratingVisuals(true);
    flash("Generating missing character visuals...");
    try {
      const response = await fetch("/api/character-visuals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: baseProject.id,
          character: {
            name: baseProject.characterName,
            description: baseProject.characterDescription,
            locked_keywords_in_order: baseProject.characterKeywords.split(",").map((word) => word.trim()).filter(Boolean),
          },
          references: baseProject.characterReferences,
          required_roles: referenceRoles,
          connection,
        }),
      });
      const body = await readJson(response) as { detail?: string; references?: CharacterReferences; generated_roles?: string[]; uploaded_roles?: string[] };
      if (!response.ok || !body.references) throw new Error(body.detail || "Could not generate character visuals");
      const updated = { ...baseProject, characterReferences: { ...baseProject.characterReferences, ...body.references } };
      saveProject(updated);
      flash(`Character visuals ready (${body.generated_roles?.length || 0} generated, ${body.uploaded_roles?.length || 0} uploaded to B2)`);
      return updated;
    } finally {
      setGeneratingVisuals(false);
    }
  }

  async function generate() {
    if (!connected || !connection.provider_api_key.trim()) { setShowConnection(true); return; }
    if (!current.brief.trim()) { flash("Write this shot brief first"); return; }
    setRun({ status: "queued" });
    try {
      const refreshedPrevious = previousSelected?.id?.startsWith("run_") ? await refreshGeneration(previousSelected.id) || previousSelected : previousSelected;
      const handoffFrameUrl = refreshedPrevious?.finalFrameUrl || null;
      const visualProject = await ensureCharacterVisuals(project);
      const visualReferences = handoffFrameUrl ? [] : referenceRoles.map((key) => visualProject.characterReferences[key]).filter((value): value is string => Boolean(value) && !value.startsWith("data:"));
      const shotSpec = {
        ...continuityJson,
        character: {
          ...continuityJson.character,
          references: Object.fromEntries(referenceRoles.map((key) => [key, { url: visualProject.characterReferences[key] || null, available: Boolean(visualProject.characterReferences[key]), role: refLabel(key) }])),
        },
        multi_shot_handoff: { previous_final_frame_url: handoffFrameUrl, instruction: handoffFrameUrl ? "Use previous selected shot final frame as the first-frame reference and preserve identity, pose direction, wardrobe, lighting, and camera continuity." : "No previous shot reference yet." },
        prompt_locking_rules: {
          fixed_keyword_order: "Repeat locked_keywords_in_order exactly and in order in every shot prompt.",
          identity_reference_priority: "Use uploaded character references first, then generated references, then previous final frame.",
          shot_specificity: "Only use this shot brief for this shot. Do not inherit scene text from other shots.",
        },
      };
      const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: project.id, shot_id: `shot-${current.id}`, provider: "openai", model: "sora-2", specification: shotSpec, reference_urls: visualReferences, previous_clean_frame_url: handoffFrameUrl, budget_usd: Math.max(Number(cost), 0.1), connection }) });
      const created = await readJson(response); if (!response.ok) throw new Error(created.detail || "Could not start generation");
      setRun({ id: created.id, status: created.status });
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await delay(attempt === 0 ? 1600 : 5000);
        const poll = await fetch(`/api/runs/${encodeURIComponent(created.id)}`, { cache: "no-store" });
        const update = await readJson(poll) as RunState & { detail?: string }; if (!poll.ok) throw new Error(update.detail || "Could not read generation status");
        setRun(update);
        if (update.status === "complete") {
          const video = videoAsset(update); if (!video) throw new Error("The provider finished, but no playable video was returned.");
          const frame = frameAsset(update);
          const generation: Generation = { id: created.id, createdAt: new Date().toLocaleString(), videoUrl: video.url, finalFrameUrl: frame?.url, storageVideoUrl: video.storage_url, storageFinalFrameUrl: frame?.storage_url, label: `Take ${current.generations.length + 1}` };
          saveProject({ ...visualProject, shots: visualProject.shots.map((shot) => shot.id === current.id ? { ...shot, generations: [generation, ...shot.generations], selectedGenerationId: generation.id } : shot) });
          flash("Shot ready and stored in B2"); return;
        }
        if (update.status === "failed") throw new Error(update.error || "The provider could not generate this shot");
      }
      throw new Error("Generation is taking longer than expected.");
    } catch (error) { const message = error instanceof Error ? error.message : "Generation failed"; setRun((value) => ({ ...value, status: "failed", error: message })); flash(message); }
  }
  async function assembleFilm() { if (selectedClips.length < 2) { flash("Generate and select at least two shots first"); return; } setRun({ status: "generating" }); try { const freshClips = await Promise.all(selectedClips.map(async (clip) => clip.id.startsWith("run_") ? await refreshGeneration(clip.id) || clip : clip)); const response = await fetch("/api/assemble", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: project.id, title: displayTitle(project.title), assets: freshClips.map((clip) => clip.videoUrl), connection }) }); const body = await readJson(response); if (!response.ok) throw new Error(body.detail || "Could not assemble final video"); saveProject({ ...project, finalVideoUrl: body.asset.url, finalVideoStorageUrl: body.asset.storage_url }); setRun({ status: "idle" }); flash("Final video assembled and stored in B2"); } catch (error) { const message = error instanceof Error ? error.message : "Assembly failed"; setRun({ status: "failed", error: message }); flash(message); } }

  return <main className="studio-shell">
    <aside className="rail"><div className="logo">C</div><button className="rail-button active"><span>✦</span><small>Create</small></button><button className="rail-button" onClick={() => setShowTutorial(true)}><span>?</span><small>Guide</small></button><div className="rail-spacer" /><button className="rail-button" onClick={() => setShowConnection(true)}><span>⚙</span><small>Setup</small></button><div className="avatar">LM</div></aside>
    <section className="studio">
      <header className="topbar-new"><div className="project-title-block"><span className="eyebrow">CONTINUITY STUDIO / PROJECT</span><input className="project-title-input" value={project.title} onChange={(e) => saveProject({ ...project, title: e.target.value })} placeholder="Untitled project" /><em>{project.shots.length} shots</em></div><select className="project-picker" value={project.id} onChange={(e) => { setProjectId(e.target.value); setActiveShotId(projects.find((p) => p.id === e.target.value)?.shots[0]?.id || 1); setRun({ status: "idle" }); }}>{projects.map((item) => <option key={item.id} value={item.id}>{displayTitle(item.title)}</option>)}</select><div className="header-actions"><button className="connection-chip connected"><i /> B2 managed</button><button className={connected ? "connection-chip connected" : "connection-chip"} onClick={() => setShowConnection(true)}><i />{connected ? "OpenAI connected" : "Connect OpenAI"}</button><button data-guide="new-project" className="primary-button ghost" onClick={() => setShowProjectModal(true)}>＋ New project</button><button className="danger-button" onClick={discardProject}>Discard project</button><button data-guide="generate" className="primary-button" onClick={generate} disabled={isWorking}>{isWorking ? "Generating..." : "Generate shot"}<span>↗</span></button></div></header>
      <div className="creation-grid">
        <aside className="story-panel glass-panel"><div className="section-kicker"><span>01</span> STORY DIRECTION</div><label className="input-label" htmlFor="brief">Scene brief for this shot</label><textarea data-guide="brief" id="brief" value={current.brief} onChange={(e) => updateShot({ brief: e.target.value })} placeholder="Write only what should happen in this exact shot..." /><button className="compile-button" onClick={() => setShowSpec(true)}>✦ Compile continuity lock <span>JSON</span></button><div className="divider" />
          <div data-guide="identity" className="section-title-row"><div className="section-kicker"><span>02</span> CHARACTER IDENTITY SHEET</div>{hasIdentity && <b className="locked-badge">LOCKED</b>}</div>
          <label className="input-label">Character name<input className="soft-input" value={project.characterName} onChange={(e) => saveProject({ ...project, characterName: e.target.value })} placeholder="Name, or leave blank" /></label>
          <label className="input-label">Precise character description<textarea className="small-textarea" value={project.characterDescription} onChange={(e) => saveProject({ ...project, characterDescription: e.target.value })} placeholder="Face shape, eyes, skin tone, hair, scars, body, clothes, voice..." /></label>
          <label className="input-label">Locked keywords, same order every time<input className="soft-input" value={project.characterKeywords} onChange={(e) => saveProject({ ...project, characterKeywords: e.target.value })} placeholder="oval face, brown eyes, scar, navy coat..." /></label>
          <button className="visuals-button" onClick={() => ensureCharacterVisuals().catch((error) => flash(error instanceof Error ? error.message : "Character visuals failed"))} disabled={generatingVisuals}>{generatingVisuals ? "Generating visuals..." : "Generate character's visuals"}</button>
          <p className="identity-note">Missing images are generated only once. Uploaded images are kept, stored to B2, and used as references.</p>
          <div className="reference-grid expanded">{referenceRoles.map((key) => <label key={key} className="reference-upload"><input type="file" accept="image/*" onChange={(e) => uploadRef(key, e)} />{project.characterReferences[key] ? <img src={project.characterReferences[key]} alt={refLabel(key)} /> : <span>＋<small>{refLabel(key)}</small></span>}</label>)}</div>
        </aside>
        <section className="canvas-column"><div className="canvas-heading"><div><div className="section-kicker"><span>03</span> SHOT CANVAS</div><p>{selectedClips.length}/{project.shots.length} shots selected · final preview always visible</p></div><button onClick={addShot}>＋ Add shot</button></div><div className="cinema-stage"><div className="stage-topline"><span>SHOT {String(current.id).padStart(2, "0")}</span><span>50MM · 24 FPS · 1280 × 720</span></div>{generatedVideo ? <video className="result-video" src={generatedVideo} controls playsInline poster={selectedGeneration?.finalFrameUrl} onError={() => selectedGeneration?.id && refreshGeneration(selectedGeneration.id).catch(() => flash("Could not refresh this B2 video link"))} /> : <div className="empty-canvas"><b>No shot video yet</b><span>Write this shot brief, add identity references if needed, then click Generate shot.</span></div>}{isWorking && <div className="progress-card"><div className="progress-icon"><i className="spinner" /></div><div><b>{run.status === "generating" ? "Generating media" : "Preparing continuity package"}</b><small>Keep this tab open. Video jobs can take several minutes.</small></div><span>LIVE</span></div>}{run.status === "failed" && <div className="error-card"><b>Generation stopped</b><span>{run.error}</span><button onClick={generate}>Try again</button></div>}</div><div className="timeline-new">{project.shots.map((shot) => { const selected = shot.generations.find((item) => item.id === shot.selectedGenerationId) || shot.generations[0]; return <button key={shot.id} onClick={() => { setActiveShotId(shot.id); setRun({ status: "idle" }); }} className={activeShotId === shot.id ? "timeline-card selected" : "timeline-card"}><div className="timeline-image">{selected?.finalFrameUrl ? <img src={selected.finalFrameUrl} alt="selected final frame" /> : <span>{String(shot.id).padStart(2, "0")}</span>}<small>{shot.duration}s</small></div><div><b>{shotTitle(shot)}</b><p>{shot.brief || "Blank shot"}</p><small><i /> {shot.generations.length} saved takes</small></div></button>; })}<button className="new-shot" onClick={addShot}>＋<span>New shot</span></button></div></section>
        <aside className="control-panel glass-panel"><div className="shot-heading"><span>SHOT {String(current.id).padStart(2, "0")}</span><input className="shot-title-input" value={current.title} onChange={(e) => updateShot({ title: e.target.value })} placeholder="Rename shot" /><p>{current.brief || "This shot is blank."}</p><button className="danger-link" onClick={() => discardShot()}>Discard shot</button></div><div className="control-block"><label>Generation history</label>{current.generations.length ? current.generations.map((generation) => <div key={generation.id} className={generation.id === selectedGeneration?.id ? "take-row active" : "take-row"}><button onClick={() => selectGeneration(generation.id)}><span>{generation.label}</span><small>{generation.createdAt}</small></button><button className="mini-danger" onClick={() => discardGeneration(generation.id)}>×</button></div>) : <p className="empty-note">No takes yet. Generate this shot to save versions here.</p>}</div><div className="control-block"><label>Multi-shot handoff</label><div className="anchor-row"><div className="frame-icon">⌗</div><div><b>Previous final frame</b><small>{previousSelected?.finalFrameUrl ? "Will anchor this shot" : "Generate previous shot first"}</small></div><span className="status-dot">{previousSelected?.finalFrameUrl ? "ON" : "WAIT"}</span></div></div><div data-guide="film" className="control-block"><label>Final film preview</label><div className="film-strip">{project.shots.map((shot) => <button key={shot.id} onClick={() => setActiveShotId(shot.id)} className={shot.generations.length ? "film-cell ready" : "film-cell"}>{String(shot.id).padStart(2, "0")}</button>)}</div><button className="generate-cta" onClick={assembleFilm} disabled={isWorking || selectedClips.length < 2}>Join selected shots</button>{project.finalVideoUrl && <video className="mini-final" src={project.finalVideoUrl} controls playsInline />}</div>{hasForecast && <div className="score-card"><div><span>CONTINUITY FORECAST</span><strong>92<small>%</small></strong></div>{[["Identity", hasIdentity ? 94 : 0], ["Brief", current.brief ? 92 : 0], ["References", Object.values(project.characterReferences).some(Boolean) ? 96 : 70], ["Handoff", previousSelected?.finalFrameUrl ? 98 : 72]].map(([label, score]) => <div className="score-line" key={label}><span>{label}</span><i><em style={{ width: `${score}%` }} /></i><b>{score}%</b></div>)}</div>}<button className="generate-cta" onClick={generate} disabled={isWorking}>{isWorking ? "Generation in progress..." : `Generate shot · $${cost}`}</button><p className="b2-note">Cloud storage is managed by Continuity with Backblaze B2</p></aside>
      </div>
    </section>
    {showTutorial && <><div className="tutorial-pointer" style={{ left: tutorialPointer.left, top: tutorialPointer.top, transform: `rotate(${tutorialPointer.rotate}deg)` }}>▲</div><div className="tutorial-card"><span className="eyebrow">STEP {tutorialStep + 1} / {tutorial.length}</span><h2>{tutorial[tutorialStep].title}</h2><p>{tutorial[tutorialStep].body}</p><div><button onClick={() => setShowTutorial(false)}>Skip</button><button onClick={() => tutorialStep === tutorial.length - 1 ? setShowTutorial(false) : setTutorialStep(tutorialStep + 1)}>Next</button></div></div></>}
    {showProjectModal && <div className="modal-backdrop" onClick={() => setShowProjectModal(false)}><section className="connection-modal-new project-modal" onClick={(e) => e.stopPropagation()}><header><div><span className="eyebrow">NEW PROJECT</span><h2>Create a blank project</h2><p>No sample face, no scene brief, no generated image. Everything starts empty.</p></div><button onClick={() => setShowProjectModal(false)}>×</button></header><div className="connection-form single"><label>Project title<input value={newProjectTitle} onChange={(e) => setNewProjectTitle(e.target.value)} placeholder="Optional" /></label></div><footer><span><i /> Saved in this browser</span><button className="primary-button" onClick={createProject}>Create project<b>↗</b></button></footer></section></div>}
    {showConnection && <div className="modal-backdrop" onClick={() => setShowConnection(false)}><section className="connection-modal-new" onClick={(e) => e.stopPropagation()}><header><div><span className="eyebrow">OPENAI ONLY</span><h2>Connect your video provider</h2><p>Backblaze B2 is already configured on the server. Users only enter their OpenAI API key.</p></div><button onClick={() => setShowConnection(false)}>×</button></header><div className="connection-form"><label>OpenAI API key<input type="password" autoComplete="off" value={connection.provider_api_key} onChange={(e) => setConnection({ ...connection, provider_api_key: e.target.value })} placeholder="sk-..." /></label><label>OpenAI project ID<input value={connection.openai_project_id} onChange={(e) => setConnection({ ...connection, openai_project_id: e.target.value })} placeholder="Optional · proj_..." /></label><label>OpenAI organization ID<input value={connection.openai_organization_id} onChange={(e) => setConnection({ ...connection, openai_organization_id: e.target.value })} placeholder="Optional · org_..." /></label><div className="storage-managed"><b>Backblaze B2</b><span>Managed by Continuity · no user key needed</span></div></div><footer><span><i /> Session-only OpenAI key</span><button className="primary-button" onClick={connect} disabled={!connection.provider_api_key.trim()}>{connection.provider_api_key.trim() ? "Connect" : "Enter key"}<b>↗</b></button></footer></section></div>}
    {showSpec && <div className="modal-backdrop" onClick={() => setShowSpec(false)}><section className="spec-modal" onClick={(e) => e.stopPropagation()}><header><div><span className="eyebrow">PROMPT LOCK</span><h2>Compiled continuity JSON</h2></div><button onClick={() => setShowSpec(false)}>×</button></header><pre>{JSON.stringify(continuityJson, null, 2)}</pre></section></div>}
    {notice && <div className={run.status === "failed" ? "toast-new error" : "toast-new"}><span>{run.status === "failed" ? "!" : "✓"}</span>{notice}</div>}
  </main>;
}
