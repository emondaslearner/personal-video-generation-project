import { z } from "zod";

/**
 * Framewright project schema v2.0
 *
 * Design rules:
 * - Project JSON stores relative asset paths (never machine-specific absolute paths).
 * - Original story text is preserved; AI suggestions never silently overwrite it.
 * - User may intentionally revise the story via an explicit revision mechanism.
 *
 * Production Intake (Phase 1–2):
 * - User prepares a full ProductionPackage outside Framewright.
 * - Package is submitted via paste → stored as originalSubmission (immutable).
 * - Node.js performs deterministic validation.
 * - Gemini 3.1 Flash-Lite acts as creative gatekeeper only.
 * - User reviews and explicitly approves before any generation begins.
 */

export const SCHEMA_VERSION = "2.0" as const;
export const PRODUCTION_PACKAGE_VERSION = "2.1-package" as const;

export const AspectRatioSchema = z.enum(["9:16", "16:9"]);

export const ResolutionSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** Standard Framewright resolutions for each aspect ratio. */
export function resolutionForAspectRatio(
  aspectRatio: "9:16" | "16:9",
): { width: number; height: number } {
  if (aspectRatio === "16:9") {
    return { width: 1920, height: 1080 };
  }
  return { width: 1080, height: 1920 };
}



export const CameraSchema = z.object({
  type: z.enum([
    "static",
    "zoom_in",
    "zoom_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
  ]),
  zoomFrom: z.number().optional(),
  zoomTo: z.number().optional(),
  panX: z.number().optional(),
  panY: z.number().optional(),
});

export const TransitionSchema = z.object({
  type: z.enum(["cut", "fade", "crossfade"]),
  durationInFrames: z.number().int().nonnegative().default(0),
});

export const AudioAssetSchema = z.object({
  /** Relative path from project root, e.g. "audio/scene_01.wav" */
  path: z.string(),
  voice: z.string().optional(),
  speed: z.number().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  status: z.enum(["reserved", "generated", "failed", "missing"]).default("reserved"),
  generatedAt: z.string().optional(),
});

export const ImageAssetSchema = z.object({
  /** Relative path, e.g. "frames/scene_01.png" */
  path: z.string(),
  prompt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  status: z.enum(["pending", "generated", "accepted", "rejected", "missing"]).default("pending"),
});

export const SubtitleSchema = z.object({
  text: z.string(),
  startFrame: z.number().int().nonnegative().optional(),
  endFrame: z.number().int().nonnegative().optional(),
});

export const SceneSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().optional(),
  /** Locked original narration for this scene (from the protected story). */
  originalNarration: z.string(),
  /** Production narration actually used (may equal original after user approval). */
  narration: z.string(),
  emotion: z.string().optional(),
  narrationInstructions: z.string().optional(),
  voice: z.string().optional(),
  speed: z.number().positive().optional(),
  image: ImageAssetSchema.optional(),
  camera: CameraSchema.optional(),
  durationInFrames: z.number().int().positive(),
  transition: TransitionSchema.optional(),
  subtitle: SubtitleSchema.optional(),
  audio: AudioAssetSchema.optional(),
  soundEffects: z.array(z.string()).default([]),
  validationStatus: z
    .enum(["pending", "ok", "needs_review", "failed"])
    .default("pending"),
});

export const StorySchema = z.object({
  /** Immutable snapshot of the story as first submitted. */
  originalText: z.string(),
  /**
   * Current working text. Only changes when the user explicitly revises.
   * AI suggestions must never write here automatically.
   */
  currentText: z.string(),
  language: z.string().default("en"),
  targetDurationSeconds: z.number().positive().optional(),
  revisions: z
    .array(
      z.object({
        at: z.string(),
        note: z.string().optional(),
        text: z.string(),
      }),
    )
    .default([]),
});

export const CharacterProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  appearance: z.string().optional(),
  clothing: z.string().optional(),
  distinguishingFeatures: z.string().optional(),
  /** Relative path under project references/ */
  referenceImagePath: z.string().optional(),
  consistencyNotes: z.string().optional(),
});

export const ProductionSchema = z.object({
  visualStyle: z.record(z.unknown()).default({}),
  characterProfiles: z.array(CharacterProfileSchema).default([]),
  narrationProfile: z.record(z.unknown()).default({}),
  musicProfile: z.record(z.unknown()).default({}),
  globalInstructions: z.string().default(""),
});

// ---------------------------------------------------------------------------
// Production Package (what the user prepares externally and pastes)
// ---------------------------------------------------------------------------

export const ProductionCharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  appearance: z.string().optional(),
  clothing: z.string().optional(),
  distinguishingFeatures: z.string().optional(),
  consistencyNotes: z.string().optional(),
  referenceImagePrompt: z.string().optional(),
});

export const ProductionSceneSchema = z.object({
  number: z.number().int().positive(),
  id: z.string().optional(), // auto-generated if missing
  title: z.string().optional(),

  originalNarration: z.string().min(1),
  productionNarration: z.string().min(1),

  emotion: z.string().optional(),
  narrationInstructions: z.string().optional(),
  voice: z.string().optional(),
  speed: z.number().positive().optional(),

  visualPrompt: z.string().min(1),
  negativePrompt: z.string().optional(),

  camera: CameraSchema.optional(),
  transition: TransitionSchema.optional(),

  durationHintSeconds: z.number().positive().optional(),
  soundEffects: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const ProductionPackageSchema = z.object({
  schemaVersion: z.literal(PRODUCTION_PACKAGE_VERSION),

  projectInfo: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    aspectRatio: AspectRatioSchema,
    targetDurationSeconds: z.number().positive().optional(),
    language: z.string().default("en"),
  }),

  visualStyle: z
    .object({
      overallStyle: z.string().optional(),
      colorPalette: z.string().optional(),
      lighting: z.string().optional(),
      cameraLanguage: z.string().optional(),
      negativePrompt: z.string().optional(),
      referenceNotes: z.string().optional(),
      additionalNotes: z.string().optional(),
    })
    .default({}),

  characterProfiles: z.array(ProductionCharacterSchema).default([]),

  narrationProfile: z
    .object({
      defaultVoice: z.string().optional(),
      defaultSpeed: z.number().positive().optional(),
      defaultEmotion: z.string().optional(),
      language: z.string().optional(),
      globalInstructions: z.string().optional(),
    })
    .default({}),

  musicProfile: z
    .object({
      style: z.string().optional(),
      mood: z.string().optional(),
      intensity: z.string().optional(),
      referenceNotes: z.string().optional(),
      soundDesignNotes: z.string().optional(),
    })
    .default({}),

  globalInstructions: z.string().optional(),

  scenes: z.array(ProductionSceneSchema).min(1),
});

export type ProductionPackage = z.infer<typeof ProductionPackageSchema>;
export type ProductionScene = z.infer<typeof ProductionSceneSchema>;
export type ProductionCharacter = z.infer<typeof ProductionCharacterSchema>;

// ---------------------------------------------------------------------------
// Production Intake – three data layers
// ---------------------------------------------------------------------------

export const NodeValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const NodeValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(NodeValidationIssueSchema).default([]),
  warnings: z.array(NodeValidationIssueSchema).default([]),
});

export const GeminiIssueSchema = z.object({
  severity: z.enum(["critical", "important", "suggestion"]),
  path: z.string().optional(),
  message: z.string(),
  proposedFix: z.string().optional(),
});

export const GeminiVerificationReportSchema = z.object({
  summary: z.string(),
  issues: z.array(GeminiIssueSchema).default([]),
  overallScore: z.number().min(0).max(100).optional(),
});

export const ProductionVerificationSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed"]),
  submittedAt: z.string(),
  completedAt: z.string().optional(),
  nodeValidation: NodeValidationResultSchema,
  geminiReport: GeminiVerificationReportSchema.optional(),
  proposedPackage: ProductionPackageSchema.optional(),
});

export const ProductionIntakeSchema = z.object({
  /** Immutable original package submitted by the user */
  originalSubmission: ProductionPackageSchema,

  /** Result after Node.js + Gemini verification */
  verification: ProductionVerificationSchema.optional(),

  /** User-approved package that will drive generation */
  approvedPackage: ProductionPackageSchema.optional(),
  approvedAt: z.string().optional(),
  approvedByUser: z.boolean().default(false),
});

export type NodeValidationResult = z.infer<typeof NodeValidationResultSchema>;
export type GeminiVerificationReport = z.infer<typeof GeminiVerificationReportSchema>;
export type ProductionVerification = z.infer<typeof ProductionVerificationSchema>;

export type ProductionIntake = z.infer<typeof ProductionIntakeSchema>;

// ---------------------------------------------------------------------------
// Gemini Decision 1 – bounded decisions (Node-controlled)
// ---------------------------------------------------------------------------

/**
 * Phase 5: Gemini Decision 1
 * Node.js owns routing and control. Gemini only answers a strictly bounded
 * question (yes/no, multiple-choice, or numeric score). Never invents content
 * or auto-applies changes.
 */
export const DecisionTypeSchema = z.enum([
  "yes_no",
  "multiple_choice",
  "score",
]);

export const DecisionRequestSchema = z.object({
  /** Unique id for this decision (client-generated or server-assigned) */
  id: z.string().optional(),
  type: DecisionTypeSchema,
  /** Clear, self-contained question for Gemini */
  question: z.string().min(1),
  /** Optional context (e.g. relevant scene, issue path, or package excerpt) */
  context: z.string().optional(),
  /** Required for multiple_choice – list of allowed options */
  options: z.array(z.string().min(1)).min(2).optional(),
  /** For score type: inclusive range (default 0–100) */
  scoreMin: z.number().optional(),
  scoreMax: z.number().optional(),
  /** Optional path in the package this decision relates to */
  relatedPath: z.string().optional(),
});

export const DecisionResultSchema = z.object({
  id: z.string(),
  type: DecisionTypeSchema,
  question: z.string(),
  /** The chosen answer (yes/no string, option text, or score number as string) */
  answer: z.string(),
  /** Numeric score when type === "score" */
  score: z.number().optional(),
  /** Short rationale from Gemini */
  rationale: z.string().optional(),
  /** Confidence 0–1 if provided */
  confidence: z.number().min(0).max(1).optional(),
  decidedAt: z.string(),
  relatedPath: z.string().optional(),
});

export type DecisionType = z.infer<typeof DecisionTypeSchema>;
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
export type DecisionResult = z.infer<typeof DecisionResultSchema>;


// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const ProjectMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  aspectRatio: AspectRatioSchema.default("9:16"),
  resolution: ResolutionSchema,
  fps: z.number().int().positive().default(30),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const AssetsIndexSchema = z.object({
  images: z.array(z.string()).default([]),
  audio: z.array(z.string()).default([]),
  music: z.array(z.string()).default([]),
  soundEffects: z.array(z.string()).default([]),
});

export const ValidationSchema = z.object({
  status: z.enum(["pending", "ready", "needs_input", "failed"]).default("pending"),
  issues: z.array(z.string()).default([]),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  project: ProjectMetaSchema,
  story: StorySchema,
  production: ProductionSchema.default({}),
  scenes: z.array(SceneSchema).default([]),
  assets: AssetsIndexSchema.default({}),
  settings: z.record(z.unknown()).default({}),
  validation: ValidationSchema.default({}),

  /** Phase 1–2: Production intake & verification layers (optional for backward compatibility) */
  productionIntake: ProductionIntakeSchema.optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Story = z.infer<typeof StorySchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type AudioAsset = z.infer<typeof AudioAssetSchema>;
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

/** Minimal props passed into the Remotion composition / Player. */
export const StoryVideoPropsSchema = z.object({
  projectId: z.string(),
  title: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  scenes: z.array(SceneSchema),
  /**
   * How asset paths in scenes should be resolved:
   * - "preview": paths are URL prefixes served by the API (e.g. /assets/story_001/...)
   * - "render": paths are local filesystem paths relative to the project directory
   */
  assetMode: z.enum(["preview", "render"]).default("preview"),
  /** Base URL for preview mode (e.g. http://localhost:8788/assets/story_001) */
  assetBaseUrl: z.string().optional(),
  /** Optional background music bed (relative or absolute path). */
  musicPath: z.string().optional(),
  /** Music bed volume 0–1 (default 0.22, ducked under narration). */
  musicVolume: z.number().min(0).max(1).optional(),
});

export type StoryVideoProps = z.infer<typeof StoryVideoPropsSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createEmptyProject(
  id: string,
  title = "Untitled Project",
  aspectRatio: "9:16" | "16:9" = "9:16",
): Project {
  const now = new Date().toISOString();
  const resolution = resolutionForAspectRatio(aspectRatio);
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      id,
      title,
      description: "",
      aspectRatio,
      resolution,
      fps: 30,
      createdAt: now,
      updatedAt: now,
    },
    story: {
      originalText: "",
      currentText: "",
      language: "en",
      revisions: [],
    },
    production: {
      visualStyle: {},
      characterProfiles: [],
      narrationProfile: {},
      musicProfile: {},
      globalInstructions: "",
    },
    scenes: [],
    assets: { images: [], audio: [], music: [], soundEffects: [] },
    settings: {},
    validation: { status: "pending", issues: [] },
  };
}

/** Create a minimal valid ProductionPackage template for the JSON editor. */
export function createEmptyProductionPackage(
  title = "Untitled Project",
  aspectRatio: "9:16" | "16:9" = "9:16",
): ProductionPackage {
  return {
    schemaVersion: PRODUCTION_PACKAGE_VERSION,
    projectInfo: {
      title,
      aspectRatio,
      language: "en",
    },
    visualStyle: {},
    characterProfiles: [],
    narrationProfile: {},
    musicProfile: {},
    scenes: [
      {
        number: 1,
        originalNarration: "",
        productionNarration: "",
        visualPrompt: "",
      },
    ],
  };
}
