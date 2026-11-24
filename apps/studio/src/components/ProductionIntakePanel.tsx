import { useCallback, useEffect, useState } from "react";
import type {
  Project,
  ProductionPackage,
  NodeValidationResult,
  GeminiVerificationReport,
  DecisionResult,
  DecisionType,
} from "@framewright/shared";
import {
  getDefaultProductionTemplate,
  getSampleProductionPackage,
  formatPackageForEditor,
} from "../lib/production-template";

const API_BASE = "/api";

type IntakeStatus =
  | "draft"
  | "submitted"
  | "validated"
  | "verified"
  | "approved"
  | "error";

interface Props {
  project: Project;
  onProjectUpdated: (project: Project) => void;
  /** Current music bed volume from Studio (0–1). Used on export. */
  musicVolume?: number;
}

export function ProductionIntakePanel({ project, onProjectUpdated, musicVolume = 0.22 }: Props) {
  const [editorValue, setEditorValue] = useState("");
  const [status, setStatus] = useState<IntakeStatus>("draft");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodeValidation, setNodeValidation] = useState<NodeValidationResult | null>(null);
  const [geminiReport, setGeminiReport] = useState<GeminiVerificationReport | null>(null);
  const [decisionResult, setDecisionResult] = useState<DecisionResult | null>(null);
  const [decisionQuestion, setDecisionQuestion] = useState("");
  const [decisionType, setDecisionType] = useState<DecisionType>("yes_no");
  const [message, setMessage] = useState<string | null>(null);

  // Initialize editor content + status from project
  useEffect(() => {
    const intake = project.productionIntake;

    if (intake?.approvedPackage) {
      setEditorValue(formatPackageForEditor(intake.approvedPackage));
      setStatus("approved");
      setNodeValidation(intake.verification?.nodeValidation ?? null);
      setGeminiReport(intake.verification?.geminiReport ?? null);
    } else if (intake?.originalSubmission) {
      setEditorValue(formatPackageForEditor(intake.originalSubmission));
      if (intake.verification?.status === "completed") {
        setStatus("verified");
        setNodeValidation(intake.verification.nodeValidation);
        setGeminiReport(intake.verification.geminiReport ?? null);
      } else {
        setStatus("submitted");
        setNodeValidation(null);
        setGeminiReport(null);
      }
    } else {
      const template = getDefaultProductionTemplate(
        project.project.title,
        project.project.aspectRatio,
      );
      setEditorValue(formatPackageForEditor(template));
      setStatus("draft");
      setNodeValidation(null);
      setGeminiReport(null);
    }
  }, [project.project.id]);

  const parseEditor = useCallback((): ProductionPackage | null => {
    try {
      return JSON.parse(editorValue) as ProductionPackage;
    } catch {
      setError("Invalid JSON – please fix syntax errors before submitting.");
      return null;
    }
  }, [editorValue]);

  const callApi = async (path: string, body?: unknown): Promise<Response> => {
    return fetch(`${API_BASE}/projects/${project.project.id}/production/${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  const refreshProject = async () => {
    const refresh = await fetch(`${API_BASE}/projects/${project.project.id}`);
    if (refresh.ok) {
      const refreshed = await refresh.json();
      onProjectUpdated(refreshed.project);
    }
  };

  const handleValidate = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const pkg = parseEditor();
    if (!pkg) {
      setLoading(false);
      return;
    }

    try {
      const res = await callApi("validate", { package: pkg });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Validation failed (${res.status})`);

      setNodeValidation(data.nodeValidation);
      setGeminiReport(null);
      setStatus(data.nodeValidation.valid ? "validated" : "error");
      setMessage(
        data.nodeValidation.valid
          ? "Structure is valid."
          : "Validation found issues – see details below.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const pkg = parseEditor();
    if (!pkg) {
      setLoading(false);
      return;
    }

    try {
      const res = await callApi("intake", { package: pkg });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Submit failed (${res.status})`);

      setStatus("submitted");
      setMessage("Production package submitted successfully.");
      setNodeValidation(null);
      setGeminiReport(null);
      await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await callApi("verify");
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Verification failed (${res.status})`);

      setNodeValidation(data.nodeValidation);
      setGeminiReport(data.geminiReport ?? null);
      setStatus(data.nodeValidation.valid ? "verified" : "error");
      setMessage(
        data.nodeValidation.valid
          ? "Verification completed (Node.js + Gemini gatekeeper)."
          : "Verification found issues.",
      );
      await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (useProposed = false) => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await callApi("approve", { useProposed });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Approval failed (${res.status})`);

      setStatus("approved");
      setMessage(
        useProposed
          ? "Approved Gemini’s proposed package. Ready for generation."
          : "Original package approved. Ready for narration & image generation.",
      );
      await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset verification and approval? The original submission will be kept.")) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await callApi("reset");
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Reset failed (${res.status})`);

      setStatus("submitted");
      setNodeValidation(null);
      setGeminiReport(null);
      setMessage("Reset complete. Original submission retained.");
      await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateNarration = async (force = false) => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await callApi("generate-narration", { force });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Narration generation failed (${res.status})`);

      const generated = (data.scenes || []).filter((s: { status: string }) => s.status === "generated").length;
      const failed = (data.scenes || []).filter((s: { status: string }) => s.status === "failed").length;
      const skipped = (data.scenes || []).filter((s: { status: string }) => s.status === "skipped").length;

      setMessage(
        `Narration: ${generated} generated, ${skipped} skipped, ${failed} failed.`,
      );
      if (data.project) {
        onProjectUpdated(data.project);
      } else {
        await refreshProject();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateImages = async (force = false) => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await callApi("generate-images", { force });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Image generation failed (${res.status})`);

      const generated = (data.scenes || []).filter((s: { status: string }) => s.status === "generated").length;
      const failed = (data.scenes || []).filter((s: { status: string }) => s.status === "failed").length;
      const skipped = (data.scenes || []).filter((s: { status: string }) => s.status === "skipped").length;

      setMessage(
        `Images: ${generated} generated, ${skipped} skipped, ${failed} failed.`,
      );
      if (data.project) {
        onProjectUpdated(data.project);
      } else {
        await refreshProject();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  
  const handleExportVideo = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await callApi("export", { musicVolume });
      const data = await res.json();

      if (!res.ok) {
        const extra = data.logTail ? `

${String(data.logTail).slice(-1200)}` : "";
        throw new Error((data.error || `Export failed (${res.status})`) + extra);
      }

      const mb = data.sizeBytes ? (data.sizeBytes / (1024 * 1024)).toFixed(2) : "?";
      setMessage(
        `Export ready: ${data.outputPath} (${mb} MB). ` +
          (data.downloadUrl ? `Download: ${data.downloadUrl}` : ""),
      );

      // Optional: open download in new tab
      if (data.downloadUrl) {
        window.open(data.downloadUrl, "_blank");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

const statusColor: Record<IntakeStatus, string> = {
    draft: "bg-slate-700 text-slate-300",
    submitted: "bg-blue-900/60 text-blue-300",
    validated: "bg-cyan-900/60 text-cyan-300",
    verified: "bg-indigo-900/60 text-indigo-300",
    approved: "bg-emerald-900/60 text-emerald-300",
    error: "bg-rose-900/60 text-rose-300",
  };

  const hasProposed =
    !!project.productionIntake?.verification?.proposedPackage;


  const handleRunDecision = async () => {
    if (!decisionQuestion.trim()) {
      setError("Enter a clear question for Decision 1");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    setDecisionResult(null);

    try {
      const body: Record<string, unknown> = {
        type: decisionType,
        question: decisionQuestion.trim(),
      };

      // Provide sensible defaults for the chosen type
      if (decisionType === "multiple_choice") {
        body.options = ["Option A", "Option B", "Option C"];
      }
      if (decisionType === "score") {
        body.scoreMin = 0;
        body.scoreMax = 100;
      }

      // Attach a short context from the Gemini report if available
      if (geminiReport?.summary) {
        body.context = `Gatekeeper summary: ${geminiReport.summary}`;
      }

      const res = await callApi("decision", body);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Decision failed (${res.status})`);

      setDecisionResult(data.decision);
      setMessage(`Decision recorded: ${data.decision.answer}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };


  const handleLoadSample = () => {
    if (status === "approved" || status === "submitted" || status === "verified") {
      if (!confirm("Replace the editor contents with the sample package? This does not submit until you click Submit.")) {
        return;
      }
    }
    const sample = getSampleProductionPackage(
      project.project.title || "The Lantern in the Pines",
      project.project.aspectRatio,
    );
    setEditorValue(formatPackageForEditor(sample));
    setMessage("Sample package loaded into the editor. Review, then Submit when ready.");
    setError(null);
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium text-slate-200">Production Intake</h2>
        <span className={`text-xs rounded-full px-3 py-1 ${statusColor[status]}`}>
          {status.toUpperCase()}
        </span>
      </div>

      <p className="text-xs text-slate-500">
        Paste your prepared Production Package JSON below. Framewright validates it,
        runs the Gemini gatekeeper, and waits for your explicit approval before any generation.
      </p>

      <textarea
        className="w-full h-72 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-600"
        value={editorValue}
        onChange={(e) => setEditorValue(e.target.value)}
        spellCheck={false}
        disabled={loading || status === "approved"}
      />

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={handleLoadSample}
          disabled={loading || status === "approved"}
          title="Load a complete 3-scene sample package into the editor"
        >
          Load sample package
        </button>

        <button
          className="rounded bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => void handleValidate()}
          disabled={loading}
        >
          Validate Structure
        </button>

        <button
          className="rounded bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => void handleSubmit()}
          disabled={loading || status === "approved"}
        >
          Submit Package
        </button>

        <button
          className="rounded bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => void handleVerify()}
          disabled={loading || status === "draft" || status === "approved"}
        >
          Run Verification
        </button>

        <button
          className="rounded bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => void handleApprove(false)}
          disabled={
            loading ||
            (status !== "verified" && status !== "validated" && status !== "submitted")
          }
        >
          Approve Original
        </button>

        {hasProposed && (
          <button
            className="rounded bg-violet-700 hover:bg-violet-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={() => void handleApprove(true)}
            disabled={loading || status === "approved"}
          >
            Approve Gemini Proposal
          </button>
        )}

        <button
          className="rounded bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => void handleReset()}
          disabled={loading || status === "draft"}
        >
          Reset
        </button>

        {status === "approved" && (
          <>
            <button
              className="rounded bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() => void handleGenerateNarration(false)}
              disabled={loading}
            >
              Generate Narration
            </button>
            <button
              className="rounded bg-fuchsia-700 hover:bg-fuchsia-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() => void handleGenerateImages(false)}
              disabled={loading}
            >
              Generate Images
            </button>
            <button
              className="rounded bg-rose-700 hover:bg-rose-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() => void handleExportVideo()}
              disabled={loading}
            >
              Export Video
            </button>
          </>
        )}
      </div>

      {message && <p className="text-sm text-emerald-400">{message}</p>}
      {error && <p className="text-sm text-rose-400">{error}</p>}

      {/* Node.js validation results */}
      {nodeValidation && (
        <div className="rounded border border-slate-700 bg-slate-950/80 p-3 text-xs space-y-2">
          <div className="font-medium text-slate-300">
            Node.js Validation:{" "}
            {nodeValidation.valid ? (
              <span className="text-emerald-400">Passed</span>
            ) : (
              <span className="text-rose-400">Failed</span>
            )}
          </div>

          {nodeValidation.errors.length > 0 && (
            <div>
              <div className="text-rose-400 mb-1">Errors</div>
              <ul className="list-disc pl-4 space-y-0.5 text-rose-300">
                {nodeValidation.errors.map((e, i) => (
                  <li key={i}>
                    <code className="text-rose-200">{e.path}</code>: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {nodeValidation.warnings.length > 0 && (
            <div>
              <div className="text-amber-400 mb-1">Warnings</div>
              <ul className="list-disc pl-4 space-y-0.5 text-amber-200/80">
                {nodeValidation.warnings.map((w, i) => (
                  <li key={i}>
                    <code className="text-amber-200">{w.path}</code>: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Gemini gatekeeper report */}
      {geminiReport && (
        <div className="rounded border border-indigo-900/60 bg-indigo-950/30 p-3 text-xs space-y-2">
          <div className="font-medium text-indigo-300">
            Gemini Gatekeeper{" "}
            {typeof geminiReport.overallScore === "number" && (
              <span className="text-indigo-400">
                · Score {geminiReport.overallScore}/100
              </span>
            )}
          </div>

          <p className="text-slate-300">{geminiReport.summary}</p>

          {geminiReport.issues.length > 0 && (
            <ul className="space-y-1.5">
              {geminiReport.issues.map((issue, i) => (
                <li
                  key={i}
                  className={
                    issue.severity === "critical"
                      ? "text-rose-300"
                      : issue.severity === "important"
                        ? "text-amber-200"
                        : "text-slate-400"
                  }
                >
                  <span className="uppercase text-[10px] tracking-wide opacity-70">
                    {issue.severity}
                  </span>
                  {issue.path && (
                    <code className="ml-1 text-[11px] opacity-80">{issue.path}</code>
                  )}
                  <div>{issue.message}</div>
                  {issue.proposedFix && (
                    <div className="text-slate-500 mt-0.5">
                      Suggested: {issue.proposedFix}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {hasProposed && (
            <p className="text-violet-300 pt-1">
              Gemini proposed an improved package. You can approve the original or the proposal.
            </p>
          )}
        </div>
      )}

      {/* Phase 5 – Gemini Decision 1 */}
      {(status === "verified" || status === "approved" || geminiReport) && (
        <div className="rounded border border-cyan-900/50 bg-cyan-950/20 p-3 text-xs space-y-2">
          <div className="font-medium text-cyan-300">Gemini Decision 1</div>
          <p className="text-slate-400">
            Ask a bounded question (yes/no, multiple-choice, or score). Node controls routing; Gemini only answers.
          </p>

          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="rounded bg-slate-800 border border-slate-700 text-slate-200 px-2 py-1 text-xs"
              value={decisionType}
              onChange={(e) => setDecisionType(e.target.value as DecisionType)}
              disabled={loading}
            >
              <option value="yes_no">Yes / No</option>
              <option value="multiple_choice">Multiple choice</option>
              <option value="score">Score (0–100)</option>
            </select>

            <input
              type="text"
              className="flex-1 min-w-[200px] rounded bg-slate-800 border border-slate-700 text-slate-200 px-2 py-1 text-xs"
              placeholder="e.g. Should we keep the original visual style for scene 3?"
              value={decisionQuestion}
              onChange={(e) => setDecisionQuestion(e.target.value)}
              disabled={loading}
            />

            <button
              className="rounded bg-cyan-800 hover:bg-cyan-700 text-white px-3 py-1 text-xs disabled:opacity-50"
              disabled={loading || !decisionQuestion.trim()}
              onClick={() => void handleRunDecision()}
            >
              Ask Decision
            </button>
          </div>

          {decisionResult && (
            <div className="mt-2 rounded bg-slate-900/60 border border-slate-700 p-2 space-y-1">
              <div className="text-cyan-200 font-medium">
                Answer: <span className="text-white">{decisionResult.answer}</span>
                {typeof decisionResult.score === "number" && (
                  <span className="ml-2 text-slate-400">(score {decisionResult.score})</span>
                )}
              </div>
              {decisionResult.rationale && (
                <p className="text-slate-400">{decisionResult.rationale}</p>
              )}
              {typeof decisionResult.confidence === "number" && (
                <p className="text-slate-500 text-[11px]">
                  Confidence: {Math.round(decisionResult.confidence * 100)}%
                </p>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
