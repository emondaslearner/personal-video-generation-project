import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { StoryVideoProps, Scene, Camera } from "@framewright/shared";

/**
 * Resolve a relative asset path for preview (URL) or render (local / static).
 */
function resolveAssetUrl(
  relativePath: string | undefined,
  assetMode: "preview" | "render",
  assetBaseUrl?: string,
): string | null {
  if (!relativePath) return null;
  if (
    relativePath.startsWith("http://") ||
    relativePath.startsWith("https://") ||
    relativePath.startsWith("data:") ||
    relativePath.startsWith("blob:")
  ) {
    return relativePath;
  }

  const cleaned = relativePath
    .split(String.fromCharCode(92))
    .join("/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\/+/, "");

  if (assetMode === "render") {
    // Files staged under story-video-engine/public/ before export
    return staticFile(cleaned);
  }

  if (assetMode === "preview" && assetBaseUrl) {
    const base = assetBaseUrl.replace(/\/$/, "");
    return `${base}/${cleaned}`;
  }

  return `/${cleaned}`;
}

/**
 * Ken-Burns / camera transform for the current frame inside a scene.
 */
function useCameraTransform(
  camera: Camera | undefined,
  durationInFrames: number,
): React.CSSProperties {
  const frame = useCurrentFrame();
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;

  const type = camera?.type ?? "static";
  const zoomFrom = camera?.zoomFrom ?? 1;
  const zoomTo =
    camera?.zoomTo ??
    (type === "zoom_in" ? 1.15 : type === "zoom_out" ? 0.9 : 1);
  const panX = camera?.panX ?? 0;
  const panY = camera?.panY ?? 0;

  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  switch (type) {
    case "zoom_in":
      scale = interpolate(progress, [0, 1], [zoomFrom, zoomTo], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      break;
    case "zoom_out":
      scale = interpolate(progress, [0, 1], [zoomFrom || 1.12, zoomTo || 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      break;
    case "pan_left":
      translateX = interpolate(progress, [0, 1], [panX || 4, -(panX || 4)], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      scale = 1.08;
      break;
    case "pan_right":
      translateX = interpolate(progress, [0, 1], [-(panX || 4), panX || 4], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      scale = 1.08;
      break;
    case "pan_up":
      translateY = interpolate(progress, [0, 1], [panY || 4, -(panY || 4)], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      scale = 1.08;
      break;
    case "pan_down":
      translateY = interpolate(progress, [0, 1], [-(panY || 4), panY || 4], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      scale = 1.08;
      break;
    default:
      scale = 1;
      break;
  }

  return {
    transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
    transformOrigin: "center center",
  };
}


/** Split narration into readable subtitle chunks (~8–12 words). */
function chunkSubtitleText(text: string, maxWords = 10): string[] {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const words = cleaned.split(" ");
  if (words.length <= maxWords) return [cleaned];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  return chunks;
}

type SubtitleCue = { text: string; start: number; end: number };

/**
 * Build timed subtitle cues for a scene.
 * Prefers explicit scene.subtitle; otherwise uses narration text.
 */
function buildSubtitleCues(scene: Scene): SubtitleCue[] {
  const explicit = scene.subtitle;
  if (explicit?.text?.trim()) {
    const start = explicit.startFrame ?? 0;
    const end = explicit.endFrame ?? scene.durationInFrames;
    return [{ text: explicit.text.trim(), start, end }];
  }

  const source = (scene.narration || scene.originalNarration || "").trim();
  if (!source) return [];

  const chunks = chunkSubtitleText(source, 10);
  if (chunks.length === 0) return [];

  // Leave a little margin at start/end for fades
  const margin = Math.min(6, Math.floor(scene.durationInFrames * 0.05));
  const usable = Math.max(1, scene.durationInFrames - margin * 2);
  const per = usable / chunks.length;

  return chunks.map((text, i) => ({
    text,
    start: margin + Math.floor(i * per),
    end: margin + Math.floor((i + 1) * per),
  }));
}

const SubtitleOverlay: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const cues = useMemo(() => buildSubtitleCues(scene), [scene]);
  if (cues.length === 0) return null;

  const active = cues.find((c) => frame >= c.start && frame < c.end);
  if (!active) return null;

  // Soft fade within each cue
  const fade = Math.min(4, Math.floor((active.end - active.start) / 4));
  const opacity = interpolate(
    frame,
    [active.start, active.start + fade, active.end - fade, active.end],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: "8%",
        paddingLeft: "6%",
        paddingRight: "6%",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity,
          maxWidth: "92%",
          textAlign: "center",
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 42,
          fontWeight: 600,
          lineHeight: 1.35,
          color: "#ffffff",
          textShadow:
            "0 2px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
          backgroundColor: "rgba(0,0,0,0.45)",
          borderRadius: 12,
          padding: "12px 20px",
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};

type TransitionType = "cut" | "fade" | "crossfade";

function getTransition(
  scene: Scene,
): { type: TransitionType; durationInFrames: number } {
  const t = scene.transition;
  if (!t || t.type === "cut" || !t.durationInFrames || t.durationInFrames <= 0) {
    return { type: "cut", durationInFrames: 0 };
  }
  // Cap transition length so it never exceeds half the scene
  const max = Math.max(1, Math.floor(scene.durationInFrames / 2));
  return {
    type: t.type,
    durationInFrames: Math.min(t.durationInFrames, max),
  };
}

/**
 * Build a timeline that supports overlapping sequences for crossfade
 * and fade-to-black gaps for fade transitions.
 *
 * Convention: `scene.transition` describes the transition used when
 * *entering* this scene (from the previous one).
 */
type TimelineEntry = {
  scene: Scene;
  /** Global start frame of this scene's content */
  start: number;
  /** How long this scene's Sequence lasts (includes outgoing overlap) */
  duration: number;
  /** Incoming transition applied at the start of this scene */
  inTransition: { type: TransitionType; durationInFrames: number };
  /** Outgoing transition applied at the end of this scene */
  outTransition: { type: TransitionType; durationInFrames: number };
};

function buildTimeline(scenes: Scene[]): {
  entries: TimelineEntry[];
  totalFrames: number;
} {
  if (scenes.length === 0) return { entries: [], totalFrames: 0 };

  const entries: TimelineEntry[] = [];
  let cursor = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const inTrans = i === 0 ? { type: "cut" as const, durationInFrames: 0 } : getTransition(scene);
    const nextScene = scenes[i + 1];
    const outTrans = nextScene
      ? getTransition(nextScene)
      : { type: "cut" as const, durationInFrames: 0 };

    // For crossfade: next scene starts `outTrans.duration` frames before this one ends
    // For fade: we insert a short black gap equal to the transition duration
    // For cut: hard adjacent

    const start = cursor;
    let duration = scene.durationInFrames;

    // When this scene has an outgoing crossfade, extend its sequence so it
    // stays visible during the overlap window.
    if (outTrans.type === "crossfade" && outTrans.durationInFrames > 0) {
      // content duration already includes the overlap region visually;
      // we keep duration as the full scene length; next starts early.
    }

    entries.push({
      scene,
      start,
      duration,
      inTransition: inTrans,
      outTransition: outTrans,
    });

    if (outTrans.type === "crossfade" && outTrans.durationInFrames > 0) {
      // Next scene starts early by the crossfade length
      cursor += scene.durationInFrames - outTrans.durationInFrames;
    } else if (outTrans.type === "fade" && outTrans.durationInFrames > 0) {
      // Full scene, then black gap of transition length, then next
      cursor += scene.durationInFrames + outTrans.durationInFrames;
    } else {
      cursor += scene.durationInFrames;
    }
  }

  // Total = end of last scene
  const last = entries[entries.length - 1];
  const totalFrames = last ? last.start + last.duration : 0;

  return { entries, totalFrames };
}


/**
 * Pure helper: total composition length accounting for crossfade overlaps
 * and fade-to-black gaps. Use this for Player durationInFrames and
 * Remotion calculateMetadata.
 */
export function computeCompositionDuration(scenes: Scene[]): number {
  if (!scenes.length) return 30;
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const next = scenes[i + 1];
    const outTrans = next ? getTransition(next) : { type: "cut" as const, durationInFrames: 0 };

    if (outTrans.type === "crossfade" && outTrans.durationInFrames > 0) {
      cursor += scene.durationInFrames - outTrans.durationInFrames;
    } else if (outTrans.type === "fade" && outTrans.durationInFrames > 0) {
      cursor += scene.durationInFrames + outTrans.durationInFrames;
    } else {
      cursor += scene.durationInFrames;
    }
  }
  // Add the last scene fully (the loop above advances to the start of a non-existent next)
  // Actually the loop already added each scene; for the last scene we always add full duration.
  // Re-compute more carefully:
  cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const next = scenes[i + 1];
    if (!next) {
      cursor += scene.durationInFrames;
      break;
    }
    const outTrans = getTransition(next);
    if (outTrans.type === "crossfade" && outTrans.durationInFrames > 0) {
      cursor += scene.durationInFrames - outTrans.durationInFrames;
    } else if (outTrans.type === "fade" && outTrans.durationInFrames > 0) {
      cursor += scene.durationInFrames + outTrans.durationInFrames;
    } else {
      cursor += scene.durationInFrames;
    }
  }
  return Math.max(30, cursor);
}

export const StoryVideo: React.FC<StoryVideoProps> = ({
  title,
  scenes,
  assetMode = "preview",
  assetBaseUrl,
  musicPath,
  musicVolume = 0.22,
}) => {
  const { entries } = useMemo(() => buildTimeline(scenes), [scenes]);
  const totalDuration = useMemo(() => computeCompositionDuration(scenes), [scenes]);

  const musicUrl = resolveAssetUrl(musicPath, assetMode, assetBaseUrl);

  if (scenes.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 48, fontWeight: 700 }}>Framewright</div>
        <div style={{ fontSize: 24, opacity: 0.8 }}>{title || "Empty project"}</div>
        <div style={{ fontSize: 18, opacity: 0.5 }}>
          No scenes yet — generate narration & images after approval
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f172a" }}>
      {/* Continuous music bed under the whole composition (ducked volume) */}
      {musicUrl && (
        <Sequence from={0} durationInFrames={totalDuration} name="MusicBed">
          <Audio src={musicUrl} volume={musicVolume} loop />
        </Sequence>
      )}

      {entries.map((entry) => (
        <Sequence
          key={entry.scene.id}
          from={entry.start}
          durationInFrames={entry.duration}
          name={`Scene ${entry.scene.number}`}
        >
          <SceneLayer
            scene={entry.scene}
            assetMode={assetMode}
            assetBaseUrl={assetBaseUrl}
            inTransition={entry.inTransition}
            outTransition={entry.outTransition}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const SceneLayer: React.FC<{
  scene: Scene;
  assetMode: "preview" | "render";
  assetBaseUrl?: string;
  inTransition: { type: TransitionType; durationInFrames: number };
  outTransition: { type: TransitionType; durationInFrames: number };
}> = ({ scene, assetMode, assetBaseUrl, inTransition, outTransition }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cameraStyle = useCameraTransform(scene.camera, scene.durationInFrames);

  const imageUrl = resolveAssetUrl(scene.image?.path, assetMode, assetBaseUrl);
  const audioUrl = resolveAssetUrl(
    scene.audio?.status === "generated" ? scene.audio.path : undefined,
    assetMode,
    assetBaseUrl,
  );

  const hasImage =
    !!imageUrl &&
    (scene.image?.status === "generated" ||
      scene.image?.status === "accepted" ||
      !!scene.image?.path);

  // ---- Opacity driven by transitions ----
  // Incoming
  let inOpacity = 1;
  if (inTransition.type === "fade" || inTransition.type === "crossfade") {
    const d = Math.max(1, inTransition.durationInFrames);
    inOpacity = interpolate(frame, [0, d], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  // Outgoing
  let outOpacity = 1;
  if (outTransition.type === "fade" || outTransition.type === "crossfade") {
    const d = Math.max(1, outTransition.durationInFrames);
    const startOut = scene.durationInFrames - d;
    outOpacity = interpolate(frame, [startOut, scene.durationInFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  // Small safety fade so hard cuts are not jarring when no transition is set
  const micro = Math.min(4, Math.floor(scene.durationInFrames / 8));
  const microIn =
    inTransition.type === "cut"
      ? interpolate(frame, [0, micro], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const microOut =
    outTransition.type === "cut"
      ? interpolate(
          frame,
          [scene.durationInFrames - micro, scene.durationInFrames],
          [1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      : 1;

  const opacity = Math.min(inOpacity, outOpacity, microIn, microOut);

  // Audio volume follows the same envelope so narration doesn't pop
  const audioVolume = opacity;

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#0f172a" }}>
        {hasImage ? (
          <AbsoluteFill style={cameraStyle}>
            <Img
              src={imageUrl!}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </AbsoluteFill>
        ) : (
          <PlaceholderCard scene={scene} fps={fps} />
        )}
      </AbsoluteFill>

      {hasImage && (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.35) 100%)",
            pointerEvents: "none",
          }}
        />
      )}

      {audioUrl && <Audio src={audioUrl} volume={audioVolume} />}

      {/* Scene sound effects (paths relative to project) */}
      {(scene.soundEffects ?? []).map((sfx, i) => {
        const sfxUrl = resolveAssetUrl(sfx, assetMode, assetBaseUrl);
        if (!sfxUrl) return null;
        return <Audio key={`sfx-${i}`} src={sfxUrl} volume={0.55 * audioVolume} />;
      })}

      {/* Burned-in subtitles (explicit or auto from narration) */}
      <SubtitleOverlay scene={scene} />

      {!hasImage && (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            alignItems: "flex-end",
            padding: 24,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: "rgba(248,250,252,0.4)",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Scene {scene.number}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

const PlaceholderCard: React.FC<{ scene: Scene; fps: number }> = ({
  scene,
  fps,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#1e293b",
        color: "#f8fafc",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 64,
        opacity,
      }}
    >
      <div style={{ fontSize: 28, opacity: 0.6, marginBottom: 12 }}>
        Scene {scene.number}
      </div>
      <div
        style={{
          fontSize: 36,
          fontWeight: 600,
          textAlign: "center",
          maxWidth: "90%",
          lineHeight: 1.3,
        }}
      >
        {scene.narration || scene.originalNarration}
      </div>
      <div style={{ fontSize: 16, opacity: 0.45, marginTop: 24 }}>
        {scene.durationInFrames} frames @ {fps} fps
        {scene.audio?.status === "generated" ? " · audio ready" : ""}
        {scene.image?.path ? " · image pending" : " · no image yet"}
      </div>
    </AbsoluteFill>
  );
};
