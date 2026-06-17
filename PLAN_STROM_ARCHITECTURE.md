# Plano: Strom Pipeline Architecture v2

## Decisões (2026-06-16)

| Item | Escolha |
|---|---|
| Layout | Vertical (top → down) |
| Granularidade | 9 estágios + 5 data stores + nós externos |
| Dados nos exemplos | Hard-coded curado (snapshot) |
| Cadência | A→E em sequência, sem pausa |

## Inventário

### 9 Estágios processuais
0. Excel Upload (CDIO Gating Pre-review)
1. Drive Discovery (root → match PRJ folders)
2. Drive Download (Google API + filesystem)
3. File Hygiene (cross-PRJ, OLD_VERSION, dedupe)
4. Text Extraction (.txt/.docx/.pdf/.csv)
5. Goals Extraction (Gemini)
6. Sanitization + Persist (validators + upsert)
7. Impact Analysis (Gemini, batched)
8. Deep Dive (Gemini, on-demand)
9. UI Assembly (`/api/impact/project/universe`)

### 5 Data stores
- `projects`
- `documents_cache`
- `project_goals`
- `projects_impact`
- `impact_deep_dives`

### Externos
- Google Drive API
- Gemini API
- CDIO Gating Excel
- target-catalog.ts

## Ondas

| Onda | Escopo | Status |
|---|---|---|
| A | Esqueleto: stages.ts + canvas ReactFlow + painel lateral básico | pending |
| B | Tabs Input/Output com exemplos curados por stage | pending |
| C | Tabs Code/Prompt + Run (botões de trigger) | pending |
| D | Stats no header + animações + polish | pending |
| E | Migração: substituir StromView.tsx (legacy guardado) | pending |

## Estrutura de arquivos

```
src/components/StromArchitecture/
├── index.tsx                 # Entry, substitui StromView
├── canvas.tsx                # ReactFlow setup
├── stages.ts                 # Definição declarativa (single source of truth)
├── samples.ts                # Exemplos curados de input/output
├── nodes/
│   ├── StageNode.tsx
│   ├── DataStoreNode.tsx
│   └── ExternalNode.tsx
└── panels/
    ├── DetailPanel.tsx       # Container tabbed
    ├── OverviewTab.tsx
    ├── InputsTab.tsx
    ├── OutputTab.tsx
    ├── CodePromptTab.tsx
    ├── RunTab.tsx
    └── StatsTab.tsx
```

## Log

- `2026-06-16` — Onda A: `stages.ts` (9 stages + 5 stores + 3 externals + 19 edges), `StageNode.tsx` (8 type styles, store cylinder shape), `canvas.tsx` (ReactFlow vertical layout via row/col grid), `panels/DetailPanel.tsx` (6 tabs com bodies stub), `index.tsx`. Compila OK.
- `2026-06-16` — Onda B: `samples.ts` (15 snapshots curados: excel-row, drive-root-listing, target-catalog-entry, projects-row, documents-cache-row, hygiene-verdict, extracted-text, goals-llm-response, project-goals-row, impact-llm-response, projects-impact-row, deep-dive-row, universe-api-response, discovery-result). `panels/SampleBlock.tsx` (syntax tinting + copy). OutputTab renderiza.
- `2026-06-16` — Onda C: `PromptEditor` inline em CodePromptTab (carrega/salva via `/api/prompts`, com diff-detection + reset). `TriggerForm` inline em RunTab (editable body + run com response display). Deep-dive marca prompt como não-editável (composto em runtime).
- `2026-06-16` — Onda D: `/api/strom/stats` (read-only counts). Header com 5 counters (projects, docs, goals, impacts com %, deep dives). StatsTab por stage (switch case mostrando cards relevantes ao step). Poll de 30s.
- `2026-06-16` — Onda E: `StromView.tsx` → `StromView.legacy.tsx`. `page.tsx` aponta pra `StromArchitecture`. Bug de escape em strings (apóstrofes em single-quoted) corrigido com double-quotes. Compila OK.
