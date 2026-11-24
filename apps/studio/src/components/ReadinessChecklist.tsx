import { useState } from "react";
import type { Project } from "@framewright/shared";

const API_BASE = "/api";

interface Props {
  project: Project;
  onProjectUpdated?: (project: Project) => void;
  musicVolume?: number;
}

type Step = {
  id: string;
  label: string;
  done: boolean;
  partial?: boolean;
  detail?: string;
  action?: {
    label: string;
    run: () => Promise<void>;
    disabled?: boolean;
  };
};

function computeBaseSteps(project: Project): Omit<Step, "action">[] {
  const intake = project.productionIntake;
  const scenes = project.scenes ?? [];
  const hasSubmission = Boolean(intake?.originalSubmission);
  const verified =
    intake?.verification?.status === "completed" ||
    Boolean(intake?.verification?.nodeValidation);
  const approved = Boolean(intake?.approvedByUser && intake?.approvedPackage);

  const narrated = scenes.filter((s) => s.audio?.status === "generated").length;
  const imaged = scenes.filter(
    (s) => s.image?.status === "generated" || s.image?.status === "accepted",
  ).length;
  const hasMusic = (project.assets?.music?.length ?? 0) > 0;

  const narrationDone = scenes.length > 0 && narrated === scenes.length;
  const imagesDone = scenes.length > 0 && imaged === scenes.length;
  const exportReady = approved && narrationDone;

  return [
    {
      id: "submit",
      label: "Package submitted",
      done: hasSubmission,
      detail: hasSubmission ? "Original submission stored" : "Paste a production package",
    },
    {
      id: "verify",
      label: "Verified",
      done: verified,
      detail: verified
        ? intake?.verification?.geminiReport
          ? `Gemini score ${intake.verification.geminiReport.overallScore ?? "—"}`
          : "Node validation complete"
        : "Run validation / full verification",
    },
    {
      id: "approve",
      label: "Approved",
      done: approved,
      detail: approved
        ? `Approved ${intake?.approvedAt ? new Date(intake.approvedAt).toLocaleString() : ""}`
        : "Explicitly approve original or Gemini proposal",
    },
    {
      id: "narration",
      label: "Narration",
      done: narrationDone,
      partial: narrated > 0 && !narrationDone,
      detail:
        scenes.length === 0
          ? "No runtime scenes yet"
          : `${narrated}/${scenes.length} scenes`,
    },
    {
      id: "images",
      label: "Images",
      done: imagesDone,
      partial: imaged > 0 && !imagesDone,
      detail:
        scenes.length === 0
          ? "No runtime scenes yet"
          : `${imaged}/${scenes.length} scenes`,
    },
    {
      id: "music",
      label: "Music bed",
      done: hasMusic,
      detail: hasMusic ? "Track uploaded" : "Optional — upload in Assets",
    },
    {
      id: "export",
      label: "Export ready",
      done: exportReady,
      detail: exportReady
        ? "You can export an MP4"
        : "Approve + generate narration first",
    },
  ];
}

export function ReadinessChecklist({
  project,
  onProjectUpdated,
  musicVolume = 0.22,
}: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approved = Boolean(project.productionIntake?.approvedByUser);
  const scenes = project.scenes ?? [];
  const narrated = scenes.filter((s) => s.audio?.status === "generated").length;
  const imaged = scenes.filter(
    (s) => s.image?.status === "generated" || s.image?.status === "accepted",
  ).length;
  const narrationDone = scenes.length > 0 && narrated === scenes.length;
  const imagesDone = scenes.length > 0 && imaged === scenes.length;
  const exportReady = approved && narrationDone;

  const refreshProject = async () => {
    const res = await fetch(`${API_BASE}/projects/${project.project.id}`);
    if (res.ok && onProjectUpdated) {
      onProjectUpdated((await res.json()).project);
    }
  };

  const generateMissingNarration = async () => {
    setLoading("narration");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/projects/${project.project.id}/production/generate-narration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      const generated = (data.scenes || []).filter(
        (s: { status: string }) => s.status === "generated",
      ).length;
      const skipped = (data.scenes || []).filter(
        (s: { status: string }) => s.status === "skipped",
      ).length;
      setMessage(`Narration: ${generated} generated, ${skipped} skipped`);
      if (data.project && onProjectUpdated) onProjectUpdated(data.project);
      else await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const generateMissingImages = async () => {
    setLoading("images");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/projects/${project.project.id}/production/generate-images`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      const generated = (data.scenes || []).filter(
        (s: { status: string }) => s.status === "generated",
      ).length;
      const skipped = (data.scenes || []).filter(
        (s: { status: string }) => s.status === "skipped",
      ).length;
      setMessage(`Images: ${generated} generated, ${skipped} skipped`);
      if (data.project && onProjectUpdated) onProjectUpdated(data.project);
      else await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const runExport = async () => {
    setLoading("export");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/projects/${project.project.id}/production/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ musicVolume }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        const extra = data.logTail ? `

${String(data.logTail).slice(-1200)}` : "";
        throw new Error((data.error || `Export failed (${res.status})`) + extra);
      }
      const mb = data.sizeBytes ? (data.sizeBytes / (1024 * 1024)).toFixed(2) : "?";
      setMessage(`Export ready: ${data.outputPath} (${mb} MB)`);
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
      await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const base = computeBaseSteps(project);
  const steps: Step[] = base.map((step) => {
    if (step.id === "narration" && approved && !narrationDone) {
      return {
        ...step,
        action: {
          label: loading === "narration" ? "Generating…" : "Generate missing",
          run: generateMissingNarration,
          disabled: loading !== null,
        },
      };
    }
    if (step.id === "images" && approved && !imagesDone) {
      return {
        ...step,
        action: {
          label: loading === "images" ? "Generating…" : "Generate missing",
          run: generateMissingImages,
          disabled: loading !== null,
        },
      };
    }
    if (step.id === "export" && exportReady) {
      return {
        ...step,
        action: {
          label: loading === "export" ? "Exporting…" : "Export MP4",
          run: runExport,
          disabled: loading !== null,
        },
      };
    }
    return step;
  });

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-slate-200 text-sm">Production readiness</h2>
        <span className="text-[11px] text-slate-500">
          {doneCount}/{steps.length} complete
        </span>
      </div>

      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {steps.map((step, index) => {
          const ring = step.done
            ? "border-emerald-800/60 bg-emerald-950/30"
            : step.partial
              ? "border-amber-800/50 bg-amber-950/20"
              : "border-slate-800 bg-slate-950/40";
          const dot = step.done
            ? "bg-emerald-400"
            : step.partial
              ? "bg-amber-400"
              : "bg-slate-600";

          return (
            <li
              key={step.id}
              className={`rounded-md border px-3 py-2 text-xs ${ring}`}
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                <span className="text-slate-300 font-medium">
                  {index + 1}. {step.label}
                </span>
              </div>
              {step.detail && (
                <p className="mt-1 text-[11px] text-slate-500 leading-snug pl-3.5">
                  {step.detail}
                </p>
              )}
              {step.action && (
                <div className="mt-1.5 pl-3.5">
                  <button
                    className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 text-[11px] disabled:opacity-50"
                    disabled={step.action.disabled}
                    onClick={() => void step.action!.run()}
                  >
                    {step.action.label}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
