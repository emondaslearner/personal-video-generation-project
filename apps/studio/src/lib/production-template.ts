import type { ProductionPackage } from "@framewright/shared";
import { createEmptyProductionPackage } from "@framewright/shared";

/** Default empty-ish template shown in the JSON editor for new projects. */
export function getDefaultProductionTemplate(
  title = "Untitled Project",
  aspectRatio: "9:16" | "16:9" = "9:16",
): ProductionPackage {
  const base = createEmptyProductionPackage(title, aspectRatio);

  return {
    ...base,
    projectInfo: {
      ...base.projectInfo,
      description: "",
      targetDurationSeconds: 60,
    },
    visualStyle: {
      overallStyle: "cinematic, high detail",
      colorPalette: "",
      lighting: "",
      cameraLanguage: "",
      negativePrompt: "blurry, low quality, deformed",
      referenceNotes: "",
      additionalNotes: "",
    },
    characterProfiles: [
      {
        id: "char_01",
        name: "Main Character",
        appearance: "",
        clothing: "",
        distinguishingFeatures: "",
        consistencyNotes: "",
      },
    ],
    narrationProfile: {
      defaultVoice: "af_bella",
      defaultSpeed: 1.0,
      defaultEmotion: "calm",
      language: "en",
      globalInstructions: "",
    },
    musicProfile: {
      style: "",
      mood: "",
      intensity: "medium",
      soundDesignNotes: "",
    },
    globalInstructions: "",
    scenes: [
      {
        number: 1,
        title: "Opening",
        originalNarration: "Write the locked original narration here.",
        productionNarration:
          "Write the production narration here (can match original).",
        emotion: "calm",
        visualPrompt: "Detailed visual prompt for the scene image...",
        negativePrompt: "",
        durationHintSeconds: 8,
        notes: "",
      },
    ],
  };
}

/**
 * Rich multi-scene sample for trying the full Framewright pipeline
 * (intake → verify → approve → narrate → images → preview → export).
 */
export function getSampleProductionPackage(
  title = "The Lantern in the Pines",
  aspectRatio: "9:16" | "16:9" = "9:16",
): ProductionPackage {
  return {
    schemaVersion: "2.1-package",
    projectInfo: {
      title,
      description:
        "A short atmospheric story about a traveler who follows a soft light into an ancient forest. Sample package for end-to-end testing.",
      aspectRatio,
      targetDurationSeconds: 45,
      language: "en",
    },
    visualStyle: {
      overallStyle:
        "cinematic fantasy realism, highly detailed, film still, shallow depth of field",
      colorPalette: "deep forest greens, cool moonlight blue, warm amber lantern glow",
      lighting: "moonlight with a single warm practical light from the lantern",
      cameraLanguage: "slow pushes and gentle pans; intimate and contemplative",
      negativePrompt:
        "blurry, low quality, deformed hands, extra limbs, text, watermark, cartoon, anime",
      referenceNotes: "Keep character face and coat consistent across scenes",
      additionalNotes: "Vertical storytelling framing; leave headroom for subtitles",
    },
    characterProfiles: [
      {
        id: "char_traveler",
        name: "The Traveler",
        appearance:
          "young adult with weathered features, short dark hair, calm attentive eyes",
        clothing:
          "long charcoal wool coat, leather satchel, worn boots, soft scarf",
        distinguishingFeatures: "small brass compass hanging from the satchel strap",
        consistencyNotes:
          "Same coat, satchel, and compass in every scene; face must remain consistent",
        referenceImagePrompt:
          "portrait of a young traveler in a charcoal wool coat with a brass compass, soft moonlight, cinematic",
      },
    ],
    narrationProfile: {
      defaultVoice: "af_bella",
      defaultSpeed: 0.95,
      defaultEmotion: "calm",
      language: "en",
      globalInstructions:
        "Speak slowly and clearly. Leave gentle pauses between sentences. Warm storytelling tone.",
    },
    musicProfile: {
      style: "ambient cinematic",
      mood: "mysterious, hopeful",
      intensity: "low to medium",
      referenceNotes: "Soft pads and distant piano; never overpower narration",
      soundDesignNotes: "Light forest night ambience under the bed",
    },
    globalInstructions:
      "Preserve a quiet, wonder-filled tone. Do not rush scene transitions. Favor atmospheric holds over action.",
    scenes: [
      {
        number: 1,
        id: "scene_01",
        title: "Edge of the Forest",
        originalNarration:
          "At the edge of the pines, the traveler stopped. Somewhere ahead, a soft light pulsed between the trees.",
        productionNarration:
          "At the edge of the pines, the traveler stopped. Somewhere ahead, a soft light pulsed between the trees.",
        emotion: "curious",
        narrationInstructions: "Soft intake of breath before the second sentence.",
        voice: "af_bella",
        speed: 0.95,
        visualPrompt:
          "Cinematic wide shot of a young traveler in a charcoal wool coat standing at the edge of a dark pine forest at night, cool moonlight, a distant warm amber glow deep between the trees, mist near the ground, highly detailed, film still",
        negativePrompt: "daytime, crowd, modern city, blurry",
        camera: { type: "zoom_in", zoomFrom: 1, zoomTo: 1.08 },
        transition: { type: "fade", durationInFrames: 12 },
        durationHintSeconds: 9,
        notes: "Establish location and mystery",
      },
      {
        number: 2,
        id: "scene_02",
        title: "The Path",
        originalNarration:
          "Each step deeper into the woods softened the world behind them. The lantern's glow grew clearer, patient and waiting.",
        productionNarration:
          "Each step deeper into the woods softened the world behind them. The lantern's glow grew clearer, patient and waiting.",
        emotion: "calm",
        narrationInstructions: "Slight pause after 'behind them.'",
        voice: "af_bella",
        speed: 0.92,
        visualPrompt:
          "Medium shot from behind the traveler walking a narrow path through tall dark pines at night, charcoal coat, leather satchel with brass compass, warm lantern light ahead through the trees, volumetric moonlight, cinematic, highly detailed",
        negativePrompt: "daytime, horror, blood, blurry face",
        camera: { type: "pan_right", panX: 3 },
        transition: { type: "crossfade", durationInFrames: 10 },
        durationHintSeconds: 10,
        notes: "Sense of moving deeper inward",
      },
      {
        number: 3,
        id: "scene_03",
        title: "The Lantern",
        originalNarration:
          "There, hanging from an old branch, the lantern burned without smoke. It had been left for someone who still knew how to follow the quiet.",
        productionNarration:
          "There, hanging from an old branch, the lantern burned without smoke. It had been left for someone who still knew how to follow the quiet.",
        emotion: "wonder",
        narrationInstructions: "Warm, almost whispered final line.",
        voice: "af_heart",
        speed: 0.9,
        visualPrompt:
          "Close cinematic shot of an antique brass lantern hanging from a gnarled pine branch at night, warm amber flame without smoke, soft bokeh forest background, traveler's hand reaching into frame, moonlight rim light, highly detailed, film still",
        negativePrompt: "modern flashlight, neon, blurry, text",
        camera: { type: "zoom_in", zoomFrom: 1, zoomTo: 1.12 },
        transition: { type: "fade", durationInFrames: 15 },
        durationHintSeconds: 11,
        notes: "Emotional landing; end on the lantern",
      },
    ],
  };
}

export function formatPackageForEditor(pkg: ProductionPackage): string {
  return JSON.stringify(pkg, null, 2);
}
