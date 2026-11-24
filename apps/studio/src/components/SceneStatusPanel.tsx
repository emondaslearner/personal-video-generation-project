import { useState } from "react";
import type { Project, Scene } from "@framewright/shared";

const API_BASE = "/api";

interface Props {
  project: Project;
  onProjectUpdated: (project: Project) => void;
}

function statusBadge(
  label: string,
  ok: boolean,
  warn?: boolean,
) {
  const cls = ok
    ? "bg-emerald-900/50 text-emerald-300"
    : warn
      ? "bg-amber-900/40 text-amber-200"
      : "bg-slate-800 text-slate-500";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function sceneNarrationOk(scene: Scene): boolean {
  return scene.audio?.status === "generated";
}

function sceneImageOk(scene: Scene): boolean {
  const s = scene.image?.status;
  return s === "generated" || s === "accepted";
}

export function SceneStatusPanel({ project, onProjectUpdated }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const scenes = project.scenes ?? [];
  const approved = Boolean(project.productionIntake?.approvedByUser);

  if (scenes.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
        No runtime scenes yet. Approve a production package and generate narration/images to populate this list.
      </div>
    );
  }

  const narrated = scenes.filter(sceneNarrationOk).length;
  const imaged = scenes.filter(sceneImageOk).length;

  const regenerateNarration = async (sceneId: string) => {
    setLoading(`narration:${sceneId}`);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/projects/${project.project.id}/production/generate-narration/${sceneId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setMessage(`Narration regenerated for scene ${sceneId}`);
      if (data.project) onProjectUpdated(data.project);
      else {
        const refresh = await fetch(`${API_BASE}/projects/${project.project.id}`);
        if (refresh.ok) onProjectUpdated((await refresh.json()).project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const regenerateImage = async (sceneId: string) => {
    setLoading(`image:${sceneId}`);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/projects/${project.project.id}/production/generate-images/${sceneId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setMessage(`Image regenerated for scene ${sceneId}`);
      if (data.project) onProjectUpdated(data.project);
      else {
        const refresh = await fetch(`${API_BASE}/projects/${project.project.id}`);
        if (refresh.ok) onProjectUpdated((await refresh.json()).project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-slate-200">Scenes</h2>
        <div className="flex gap-1.5 text-[10px]">
          {statusBadge(`Narration ${narrated}/${scenes.length}`, narrated === scenes.length, narrated > 0)}
          {statusBadge(`Images ${imaged}/${scenes.length}`, imaged === scenes.length, imaged > 0)}
        </div>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {scenes
          .slice()
          .sort((a, b) => a.number - b.number)
          .map((scene) => {
            const nOk = sceneNarrationOk(scene);
            const iOk = sceneImageOk(scene);
            const durSec =
              scene.audio?.durationSeconds ??
              (scene.durationInFrames && project.project.fps
                ? scene.durationInFrames / project.project.fps
                : undefined);

            return (
              <div
                key={scene.id}
                className="rounded border border-slate-800 bg-slate-950/50 px-3 py-2 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-slate-200 font-medium truncate">
                      {scene.number}. {scene.title || scene.id}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {(scene.narration || scene.originalNarration || "").slice(0, 80)}
                      {(scene.narration || scene.originalNarration || "").length > 80 ? "…" : ""}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 whitespace-nowrap">
                    {typeof durSec === "number" ? `${durSec.toFixed(1)}s` : "—"}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {statusBadge(
                    nOk ? "Narration" : scene.audio?.status === "failed" ? "Narration failed" : "No audio",
                    nOk,
                    scene.audio?.status === "failed",
                  )}
                  {statusBadge(
                    iOk ? "Image" : scene.image?.status === "rejected" ? "Image rejected" : "No image",
                    iOk,
                    scene.image?.status === "rejected",
                  )}
                  {scene.camera?.type && scene.camera.type !== "static" && (
                    <span className="text-[10px] text-slate-500">{scene.camera.type}</span>
                  )}
                  {scene.transition?.type && scene.transition.type !== "cut" && (
                    <span className="text-[10px] text-slate-500">{scene.transition.type}</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <button
                    className="rounded bg-slate-900 hover:bg-slate-800 text-slate-400 px-2 py-0.5 text-[11px]"
                    onClick={() =>
                      setExpandedId((id) => (id === scene.id ? null : scene.id))
                    }
                  >
                    {expandedId === scene.id ? "Hide detail" : "Detail"}
                  </button>
                  {approved && (
                    <>
                      <button
                        className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 text-[11px] disabled:opacity-50"
                        disabled={loading !== null}
                        onClick={() => void regenerateNarration(scene.id)}
                      >
                        {loading === `narration:${scene.id}` ? "…" : "Regen narration"}
                      </button>
                      <button
                        className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 text-[11px] disabled:opacity-50"
                        disabled={loading !== null}
                        onClick={() => void regenerateImage(scene.id)}
                      >
                        {loading === `image:${scene.id}` ? "…" : "Regen image"}
                      </button>
                    </>
                  )}
                </div>

                {expandedId === scene.id && (
                  <div className="mt-1.5 rounded bg-slate-900/80 border border-slate-800 p-2 text-[11px] text-slate-400 space-y-1">
                    <div>
                      <span className="text-slate-500">Voice:</span>{" "}
                      {scene.voice || scene.audio?.voice || "—"}
                      {scene.speed != null && (
                        <span className="ml-2">
                          <span className="text-slate-500">Speed:</span> {scene.speed}
                        </span>
                      )}
                    </div>
                    {scene.audio?.path && (
                      <div className="truncate">
                        <span className="text-slate-500">Audio:</span> {scene.audio.path}
                      </div>
                    )}
                    {scene.image?.path && (
                      <div className="truncate">
                        <span className="text-slate-500">Image:</span> {scene.image.path}
                      </div>
                    )}
                    {scene.image?.prompt && (
                      <div>
                        <span className="text-slate-500">Prompt:</span>{" "}
                        <span className="text-slate-300">{scene.image.prompt}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-500">Narration:</span>{" "}
                      <span className="text-slate-300 whitespace-pre-wrap">
                        {scene.narration || scene.originalNarration}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}

      {!approved && (
        <p className="text-[11px] text-slate-600">
          Approve the production package to enable per-scene regeneration.
        </p>
      )}
    </div>
  );
}
