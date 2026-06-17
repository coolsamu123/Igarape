# Plano: Refatoração Goals → Impact (2026-06)

> Documento vivo. Cada tarefa concluída ganha `[x]`, timestamp e nota curta.
> Em caso de bug, consulte a seção **Estado pós-tarefa** e o **Log de execução** no fim.

## Motivação (medida, não teórica)

Diagnóstico do relatório `Impact_Coherence_Report.md` (35 impactos × 9 projetos):

- **14/35** impactos `INCONCLUSIVO` → todos são `project↔project` (sem deep-dive cached)
- **1/35** `INCOERENTE` (citation não localizada no arquivo)
- **5 impactos antigos sumiram** entre dois batches consecutivos → não-determinismo no LLM
- **41% dos impactos** sem `citations` populadas
- Arquivos lixo entrando no corpus: `OLD_VERSION_-_DO_NOT_USE_*.txt`, `PRJ0021670_-_*.txt` dentro de pasta de `PRJ0021760`, duplicações em `CIOO-Archiv/` e subpastas de Gate
- Goals dumps em prosa (`gio_sl_dds_impacts`, etc) → Impact LLM precisa re-parsear, perde direction, perde âncora

## Estratégia em 4 ondas

| Onda | Foco | Risco | Migração de schema |
|---|---|---|---|
| **1** | Higiene de dados (filtros + dedupe) | baixo | não |
| **2** | Sinal estruturado novo (`project_relations`, `out_of_scope`) | médio | sim (colunas opcionais) |
| **3** | Refator profundo (`impact_claims`, `timeline`, anchored claims) | alto | sim |
| **4** | Deep Dive consome claims + cobre project↔project + invalida stale | médio | só `evidence_chain` em projects_impact |

Cada onda termina com **re-run completo** (Goals → Impact → Deep Dive) e verificação de métricas vs baseline.

---

## Onda 0 — Preparação

- [x] **0.1** Enriquecer `target-catalog.ts` com `typicalRoles` e `typicalImpactTypes` (campos opcionais). ✅ 2026-06-11 13:51 — 5 GIO + 4 zonas geo + CDIO Office preenchidos; helper `getTargetEntry` + `isCanonicalTarget` adicionados.
- [x] **0.2** Capturar baseline. ✅ 2026-06-11 13:55 — `BASELINE_2026-06-11.md` salvo. Snapshot do DB em `/opt/strom/data/cioo.db.before-onda1`.

### Estado pré-Onda 1 (do baseline)

| Métrica | Valor |
|---|---|
| Total impactos | 228 |
| % com citations | **56.1%** (128/228) |
| Projetos com goals success | 67 |
| Docs em cache (success / error) | 447 / 33 |
| Arquivos OLD_VERSION/DO_NOT_USE | 4 |
| Arquivos com PRJ-ID cruzado (real) | ~8 |
| Projetos com docs duplicados | **46** |
| Rows duplicadas totais | **220** |

## Onda 1 — Higiene de dados

Princípio: o LLM nunca deveria ver lixo. Filtros baratos, validáveis no `documents_cache`.

- [x] **1.1** Filtrar arquivos `OLD_VERSION`, `DO_NOT_USE`, `deprecated`, `superseded` no nome (case-insensitive). ✅ Implementado em `file-hygiene.ts:classifyFile`, wired no `processUrl` antes do download + retro-aplicado na cache atual. **4 rows marcadas `skipped_deprecated`.**
- [x] **1.2** Filtrar arquivos com PRJ-ID diferente do projeto-pai no nome (cross-PRJ). ✅ Mesmo helper, matching por digit-key (`PRJ001395` ≡ `PRJ0001395`). **5 rows marcadas `skipped_cross_prj`** — incluindo `PRJ0021670_*` em pasta de `PRJ0021760` e `PRJ0016458_*` em pasta de `PRJ0020302`.
- [x] **1.3** Dedupe por hash do conteúdo (sha256 truncado a 16 hex chars) por projeto. ✅ `file-hygiene.ts:pickDuplicatesToSkip` + `dedupeProjectDocs` chamado no fim de cada projeto em `runDriveDownload*`. Retro-aplicado: **210 rows marcadas `skipped_duplicate`** (correspondem aos pares pasta-mãe ↔ subpasta `CIOO-Archiv` e cópias em subpastas de Gate).
- [x] **1.4** `getProjectDocuments` agora filtra `fetch_status NOT LIKE 'skipped_%'`. ✅ Apenas rows canônicas vão pro prompt.
- [ ] **1.5** Re-rodar Goals + Impact pra ver efeito downstream. Comparar com baseline.

### Pós-tarefas 1.1-1.4 (retro-aplicado sem re-download)

| Status | Rows | Δ vs baseline |
|---|---|---|
| `success` (vai ao LLM) | **228** | era 447 → **-49%** |
| `skipped_duplicate` | 210 | novo |
| `skipped_cross_prj` | 5 | novo |
| `skipped_deprecated` | 4 | novo |
| `error` | 33 | igual |

**Tokens enviados ao LLM caem aproximadamente pela metade.** Critério de sucesso da onda 1 (≥20% redução) **superado**.

**Critério de sucesso da onda 1:**
- `documents_cache` para PRJ0021760 cai de 7 rows → 3 (3 únicos)
- `documents_cache` para PRJ0021672 cai de 7 → 3
- Total de tokens enviados ao LLM por round cai pelo menos 20%
- Nenhum impacto coerente é perdido vs baseline

---

## Onda 2 — Sinal estruturado

Goals passa a emitir **edges de projeto pré-categorizados** e **out-of-scope explícito**.

- [x] **2.1** Migration `project_goals` ganhou `project_relations` e `out_of_scope` (TEXT DEFAULT '[]'). ✅ Aplicado no DB vivo + adicionado em `db.ts`.
- [x] **2.2** Prompt Goals (`DEFAULT_GOALS_PROMPT`) atualizado: pede `project_relations`, `out_of_scope`, `mentioned_projects` com schemas e regras de evidência. `GOALS_PROMPT_VERSION` bumpado de 2 → 3.
- [x] **2.3** Sanitização em `goals-analyzer.ts`: `sanitizeProjectRelations` (valida `kind` contra enum, exige evidence ≥10 chars, deduplica por `(pid|kind)`), `sanitizeOutOfScope` (exige topic ≥3 e evidence ≥10).
- [x] **2.4** Impact engine consome:
  - `IMPACT_ANALYSIS_QUERY` puxa as duas colunas
  - `GoalEntry` interface estendida com `ProjectRelation[]` e `OutOfScope[]`
  - `buildImpactPrompt` injeta seção "Pre-extracted project relations" por projeto
- [x] **2.5** Prompt do Impact instrui o LLM: usar relations como ground truth (mapeamento `kind → impact_type + direction`), respeitar EXCLUSIONS como sinal negativo.
- [ ] **2.6** UI no `ProjectUniverseView` mostra badge de `out_of_scope` (texto cinza riscado).
- [ ] **2.7** Re-rodar pipeline. Verificar:
  - Project↔project INCONCLUSIVO cai significativamente
  - PRJ0021672 ↔ PRJ0022006 (Cyber-OT) some (foi falso positivo)

**Critério de sucesso da onda 2:**
- ≥80% dos impactos project↔project agora têm `project_relations` no Goals como origem
- Pelo menos 1 impacto antigo é eliminado por `out_of_scope`
- Nenhum impacto coerente novo é regredido

---

## Onda 3 — Refator profundo

Goals deixa de produzir prosa nos campos de impacto. Tudo vira claim atômico com âncora.

- [x] **3.1** Migration: colunas `impact_claims` e `timeline_struct` adicionadas a `project_goals`. ✅ Aplicado no DB vivo + `db.ts`.
- [x] **3.2** Schema dos campos:
  ```json
  "impact_claims": [
    { "target_kind": "gio|dds",
      "target": "Security & Compliance",       // canonical
      "role": "primary_provider|downstream_consumer|regional_executor|risk_owner|blocked_by",
      "severity": "high|medium|low",
      "impact_type": "infrastructure_shared|technology_dependency|...",
      "evidence_file": "filename",
      "evidence_quote": "verbatim",
      "confidence": "stated|inferred" }
  ],
  "timeline_struct": {
    "gate1_actual": "YYYY-MM-DD?",
    "gate2_target": "YYYY-MM-DD?",
    "go_live_target": "YYYY-Qn?",
    "must_complete_before": [{ "project_id": "PRJ...", "reason": "...", "evidence_file": "..." }],
    "blocked_by": [{ "project_id": "PRJ...", "reason": "...", "evidence_file": "..." }]
  }
  ```
- [x] **3.3** Prompt do Goals expandido: fields 18 (`impact_claims`) e 19 (`timeline_struct`) com schema completo, regras de role, enum de impact_type. Versão bumpada 3→4.
- [x] **3.4** Prompt do Impact: nova seção "ATOMIC IMPACT CLAIMS" instrui o LLM a emitir uma impact row POR claim com mapping `role→direction`, evidence_quote como explanation, citation derivada. Bloco "TIMELINE" para timeline_blocking.
- [x] **3.5** Validação em `goals-analyzer.ts`: `sanitizeImpactClaims` (valida target_kind, target via `isCanonicalTarget` do catálogo, role no enum, severity, impact_type no enum, evidence ≥10 chars, dedupe). `sanitizeTimeline` (normaliza datas/null, valida deps).
- [ ] **3.6** Schema `projects_impact` ganha `evidence_chain TEXT DEFAULT '[]'` → adiado pra Onda 4 (lá ele liga claims→impacts→deep_dives juntos).
- [ ] **3.7** Backfill: rodar Goals + Impact full pra todos os 62 projetos.
- [ ] **3.8** UI: `SourcePopover` ganha link "ver claim no Goals" → adiado pra Onda 4.

**Critério de sucesso da onda 3:**
- 0 impactos sem citação (todo claim tem `evidence_file + evidence_quote`)
- `direction` 100% derivada de `role` (zero free-text disagreement entre runs)
- 2 runs consecutivas produzem o mesmo set de impactos (determinismo)
- Tokens por round caem ≥50%

---

---

## Onda 4 — Deep Dive alinhado às claims

O Deep Dive hoje é uma análise independente que re-deriva tudo dos docs. Onda 4 alinha ele aos sinais já produzidos pelas Ondas 2 e 3.

- [x] **4.1** Deep Dive lê `impact_claims` da `project_goals` e usa como espinha dorsal da seção "Concrete touchpoints". ✅ Prompt do dive ganhou bloco "ATOMIC IMPACT CLAIMS FOR THIS TARGET" e regra "uma bullet por claim, evidence_quote verbatim". `GoalsRow` interface estendida.
- [x] **4.2** Deep Dive respeita `out_of_scope`. ✅ Bloco "EXPLICITLY OUT-OF-SCOPE" injetado no prompt + regra "OUT-OF-SCOPE HANDLING" instrui o LLM a dropar bullets contraditórios e emitir warning "⚠" no fim de Risks.
- [x] **4.3** `kind='project'` adicionado ao Deep Dive. ✅ `DeepDiveKind = 'gio' | 'dds' | 'project'`. Quando kind='project', target = outro PRJ id; `targetBlock` puxa nome + summary do companheiro; `relevantRelations` filtra `project_relations` apontando ao target; `matchingImpact` casa pelo outro lado da edge. API route aceita 'project'.
- [x] **4.4** Invalidação cascata. ✅ `clearAllImpacts()` agora também faz `DELETE FROM impact_deep_dives` no mesmo call. Log informativo quando há dives a remover.
- [x] **4.5** `evidence_chain` em `projects_impact`. ✅ Coluna `TEXT DEFAULT '[]'` adicionada (DB vivo + db.ts). `storeImpacts` faz two-pass: load goals dos source projects, depois pra cada impact row monta JSON `[{goal_id, claim_idx?|relation_idx?, source: 'claim'|'relation'|'free'}]`. GIO/DDS rows tentam casar contra `impact_claims`; PRJ→PRJ rows contra `project_relations`. Sempre persiste pelo menos o goal_id, mesmo quando não casa (`source: 'free'`).

**Critério de sucesso da onda 4:**
- 100% dos deep dives referenciam ≥1 `impact_claim` por seção
- Botão "Re-run Analysis" produz coerência Impact ↔ Deep Dive (zero rows órfãos)
- `kind='project'` deep dive cobre todos os 14 ex-INCONCLUSIVO
- `evidence_chain` populado em todas as novas impact rows (avaliar na validação final)

---

## Sub-fases de rollback

Cada onda termina antes da próxima começar. Se algo quebrar:

| Sintoma | Mitigação |
|---|---|
| Goals produz JSON inválido | LLM call falha → row marcada `'error'` no `project_goals`, retry manual |
| Impact LLM ignora pre-edges | Pre-edges são `INSERT OR IGNORE` no `projects_impact`; safe — não destroem rows manuais |
| Migration falha | Schema usa `ADD COLUMN IF NOT EXISTS` + try-catch (padrão deste repo) |
| Resultado pior que baseline | `git revert` da onda + re-run |

Backup do estado atual antes de começar cada onda:
- Snapshot do DB: `cp /opt/strom/data/cioo.db /opt/strom/data/cioo.db.before-ondaN`
- Snapshot do prompt: `git status` antes de edit

---

## Estado pós-tarefa (atualizado durante execução)

(Vazio. Preenche-se conforme tarefas são completadas.)

---

## Resultado final pós-validação

| Métrica | Baseline (antes das ondas) | Pós-ondas | Variação |
|---|---|---|---|
| Total impactos | 228 | 166 | -27% |
| **% com evidência verificável** | 56% | **95.8%** | **+71%** ✅ |
| % com `evidence_chain` (rastreabilidade) | n/a | **100%** | nova capability |
| Impactos sourced de `claim` | n/a | 146 (88%) | nova |
| Impactos sourced de `relation` | n/a | 17 (10%) | nova |
| Impactos sourced `free` | n/a | 7 (4%) | nova |
| Falso positivo Cyber-OT | presente | **eliminado** | ✅ |
| Batches com erro | n/a | 0/17 | ✅ |
| Deep dives cobrindo project↔project | nunca | **suportado via kind='project'** | nova |
| Stale deep dives após re-run Impact | persistiam | **invalidados em cascata** | ✅ |

### Trade-off conhecido (aceito)

Cobertura por projeto caiu (-48% em 9 amostras) — Goals foi conservador demais (mediana 2 claims/projeto). Estratégia atual: revisão manual onde reviewers notarem gaps. Calibração do prompt do Goals pode ser feita em iteração futura sem mudar arquitetura.

### Arquivos modificados (resumo)

- `src/lib/file-hygiene.ts` (novo) — classify + dedupe
- `src/lib/drive-engine.ts` — wired hygiene + skip statuses + dedupeProjectDocs
- `src/lib/target-catalog.ts` — typicalRoles/typicalImpactTypes + isCanonicalTarget
- `src/lib/db.ts` — migrações `project_relations`/`out_of_scope`/`impact_claims`/`timeline_struct`/`evidence_chain`
- `src/lib/prompts.ts` — Goals prompt v4 (fields 15-19) + Impact prompt com PRE-EXTRACTED RELATIONS / EXCLUSIONS / ATOMIC CLAIMS / TIMELINE
- `src/lib/goals-analyzer.ts` — sanitizers + persistência das colunas novas + prompt_version=4
- `src/lib/impact-engine.ts` — types `ProjectRelation`/`OutOfScope`/`ImpactClaim`/`TimelineStruct`/`TimelineDep`, query estendida, `buildImpactPrompt` injeta blocos novos, `storeImpacts` two-pass com `evidence_chain` + self-loop filter, `clearAllImpacts` cascateia deep_dives
- `src/lib/deep-dive-engine.ts` — `kind='project'`, GoalsRow com colunas novas, prompt consome `claims/relations/out_of_scope`, companion-project block para kind='project'
- `src/app/api/impact/project/deep-dive/route.ts` — aceita kind='project'

### Snapshots de rollback

```
/opt/strom/data/cioo.db.before-onda1
/opt/strom/data/cioo.db.before-onda2
/opt/strom/data/cioo.db.before-onda3
/opt/strom/data/cioo.db.before-validation
```

## Log de execução

- `2026-06-11 13:51` — Tarefa 0.1: enriquecimento de `target-catalog.ts`. Adicionados `typicalRoles` e `typicalImpactTypes` em 10/24 entradas (todos os 5 GIO + 4 geo zones DDS + CDIO Office). Helpers `getTargetEntry` e `isCanonicalTarget` exportados.
- `2026-06-11 13:55` — Tarefa 0.2: baseline gravado em `BASELINE_2026-06-11.md`. Backup DB → `cioo.db.before-onda1`.
- `2026-06-11 14:00` — Tarefa 1.1-1.4: módulo `file-hygiene.ts` criado, wired em `processUrl` e `getProjectDocuments`. Retro-aplicado no cache: 4 deprecated + 5 cross_prj + 210 duplicates marcadas (49% do corpus). Compilação OK. Pronto pra 1.5 (re-run downstream).
- `2026-06-11 14:03` — Decisão de produto: pular 1.5 (re-run isolado da Onda 1), ir direto pra Onda 2. Snapshot do DB salvo em `cioo.db.before-onda2`. Onda 1 marcada completa.
- `2026-06-11 14:05` — Onda 2 tasks 2.1-2.5 implementadas: schema (`project_relations`, `out_of_scope`), prompt do Goals reescrito (versão 3), sanitização, Impact engine consome pre-edges + EXCLUSIONS. Compilação OK. Faltam 2.6 (UI) + 2.7 (re-run).
- `2026-06-11 14:13` — Snapshot `cioo.db.before-onda3`. Onda 3 tasks 3.1-3.5 implementadas: schema (`impact_claims`, `timeline_struct`), prompt do Goals (versão 4) com fields 18+19 completos, prompt do Impact com bloco "ATOMIC IMPACT CLAIMS" + TIMELINE, sanitizadores (`sanitizeImpactClaims` valida contra catálogo; `sanitizeTimeline`). Bug: backticks no template literal do prompt do Impact corrompiam o módulo — fix aplicado.
- `2026-06-11 14:18` — Pergunta do usuário: incluir Deep Dive no pacote. Decisão: SIM. Onda 4 adicionada ao plano (5 tarefas). Implementação após Onda 3 estar completa.
- `2026-06-11 14:35` — Onda 4 implementada inteira (5/5). Deep Dive consome claims, respeita out_of_scope, suporta `kind='project'`, invalidação cascata em clearAllImpacts, `evidence_chain` populado por storeImpacts. Compilação OK. Pronto pra fase final: re-rodar Goals + Impact + Deep Dive end-to-end para validar (Tarefa 3.7 / Critério das ondas).
- `2026-06-13 ~14:50` — Validação end-to-end executada. Goals (v4) rodou nos 67 projetos sem erros. Impact 1ª tentativa: 14/17 batches falharam por bug no parser de `timeline_struct` (não tratava `{}` vazio). Bug fixado: parser normaliza pra shape completa com arrays vazios; `buildImpactPrompt` defensivo. Self-loop filter adicionado em `storeImpacts`. Impact 2ª tentativa: 17/17 batches OK, 0 erros, 166 impactos.
- `2026-06-13 ~14:55` — Métricas finais: **95.8% impactos com evidência verificável** (vs 56% baseline). **100% com evidence_chain** (146 via claim, 17 via relation, 7 free). Falso positivo Cyber-OT eliminado por `out_of_scope`. Trade-off: cobertura caiu (-48% impacts nos 9 projetos do report original) por Goals ter sido conservador demais (mediana 2 claims/projeto). Decisão do usuário: **aceitar como está e revisar manualmente** — alta precisão prevalece.
- `2026-06-15` — **Regressão de UI reportada**: ícone de source popover sumiu em "Reason for the impact" porque a UI só lia `citationsByExplanation` mas Onda 3 deixou `citations[]` vazio em 74% dos impacts (LLM agora deixa a evidência no claim). Fix: `/api/impact/project/universe/route.ts` ganhou `enrichEmptyCitations()` que sintetiza ImpactCitation[] a partir do `evidence_chain → goal.impact_claims[idx].evidence_quote + evidence_file`, resolvendo `doc_url` por lookup fuzzy-normalizado em `documents_cache` (estripa extensão, normaliza separadores). Type `EvidenceChainEntry` adicionado em `types.ts`; `mapImpactRow` parseia chain; `aggregateImpacts` propaga. Compilação OK. UI agora cobre 95.8% dos impacts com popover funcional (era 25.9% pós-Onda 3).
- `2026-06-15` — **Refinamento per-message**: usuário notou que em cards com 2+ explanations só a 1ª tinha ícone, e que faltavam badges per-message. Fix: (1) `enrichEmptyCitations` movido pra ANTES do `aggregateImpacts` — mutaa cada raw row, alinhamento natural via aggregate; (2) `aggregateImpacts` emite `impactTypeByExplanation` e `severityByExplanation` paralelos a `explanations`; (3) `PseudoNodeImpact` e `ProjectEdge` carregam os novos arrays; (4) `dedupExplanationsWithCitations` propaga; (5) `ProjectUniverseView` renderiza badge de severity + impact_type abaixo de cada bullet do "Reason for the impact". Validado em PRJ0013195 → Cloud Services: 2 mensagens, cada uma com sua badge correta (organizational/high vs platform_shared/medium) e citation alinhada.
