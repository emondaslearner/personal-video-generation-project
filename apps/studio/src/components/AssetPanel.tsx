import { useRef, useState } from "react";
import type { Project } from "@framewright/shared";

const API_BASE = "/api";

type Category = "music" | "references" | "sound-effects";

interface Props {
  project: Project;
  onProjectUpdated: (project: Project) => void;
  musicVolume: number;
  onMusicVolumeChange: (v: number) => void;
}

export function AssetPanel({
  project,
  onProjectUpdated,
  musicVolume,
  onMusicVolumeChange,
}: Props) {
  const [uploading, setUploading] = useState<Category | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRefs = {
    music: useRef<HTMLInputElement>(null),
    references: useRef<HTMLInputElement>(null),
    "sound-effects": useRef<HTMLInputElement>(null),
  };

  // counts removed – using specific variables below

  // references are stored under assets but category "references" maps to images index currently
  // Show music/audio/sfx counts from assets index
  const musicCount = project.assets?.music?.length ?? 0;
  const sfxCount = project.assets?.soundEffects?.length ?? 0;
  const frameCount = project.assets?.images?.length ?? 0;
  const audioCount = project.assets?.audio?.length ?? 0;

  const upload = async (category: Category, file: File) => {
    setUploading(category);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `${API_BASE}/projects/${project.project.id}/assets/${category}`,
        { method: "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);

      setMessage(`Uploaded ${category}: ${data.asset?.path ?? file.name}`);

      // Refresh project
      const refresh = await fetch(`${API_BASE}/projects/${project.project.id}`);
      if (refresh.ok) {
        const body = await refresh.json();
        onProjectUpdated(body.project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(null);
    }
  };

  const onFile = (category: Category) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(category, file);
  };

  const readiness = {
    approved: Boolean(project.productionIntake?.approvedByUser),
    narration: (project.scenes ?? []).some((s) => s.audio?.status === "generated"),
    images: (project.scenes ?? []).some(
      (s) => s.image?.status === "generated" || s.image?.status === "accepted",
    ),
    music: musicCount > 0,
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-4 text-sm">
      <h2 className="font-medium text-slate-200">Assets & Mix</h2>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
        <div>Frames: <span className="text-slate-200">{frameCount}</span></div>
        <div>Narration: <span className="text-slate-200">{audioCount}</span></div>
        <div>Music: <span className="text-slate-200">{musicCount}</span></div>
        <div>SFX: <span className="text-slate-200">{sfxCount}</span></div>
      </div>

      <div className="space-y-1 text-xs">
        <div className="text-slate-500 uppercase tracking-wide text-[10px]">Readiness</div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["Approved", readiness.approved],
              ["Narration", readiness.narration],
              ["Images", readiness.images],
              ["Music", readiness.music],
            ] as const
          ).map(([label, ok]) => (
            <span
              key={label}
              className={`rounded-full px-2 py-0.5 ${
                ok
                  ? "bg-emerald-900/50 text-emerald-300"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-slate-500 uppercase tracking-wide text-[10px]">
          Upload
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["music", "Music bed", ".mp3,.wav,.m4a,.ogg"],
              ["references", "Character ref", ".png,.jpg,.jpeg,.webp"],
              ["sound-effects", "SFX", ".mp3,.wav,.m4a,.ogg"],
            ] as const
          ).map(([cat, label, accept]) => (
            <div key={cat}>
              <input
                ref={fileRefs[cat]}
                type="file"
                accept={accept}
                className="hidden"
                onChange={onFile(cat)}
              />
              <button
                className="rounded bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 text-xs disabled:opacity-50"
                disabled={uploading !== null}
                onClick={() => fileRefs[cat].current?.click()}
              >
                {uploading === cat ? "Uploading…" : label}
              </button>
            </div>
          ))}
        </div>
      </div>

      {musicCount > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Music volume</span>
            <span className="text-slate-300">{Math.round(musicVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(musicVolume * 100)}
            onChange={(e) => onMusicVolumeChange(Number(e.target.value) / 100)}
            className="w-full accent-emerald-500"
          />
          <p className="text-[11px] text-slate-500">
            Live preview + export both use this volume. The last export value is restored when you reopen the project.
          </p>
        </div>
      )}

      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}

      <p className="text-[11px] text-slate-600 leading-relaxed">
        Character reference images go into <code className="text-slate-500">references/</code>.
        FLUX will pick them up automatically when generating scene images.
        Music bed plays under narration at the volume above.
      </p>
    </div>
  );
}
