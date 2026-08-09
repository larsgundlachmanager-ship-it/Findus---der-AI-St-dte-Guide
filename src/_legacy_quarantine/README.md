# Legacy Quarantine — Modul 2 / Concierge Alt-Stack

Diese Dateien sind **bewusst vom Live-Pfad getrennt**.

- Kein Import aus `src/module2/**` (außer dieser Ordner selbst) oder aktiven Mic-/Concierge-Pfaden.
- TypeScript: Ordner ist in `tsconfig.json` ausgeschlossen.
- **Live-SSOT:** `src/module2/reboot/runRebootPipeline.ts`  
  (Manager → Fact-Lanes → 1× Synthese → `presentToUi`)

Quarantiniert:

- `module2/runPipeline.legacy.ts` — alte Override-Leiter + LLM-Router
- `module2/llmIntentRouter.ts`
- `module2/llmSynthesis.ts`
- `module2/orchestrator.ts` (Modul-2 Agent-Orchestrator)
- `module2/taskSplitter.ts`
- `module2/conciergeTwoPass.ts`
- `module2/questionAnalysisService.ts`
- `module2/eveningDiningOrchestrator.ts`
- `module2/researchAck.ts`

Nicht wieder einbinden. Fact-Lanes und Reboot ersetzen diese Art und Weise.
