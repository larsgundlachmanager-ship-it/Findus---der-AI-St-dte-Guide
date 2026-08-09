import type { AgentIntent } from '../types';
import type { Module2Agent } from './types';
import { emergencyAgent } from './emergencyAgent';
import { gastroAgent } from './gastroAgent';
import { mobilityAgent } from './mobilityAgent';
import { knowledgeAgent } from './knowledgeAgent';
import { bookingAgent } from './bookingAgent';
import { umweltAgent } from './umweltAgent';
import { systemAgent } from './systemAgent';
import { memoryAgent } from './memoryAgent';
import { translationAgent } from './translationAgent';
import { triggerAgent } from './triggerAgent';
import { deepResearchAgent } from './deepResearchAgent';
import { smalltalkAgent } from './smalltalkAgent';

export const MODULE2_AGENTS: Module2Agent[] = [
  emergencyAgent,
  gastroAgent,
  mobilityAgent,
  knowledgeAgent,
  bookingAgent,
  umweltAgent,
  systemAgent,
  memoryAgent,
  translationAgent,
  triggerAgent,
  deepResearchAgent,
  smalltalkAgent,
];

export function agentForIntent(intent: AgentIntent): Module2Agent {
  const hit = MODULE2_AGENTS.find((a) => a.intents.includes(intent));
  // Nie ins Leere: unbekannte Lane / planning → Wissen (recherchierbar), nicht Menü-Fallback
  return hit ?? MODULE2_AGENTS.find((a) => a.id === 'knowledge') ?? smalltalkAgent;
}
