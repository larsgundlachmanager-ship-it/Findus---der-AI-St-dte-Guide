/**
 * Side-effect: Protomaps-Style Warm beim Bundle-Einstieg (Splash-Overlap).
 * Import zuerst in index.ts — vor App-Mount.
 *
 * Wichtig: kein Sync-Import von FileSystem/Style-Loader hier.
 * Sonst kann der erste Frame (Splash) hängen → wirkt wie Blackscreen.
 */
void Promise.resolve().then(() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isVectorBasemapEnabled } = require('./mapTileConfig') as {
      isVectorBasemapEnabled: () => boolean;
    };
    if (!isVectorBasemapEnabled()) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { beginYorroProtomapsStyleWarm } = require('./yorroProtomapsBasemapStyle') as {
      beginYorroProtomapsStyleWarm: () => Promise<unknown>;
    };
    void beginYorroProtomapsStyleWarm();
  } catch {
    /* soft — Boot darf nie an Style-Warm scheitern */
  }
});
