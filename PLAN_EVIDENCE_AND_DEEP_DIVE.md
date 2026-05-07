# Plano — Evidência + Deep Dive das Conexões de Impacto

## 1. Objetivo

Hoje, ao clicar num card grande da ImpactView (ou num edge/node da Universe View), o usuário vê apenas a `explanation` curta gerada pelo Gemini — 1 a 2 frases. Para validar de fato uma conexão (projeto ↔ GIO Service Line, projeto ↔ DDS Entity), o usuário precisa de:

- **A — Evidência estática**: dados brutos que o LLM usou pra inferir a conexão (campos do Goals Extractor, documents do Drive, metadata do projeto). Já está tudo em DB, só não está exposto.
- **B — Deep dive sob demanda**: uma análise detalhada gerada por LLM com **todo** o contexto do projeto, focada **especificamente** na conexão clicada (ex.: "por que esse projeto impacta DDS APAC?"). Cacheada no DB pra não re-cobrar.

Ambos vão aparecer em **dois lugares** (UI dupla):

- **(i) ImpactView** — botão "📋 Evidências" no big card → expande seção inline
- **(ii) Universe View** — painel direito enriquecido com as mesmas seções

---

## 2. O que já temos no DB (não precisa de novo Goals run)

Tabelas existentes:

| Tabela | Campos relevantes |
| ------ | ------ |
| `projects` | `name`, `dds`, `gate`, `decision`, `description`, `remarks`, `qa`, `cost_keur`, `review_date`, `link_folder`, `link_positions`, `link_cioo`, `participants`, `decision_mode` |
| `project_goals` | `digital_technologies`, `change_management`, `security_impacts`, `regional_impacts`, `ia_embedded`, `gio_sl_dds_impacts`, `dds_gio_workload`, `business_apps_cis`, `source_files`, `raw_gemini_response`, `analyzed_at`, `month_folder`, `region`, `gate` |
| `documents_cache` | `url`, `content_text`, `content_type`, `fetch_status`, `error_message`, `fetched_at` |
| `projects_impact` | `explanation`, `severity`, `direction`, `impact_type`, `gio_services`, `dds_entities`, `created_at`, `batch_id` |

**Nada novo precisa ser extraído**. A evidência estática é só uma agregação de campos já populados.

---

## 3. A — Evidência estática (Fase 1)

### 3.1 Novo endpoint

`GET /api/impact/project/evidence?projectId=PRJ0019343`

**Resposta**:

```ts
{
  project: {
    projectId: 'PRJ0019343',
    name: '...',
    dds: 'GIO',
    currentGate: '2',
    decision: 'Passed',
    description: '...',     // do CIOO sheet
    remarks: '...',          // do CIOO sheet
    qa: '...',
    costKEur: 850,
    reviewDate: '2025-09-12',
    decisionMode: 'Meeting',
    participants: '...',
    links: {
      folder: 'https://drive.google.com/...',
      positions: '...',
      cioo: '...',
    },
    history: [               // todas as gate reviews que existem
      { gate: '2', decision: 'Passed', reviewDate: '2025-09-12' },
      { gate: '1', decision: 'Passed', reviewDate: '2025-04-05' },
    ],
  },
  goals: {                    // campos do Goals Extractor (raw text que o LLM usou)
    digitalTechnologies: '...',
    changeManagement: '...',
    securityImpacts: '...',
    regionalImpacts: '...',
    iaEmbedded: '...',
    gioSlDdsImpacts: '...',
    ddsGioWorkload: '...',
    businessAppsCis: '...',
    region: 'Global',
    monthFolder: '2025-09',
    analyzedAt: '2026-04-12T...',
    sourceFiles: ['gate2_review.pdf', 'cf_report.docx', '...'],
    rawGeminiResponse: '...',  // se quiser inspecionar a resposta do LLM literal
  },
  documents: [                // até N docs do projeto, só metadata + excerpt
    {
      url: '...',
      filename: 'gate2_review.pdf',
      contentType: 'application/pdf',
      fetchStatus: 'success',
      excerpt: 'first 500 chars...',
      fullLength: 12450,
      fetchedAt: '...',
    },
    ...
  ],
  impacts: {                  // contexto de impacto pra esse projeto
    gio: ProjectImpact | null,   // a row aggregada pra GIO_SERVICES
    dds: ProjectImpact | null,   // a row aggregada pra DDS_IMPACTS
  },
}
```

### 3.2 Implementação

- Reutiliza `getDb()`, queries simples nas 4 tabelas
- Documents: usar SQL pra encontrar docs cujo `url` aparece em `projects.link_*` daquele projeto, ou via `data/drive/<projectId>/` (pasta local)
- `impacts.gio` / `impacts.dds`: usar `getProjectImpacts(projectId)` + filtro por `target IN ('GIO_SERVICES','DDS_IMPACTS')`
- Sem chamada LLM, ~50ms

### 3.3 UI no ImpactView

Adicionar botão pequeno no rodapé do card:

```
┌────────────────────────────────────────────┐
│ ● PRJ0019343  Wave 7 …            [high]   │
│ [Cloud Services] [Security & Compliance]   │
│ [AMEI] [APAC] [Americas]                   │
│ GIO  ...explanation curta...               │
│ DDS  ...explanation curta...               │
│                                            │
│ 📋 Ver evidências  ▾                       │  ← novo
└────────────────────────────────────────────┘
```

Click → expande inline um `<EvidencePanel>` mostrando:

1. **Metadata do projeto** (gate, decision, cost, dates, participants, links pra Drive)
2. **Goals Extractor** (8 campos em tabs ou accordion):
   - Digital Technologies
   - Regional Impacts (destacado se for impacto DDS)
   - GIO/SL/DDS Impacts (destacado pra GIO + DDS)
   - DDS/GIO Workload
   - Business Apps & CIs
   - Security Impacts
   - AI Embedded
   - Change Management
3. **Documents** (lista compacta, click → modal com excerpt completo)
4. **Description / Remarks** do CIOO
5. Botão **"🔬 Deep dive GIO"** e **"🔬 Deep dive DDS"** (acionam Fase B)

### 3.4 UI na Universe View

O painel direito atual já mostra a `explanation`. Vamos transformá-lo num painel scroll com seções:

```
┌──────────────────────────┐
│ DDS Entity · Americas    │
│ 3 impactos neste DDS     │
│                          │
│ [high] [reg.rollout] ... │
│                          │
│ ▸ Razão (Gemini)        │
│   ─ explanation 1        │
│   ─ explanation 2        │
│                          │
│ ▸ Evidência              │ ← novo (auto-fetch quando edge clicado)
│   • Goals: regional…     │
│   • Workload: 11 FTE…   │
│   • Docs: gate2.pdf, …  │
│   • Description: …       │
│                          │
│ [🔬 Deep dive]           │ ← novo
└──────────────────────────┘
```

Auto-fetch da evidência ao clicar no edge/node. Reusa o mesmo `<EvidencePanel>` da ImpactView (componente compartilhado).

---

## 4. B — Deep dive sob demanda (Fase 2)

### 4.1 Schema novo

```sql
CREATE TABLE impact_deep_dives (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,   -- 'gio' | 'dds'
  target        TEXT NOT NULL,   -- 'Cloud Services' | 'Americas' | etc
  response_md   TEXT NOT NULL,
  llm_provider  TEXT NOT NULL,
  llm_model     TEXT NOT NULL,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source_sig    TEXT NOT NULL,   -- hash dos source_files+goals (invalida cache se mudar)
  duration_ms   INTEGER,
  UNIQUE(project_id, kind, target)
);

CREATE INDEX idx_deep_dives_project ON impact_deep_dives(project_id);
```

### 4.2 Endpoint

`POST /api/impact/project/deep-dive`

Body:
```json
{ "projectId": "PRJ0019343", "kind": "dds", "target": "Americas" }
```

Fluxo:
1. Calcula `source_sig = sha256(goals.source_files + goals.analyzed_at)`
2. Busca cache: `SELECT * FROM impact_deep_dives WHERE project_id=? AND kind=? AND target=? AND source_sig=?`
3. Se hit → retorna cached
4. Se miss → constrói prompt → chama LLM → salva → retorna

### 4.3 Prompt do deep dive

```
Você é um analista IT do CIOO da Air Liquide. Analise por que o projeto abaixo
impacta especificamente {{TARGET}} ({{KIND}}). Forneça uma análise estruturada
em markdown, com no máximo 7 parágrafos curtos.

PROJETO:
- ID: {{PROJECT_ID}}
- Nome: {{NAME}}
- DDS dona: {{DDS}}
- Gate: {{GATE}} ({{DECISION}})
- Custo: {{COST}}k€
- Description: {{DESCRIPTION}}
- Remarks: {{REMARKS}}

CAMPOS DO GOALS EXTRACTOR (texto bruto):
- Digital Technologies: {{digital_technologies}}
- Regional Impacts: {{regional_impacts}}
- GIO/SL/DDS Impacts: {{gio_sl_dds_impacts}}
- DDS/GIO Workload: {{dds_gio_workload}}
- Business Apps & CIs: {{business_apps_cis}}
- Security Impacts: {{security_impacts}}
- Change Management: {{change_management}}
- IA Embedded: {{ia_embedded}}

DOCUMENTOS (excerpts):
{{DOC_EXCERPTS}}      ← até 6000 chars de docs reais

EXPLICAÇÃO RESUMIDA QUE JÁ ESTÁ NO SISTEMA (não repita, expanda):
{{EXISTING_EXPLANATION}}

INSTRUÇÕES DE FORMATO:
1. Responda em markdown.
2. Estruture em seções:
   - **Por que esse impacto existe** (1-2 parágrafos): a justificativa de fundo, citando trechos dos documentos quando possível.
   - **Touchpoints concretos** (lista bullet): o que esse projeto faz especificamente que toca {{TARGET}}.
   - **Carga de trabalho estimada**: FTE/dias se mencionado, ou "não especificado".
   - **Riscos / dependências**: o que precisa coordenar.
   - **Origem da inferência**: quais campos do Goals Extractor / quais documentos sustentam essa análise.
3. Cite trechos textuais entre aspas quando possível.
4. Se algum dado estiver ausente, diga "não documentado" ao invés de inventar.
```

### 4.4 UI

- Botão `🔬 Deep dive` no painel da Universe View (quando edge/node selecionado)
- Botão `🔬 Deep dive GIO` e `🔬 Deep dive DDS` dentro do `<EvidencePanel>` da ImpactView
- Click → spinner ~10-30s → renderiza markdown
- Subsequent clicks → cached, instantâneo

Loading state: skeleton + texto "Gerando análise detalhada com {{provider}}..."

Cache invalidation: se `source_files` mudar (re-analisar Goals), o `source_sig` muda e força nova chamada.

---

## 5. Componente novo: `<EvidencePanel>`

Compartilhado entre ImpactView card-expandido e Universe View side-panel.

```tsx
<EvidencePanel
  projectId="PRJ0019343"
  highlight="dds"          // ou 'gio' ou null — destaca o campo relevante
  target="Americas"        // se highlight = gio | dds, mostra botão deep-dive específico
  compact={false}          // true = vista enxuta pra side-panel; false = vista expandida pra card
/>
```

Internamente:
- Faz fetch único de `/api/impact/project/evidence?projectId=...`
- Renderiza accordion com seções (Goals, Documents, Metadata)
- Botões deep dive renderizam markdown via `react-markdown` (nova dependência leve)

Sub-componentes:
- `<EvidenceSection title onToggle>` — accordion pattern
- `<DocItem doc onClick>` — lista de docs com hover-excerpt
- `<DeepDiveButton onTrigger>` — handles call + loading + render

---

## 6. Faseamento

### Fase 1 — Static evidence (1 PR)
1. Endpoint `/api/impact/project/evidence`
2. Componente `<EvidencePanel>` reutilizável
3. Wire up no ImpactView card (botão expand inline)
4. Wire up na Universe View side panel
5. Testes: validar com 3 projetos (1 com muito texto, 1 com pouco, 1 sem goals)

**Validação**: clico em qualquer card → vejo todos os 8 campos do Goals Extractor + lista de docs + metadata sem chamada LLM, < 200ms.

### Fase 2 — Deep dive backend (1 PR)
1. Migration: `impact_deep_dives` table
2. Endpoint POST + cache logic + prompt builder
3. Source-sig hash function pra invalidação
4. Reuso do `generateContent` do `llm.ts` (já tem suporte deepseek/gemini)

**Validação**: chamar `curl -X POST .../deep-dive -d '{projectId, kind:"dds", target:"Americas"}'` retorna markdown estruturado em ~15s; segunda chamada retorna do cache em <50ms.

### Fase 3 — Deep dive UI (1 PR)
1. `<DeepDiveButton>` + render markdown
2. Adiciona em `<EvidencePanel>` (botões por kind/target)
3. Spinner + erro state
4. Talvez botão "Re-gerar" pra invalidar cache manualmente

**Validação**: na Universe, clico edge GIO Cloud → painel mostra evidência + botão deep dive → click → markdown renderiza com seções estruturadas.

---

## 7. Dependências novas

- `react-markdown` (~30KB gz) pra renderizar a resposta do deep dive

Sem outras deps.

---

## 8. Riscos / pontos de atenção

- **Latência do deep dive**: deepseek-chat vai levar 10-30s pra um prompt com goal completo + docs. UX precisa de spinner claro.
- **Custo**: cada deep dive ~5-15k tokens de input + ~2k de output. Com 25 projetos × 2 kinds × ~3 targets em média = ~150 deep dives possíveis = ~$0.30 com deepseek (orçamento ok).
- **Cache invalidation**: se a análise de Goals re-rodar com files novos, o `source_sig` muda automaticamente — o usuário verá uma análise nova na próxima abertura. Comportamento desejado.
- **Tamanho do contexto**: alguns docs têm 50k+ chars. Já temos lógica em `impact-engine.ts` que corta a 4000 chars por doc + 8000 total. Reutilizar.
- **Dois lugares mostram a mesma coisa**: usar `<EvidencePanel>` compartilhado evita drift.

---

## 9. Ordem de execução proposta

1. Fase 1 (static) — entrega valor imediato em ~1 hora de trabalho
2. Fase 2 (deep dive backend) — ~1 hora
3. Fase 3 (deep dive UI) — ~30 min

Total: ~2.5 horas. Posso começar pela Fase 1 e te entregar pra validar antes de seguir.

Confirma esse plano e a ordem? Algum campo do Goals que eu listei que você quer **destaque visual** maior (em negrito, seção separada)? Ou quer que eu ajuste o prompt do deep dive em algum ponto?
