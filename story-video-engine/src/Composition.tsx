import { CalculateMetadataFunction, Composition } from "remotion";
import type { StoryVideoProps } from "@framewright/shared";
import { StoryVideo, computeCompositionDuration } from "./StoryVideo";

const defaultProps: StoryVideoProps = {
  projectId: "placeholder",
  title: "Framewright Placeholder",
  width: 1080,
  height: 1920,
  fps: 30,
  assetMode: "preview",
  scenes: [
    {
      id: "scene_01",
      number: 1,
      originalNarration: "Welcome to Framewright.",
      narration: "Welcome to Framewright.",
      durationInFrames: 90,
      soundEffects: [],
      validationStatus: "pending",
    },
    {
      id: "scene_02",
      number: 2,
      originalNarration: "Phase 0 confirms Remotion preview and render.",
      narration: "Phase 0 confirms Remotion preview and render.",
      durationInFrames: 90,
      soundEffects: [],
      validationStatus: "pending",
    },
  ],
};

const calculateMetadata: CalculateMetadataFunction<StoryVideoProps> = ({
  props,
}) => {
  const durationInFrames = computeCompositionDuration(props.scenes);
  return {
    durationInFrames,
    fps: props.fps,
    width: props.width,
    height: props.height,
  };
};

export const MyComposition = () => {
  return (
    <Composition
      id="StoryVideo"
      component={StoryVideo}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
