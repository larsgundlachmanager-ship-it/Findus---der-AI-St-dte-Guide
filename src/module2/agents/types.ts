import type { AgentResult, PipelineTask } from '../types';
import type { RucksackState } from '../rucksack/rucksackStore';

export type AgentContext = {
  task: PipelineTask;
  rucksack: RucksackState;
  signal?: AbortSignal;
};

export type Module2Agent = {
  id: string;
  intents: PipelineTask['intent'][];
  run: (ctx: AgentContext) => Promise<AgentResult>;
};
