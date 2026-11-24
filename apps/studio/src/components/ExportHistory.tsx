import { useCallback, useEffect, useState } from "react";
import type { Project } from "@framewright/shared";

const API_BASE = "/api";

type ExportEntry = {
  name: string;
  path: string;
  sizeBytes: number;
  mtime: string;
};

interface Props {
  project: Project;
  /** Bump this to force a refresh after a new export */
  refreshKey?: number;
}

export function ExportHistory({ project, refreshKey = 0 }: Props) {
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/projects/${project.project.id}/production/exports`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setExports(data.exports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [project.project.id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-slate-200">Exports</h2>
        <button
          className="text-[11px] text-slate-500 hover:text-slate-300"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {exports.length === 0 && !loading && (
        <p className="text-xs text-slate-500">No MP4 exports yet.</p>
      )}

      <ul className="space-y-1.5">
        {exports.map((entry) => {
          const mb = (entry.sizeBytes / (1024 * 1024)).toFixed(2);
          const when = new Date(entry.mtime).toLocaleString();
          const href = `${API_BASE}/assets/${project.project.id}/${entry.path}`;
          return (
            <li
              key={entry.path}
              className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <div className="text-slate-300 truncate">{entry.name}</div>
                <div className="text-slate-500">
                  {mb} MB · {when}
                </div>
              </div>
              <a
                className="shrink-0 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                Download
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
