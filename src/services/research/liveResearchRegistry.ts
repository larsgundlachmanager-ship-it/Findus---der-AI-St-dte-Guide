/**
 * Live-Research-Prompts aus Stadt-Pack (_live_research).
 * Ephemeral: Preise, Speisekarten, heutige Events — nie als harte Pack-Fakten.
 */

export type PackLiveResearchPrompt = {
  id: string;
  topic: string;
  prompt: string;
  tags?: string[];
  related_spot_ids?: string[];
};

let prompts: PackLiveResearchPrompt[] = [];

export function clearLiveResearchPackConfig(): void {
  prompts = [];
}

export function setLiveResearchPackConfig(
  list: PackLiveResearchPrompt[] | null | undefined,
): void {
  prompts = Array.isArray(list)
    ? list.filter((p) => p?.prompt?.trim())
    : [];
}

export function getLiveResearchPrompts(): PackLiveResearchPrompt[] {
  return [...prompts];
}

export function formatLiveResearchForPrompt(
  list: PackLiveResearchPrompt[] = prompts,
): string {
  if (!list.length) return '';
  const lines = list.slice(0, 6).map(
    (p) =>
      `- [${p.topic || p.id}] LIVE SUCHEN (nicht aus Pack-Preisen raten): ${p.prompt.trim()}`,
  );
  return [
    'LIVE-RESEARCH (ephemeral — Preise/Events/Speisekarten/Hotels immer frisch suchen, Links neu finden):',
    ...lines,
  ].join('\n');
}
