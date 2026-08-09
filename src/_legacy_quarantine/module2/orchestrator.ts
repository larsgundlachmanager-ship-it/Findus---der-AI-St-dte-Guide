/**
 * Orchestrator — delegiert Tasks an Agenten (Fast Lane parallel, Slow Lane async).
 */

import type { AgentResult, PipelineTask } from '../types';
import type { RucksackState } from '../rucksack/rucksackStore';
import { agentForIntent } from '../agents/registry';

export type OrchestratorOutput = {
  fastResults: AgentResult[];
  deepPromise: Promise<AgentResult> | null;
};

export async function runOrchestrator(opts: {
  tasks: PipelineTask[];
  rucksack: RucksackState;
  signal?: AbortSignal;
}): Promise<OrchestratorOutput> {
  const { tasks, rucksack, signal } = opts;

  const deepTasks = tasks.filter((t) => t.intent === 'deep_research');
  const fastTasks = tasks.filter((t) => t.intent !== 'deep_research');

  const fastResults = await Promise.all(
    (fastTasks.length ? fastTasks : tasks.slice(0, 1)).map(async (task) => {
      if (signal?.aborted) {
        return {
          agent: task.intent,
          ok: false,
          draftText: '',
          error: { code: 'aborted', message: 'aborted' },
        } satisfies AgentResult;
      }
      // Intent kommt vom LLM-Router — nie unknown/heuristisch umbiegen
      // planning (legacy) → knowledge
      const intent =
        task.intent === 'unknown' || task.intent === 'planning'
          ? 'knowledge'
          : task.intent;
      const agent = agentForIntent(intent);
      return agent.run({ task: { ...task, intent }, rucksack, signal });
    }),
  );

  let deepPromise: Promise<AgentResult> | null = null;
  if (deepTasks[0]) {
    const t = deepTasks[0];
    deepPromise = agentForIntent('deep_research').run({
      task: t,
      rucksack,
      signal,
    });
  }

  return { fastResults, deepPromise };
}
