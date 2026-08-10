/**
 * @deprecated — Live-Pfad ist module1PoiChat / storyService (Reboot).
 */

export {
  beginHookResolvingStream as beginChainedStoryStream,
} from './storyService';

export function warnStoryPipelineDeprecated(name: string): void {
  if (__DEV__) {
    console.warn(
      `[storyPipeline] ${name} is deprecated — use module1PoiChat / storyService`,
    );
  }
}
