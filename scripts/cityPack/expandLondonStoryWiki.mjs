#!/usr/bin/env node
/**
 * Alias: London-Stories aus Wikipedia nachziehen.
 * SSOT: expandStoryWiki.mjs --city london
 */
import { expandStoryWiki } from './expandStoryWiki.mjs';

expandStoryWiki('london').catch((e) => {
  console.error(e);
  process.exit(1);
});
