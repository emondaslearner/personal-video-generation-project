import { useCallback, useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import type { Project, StoryVideoProps } from "@framewright/shared";
import { SCHEMA_VERSION } from "@framewright/shared";
import { StoryVideo, computeCompositionDuration } from "@remotion-comp/StoryVideo";
import { ProductionIntakePanel } from "./components/ProductionIntakePanel";
import { AssetPanel } from "./components/AssetPanel";
import { SceneStatusPanel } from "./components/SceneStatusPanel";
import { ReadinessChecklist } from "./components/ReadinessChecklist";
import { ExportHistory } from "./components/ExportHistory";

const API_BASE = "/api";

type ProjectSummary = {
  id: string;
  title: string;
  updatedAt?: string;
  aspectRatio?: string;
};

function projectToPlayerProps(project: Project, musicVolume = 0.22): StoryVideoProps {
  const musicPath =
    project.assets?.music?.[0] ||
    (typeof (project.production as { musicProfile?: { path?: string } })?.musicProfile
      ?.path === "string"
      ? (project.production as { musicProfile?: { path?: string } }).musicProfile?.path
      : undefined);

  return {
    projectId: project.project.id,
    title: project.project.title,
    width: project.project.resolution.width,
    height: project.project.resolution.height,
    fps: project.project.fps,
    assetMode: "preview",
    assetBaseUrl: `${API_BASE}/assets/${project.project.id}`,
    musicPath,
    musicVolume,
    scenes:
      project.scenes.length > 0
        ? project.scenes
        : [
            {
              id: "empty_01",
              number: 1,
              originalNarration: "Empty project — add scenes in later phases.",
              narration: "Empty project — add scenes in later phases.",
              durationInFrames: 90,
              soundEffects: [],
              validationStatus: "pending",
            },
          ],
  };
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("Untitled Project");
  const [musicVolume, setMusicVolume] = useState(0.22);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`);
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const data = (await res.json()) as { projects: ProjectSummary[] };
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const openProject = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/projects/${id}`);
      if (!res.ok) throw new Error(`Open failed: ${res.status}`);
      const data = (await res.json()) as { project: Project };
      setActive(data.project);
      const savedVol = (data.project.settings as { musicVolume?: number } | undefined)?.musicVolume;
      if (typeof savedVol === "number" && Number.isFinite(savedVol)) {
        setMusicVolume(Math.max(0, Math.min(1, savedVol)));
      } else {
        setMusicVolume(0.22);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() || "Untitled Project" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Create failed: ${res.status}`,
        );
      }
      const data = (await res.json()) as { project: Project };
      setActive(data.project);
      setNewTitle("Untitled Project");
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const playerProps = useMemo(
    () => (active ? projectToPlayerProps(active, musicVolume) : null),
    [active, musicVolume],
  );

  const totalFrames = playerProps
    ? computeCompositionDuration(playerProps.scenes)
    : 0;

  const intakeStatus = active?.productionIntake
    ? active.productionIntake.approvedByUser
      ? "Approved"
      : active.productionIntake.verification
        ? "Verified"
        : "Submitted"
    : "Draft";

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Framewright Studio</h1>
          <p className="text-sm text-slate-400">
            Production Intake · Narration · Images · Live Preview · schema {SCHEMA_VERSION}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {active && (
            <span className="text-xs rounded-full bg-slate-800 text-slate-300 px-3 py-1">
              Intake: {intakeStatus}
            </span>
          )}
          <span className="text-xs rounded-full bg-emerald-900/50 text-emerald-300 px-3 py-1">
            {active ? active.project.id : "no project open"}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row gap-6 p-6">
        {/* Left: project list */}
        <aside className="w-full lg:w-72 space-y-4 text-sm shrink-0">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <h2 className="font-medium text-slate-200">Projects</h2>

            <div className="flex gap-2">
              <input
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200 text-sm"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="New project title"
                disabled={loading}
              />
              <button
                className="rounded bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
                onClick={() => void createProject()}
                disabled={loading}
              >
                Create
              </button>
            </div>

            {error && <p className="text-rose-400 text-xs">{error}</p>}

            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {projects.length === 0 && (
                <li className="text-slate-500 text-xs">No projects yet</li>
              )}
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    className={`w-full text-left rounded px-2 py-1.5 hover:bg-slate-800 ${
                      active?.project.id === p.id
                        ? "bg-slate-800 text-emerald-300"
                        : "text-slate-300"
                    }`}
                    onClick={() => void openProject(p.id)}
                    disabled={loading}
                  >
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="text-xs text-slate-500 truncate">{p.id}</div>
                  </button>
                </li>
              ))}
            </ul>

            <button
              className="text-xs text-slate-500 hover:text-slate-300"
              onClick={() => void refreshList()}
            >
              Refresh list
            </button>
          </div>

          {active && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-2 text-slate-400 text-sm">
              <h2 className="font-medium text-slate-200">Open project</h2>
              <p>
                <span className="text-slate-500">Title:</span> {active.project.title}
              </p>
              <p>
                <span className="text-slate-500">Aspect:</span>{" "}
                {active.project.aspectRatio} ({active.project.resolution.width}×
                {active.project.resolution.height})
              </p>
              <p>
                <span className="text-slate-500">Scenes (runtime):</span>{" "}
                {active.scenes.length}
              </p>
              <p>
                <span className="text-slate-500">Intake:</span> {intakeStatus}
              </p>
            </div>
          )}

          {active && (
            <AssetPanel
              project={active}
              onProjectUpdated={(p) => setActive(p)}
              musicVolume={musicVolume}
              onMusicVolumeChange={setMusicVolume}
            />
          )}
        </aside>

        {/* Center: Intake + Player */}
        <section className="flex-1 flex flex-col gap-6 min-w-0">
          {active ? (
            <>
              <ReadinessChecklist
                project={active}
                onProjectUpdated={(p) => setActive(p)}
                musicVolume={musicVolume}
              />

              <ProductionIntakePanel
                project={active}
                onProjectUpdated={(p) => setActive(p)}
                musicVolume={musicVolume}
              />

              <SceneStatusPanel
                project={active}
                onProjectUpdated={(p) => setActive(p)}
              />

              <ExportHistory project={active} />

              <div className="flex flex-col items-center gap-3">
                <div className="w-full max-w-sm rounded-xl overflow-hidden border border-slate-800 shadow-xl bg-slate-900">
                  {playerProps && (
                    <Player
                      component={StoryVideo}
                      inputProps={playerProps}
                      durationInFrames={Math.max(totalFrames, 30)}
                      compositionWidth={playerProps.width}
                      compositionHeight={playerProps.height}
                      fps={playerProps.fps}
                      style={{ width: "100%" }}
                      controls
                      autoPlay
                      loop
                      acknowledgeRemotionLicense
                    />
                  )}
                </div>
                <p className="text-sm text-slate-500 text-center">
                  Preview · {active.project.id}
                </p>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Create or open a project to begin production intake
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
