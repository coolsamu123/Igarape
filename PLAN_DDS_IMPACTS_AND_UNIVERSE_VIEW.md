# Plano — DDS Impacts + "Project Universe" View

## 1. Objetivo (resumo do pedido)

Hoje a aplicação tem uma análise de impacto que sub-divide os impactos GIO por **Service Line** (Cloud Services, Security & Compliance, etc.) através de um pseudo-projeto `GIO_SERVICES` com array `gio_services`. Queremos:

1. **Mesma mecânica para DDS** — cada projeto deve receber também um conjunto de impactos sobre as DDS / entidades (CF, APAC, Europe, AMEI, Americas, …), com `severity`, `direction` e `explanation` por DDS.
2. **Card de projeto clicável** — ao clicar num card (na ImpactView, MatrixView ou GraphView), abre uma tela dedicada chamada **Project Universe**.
3. **Project Universe** — visualização gráfica dinâmica e bonita: o projeto fica no centro, rodeado por nós das Service Lines GIO e nós das DDS impactadas; clicar numa aresta projeto↔GIO_X ou projeto↔DDS_Y mostra a explicação (a "razão") gerada pelo Gemini.

## 2. O que **eu já tenho** (não precisa input do usuário)

| Fonte                           | Cobertura para DDS                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `projects.dds`                  | DDS "dona" do projeto (24 valores distintos: Americas, CF, GIO, HC D&IT, APAC, EU, Europe, AMEI, …)       |
| `project_goals.regional_impacts`| Texto livre do Gemini descrevendo regiões/zonas afetadas                                                  |
| `project_goals.gio_sl_dds_impacts` | Texto livre do Gemini cobrindo conjuntamente GIO Service Lines **e** DDS impactadas                    |
| `project_goals.dds_gio_workload`| Estimativa de carga/FTE em DDS/GIO                                                                        |
| `project_goals.region`          | Região alta (Global, Europe, Americas, APAC…)                                                             |

➡️ **Os textos brutos para gerar a análise DDS já existem.** Não precisamos de novo passo de Goals Extractor; basta atualizar o **Impact prompt** para emitir explicitamente arestas DDS, e adicionar uma coluna no DB.

## 3. O que **eu preciso confirmar com você** antes de implementar

1. **Catálogo de DDS canônico.** No DB existem 24 valores, com duplicações (`EU` vs `Europe`, possivelmente `Indutrial Apps` é typo de `Industrial Apps`). Proponho um catálogo fixo baseado nos top entities, com mapping de aliases. Exemplo:

   ```ts
   const DDS_CATALOG = [
     'Americas', 'CF', 'APAC', 'Europe',  // top 4 zonas
     'AMEI', 'GM&T', 'E&C', 'HC D&IT',    // outras zonas/divisões
     'Alizent', 'GDO', 'SEPPIC', 'Airgas', 'HHC',
     'Industrial Apps', 'Enterprise Apps', 'Data & AI Apps',
     'Digital Factory', 'InnoTech', 'CDIO Office', 'IDD',
   ];
   const DDS_ALIASES: Record<string,string> = {
     'EU': 'Europe',
     'Indutrial Apps': 'Industrial Apps',
     'Entreprise Apps': 'Enterprise Apps',
     'Digital': 'Digital Factory',
     'Digital & AI': 'Data & AI Apps',
   };
   ```

   **Pergunta:** confirma essa lista? Quer adicionar/remover algum? Quer que `GIO` apareça também como DDS (hoje aparece em `projects.dds` em 192 linhas) ou continua isolado como pseudo-projeto separado?

2. **Granularidade DDS.** GIO tem 5 sub-Service-Lines. As DDS são entidades **planas** (sem sub-divisão), correto? Se cada DDS tiver Service Lines internas, me diga o catálogo e a estrutura espelha GIO.

3. **Re-análise.** Para popular as novas arestas DDS, o jeito mais simples é rodar o "Start Full Analysis" de novo com o prompt atualizado. Tudo bem **apagar os impactos atuais** e re-rodar? Ou prefere uma migração que **mantém** GIO_SERVICES atuais e só acrescenta DDS_IMPACTS (custaria 2 chamadas LLM por batch — caro)?

4. **Stack de visualização da Project Universe.** Hoje o GraphView usa SVG + um hook custom `useForceLayout` (sem libs externas). Para a Universe view (radial, animada, com clique em arestas) tenho 2 opções:
   - **(a)** Continuar custom (SVG + Framer Motion para animações). Mais leve, mais trabalho, total controle visual.
   - **(b)** Adicionar `reactflow` (~80KB gz). Mais rápido pra entregar, layout/zoom/pan/click prontos, fica visualmente moderno por padrão.

   **Recomendo (b)** pelo critério "super dinâmico e belo" e pelo tempo de entrega. Confirma?

## 4. Arquitetura proposta

### 4.1 Modelo de dados

Migration aditiva no `projects_impact`:

```sql
ALTER TABLE projects_impact ADD COLUMN dds_entities TEXT DEFAULT '[]';
```

Pseudo-target novo: `DDS_IMPACTS` (espelha `GIO_SERVICES`). Cada linha com `target='DDS_IMPACTS'` tem `dds_entities` = JSON array dos códigos DDS afetados (ex.: `["CF","APAC"]`).

Exemplo de impacto após análise:

```json
{
  "source": "PRJ0004517",
  "target": "DDS_IMPACTS",
  "impact_type": "regional_rollout",
  "direction": "requires_coordination",
  "severity": "high",
  "explanation": "O rollout fase 2 cobre Americas e APAC, exige coordenação local de change management.",
  "dds_entities": ["Americas", "APAC"]
}
```

### 4.2 Engine (`src/lib/impact-engine.ts`)

- **Prompt update** (`src/lib/prompts.ts → DEFAULT_IMPACT_PROMPT`): adiciona seção **"CRITICAL — DDS DEPENDENCY"** análoga à de GIO. Lista o catálogo DDS, instrui o Gemini a emitir uma linha `target=DDS_IMPACTS` com `dds_entities` para cada projeto que tem impacto regional/organizacional. Adiciona um novo `impact_type`: `regional_rollout`, e mantém os existentes.
- **Parser** (`parseImpactResponse`): aceita campo `dds_entities` opcional, aplica normalização via `DDS_ALIASES`.
- **storeImpacts**: novo binding pra coluna `dds_entities`.
- **aggregateImpacts**: além de `gioServices`, agora une `ddsEntities` por par de projetos.

### 4.3 Tipos (`src/lib/types.ts`)

```ts
export interface ProjectImpact {
  // ...existentes...
  ddsEntities?: string[];   // NEW
}
```

Adiciona `ViewType = ... | 'universe'` (ou reutiliza um modal sobre a view atual — ver §4.5).

### 4.4 ImpactView — extensão

- Novo filtro **"All DDS"** (dropdown) ao lado do filtro GIO.
- Cards passam a mostrar badges DDS roxas/laranjas analogamente às GIO.
- Card vira **clicável** (`onClick → setFocusedProject(projectId); setView('universe')`).

### 4.5 Project Universe View — nova tela

**Componente:** `src/components/ProjectUniverseView.tsx`

**Layout (radial, react-flow):**

```
                ┌──────────────┐
        ┌───── │ GIO: Cloud   │ ─────┐
        │       └──────────────┘      │
        │                             │
  ┌───────────────┐            ┌──────────────┐
  │ DDS: Americas │ ─── ?? ─── │   PROJETO    │ ─── ?? ─── ┌───────────────┐
  └───────────────┘            │  PRJ0004517  │             │ DDS: APAC     │
                               │   "Move..."  │             └───────────────┘
                               └──────────────┘
        │                                                          │
        └──── GIO: Security ────────── GIO: User Workplace ────────┘
```

- **Centro:** node grande do projeto com nome, DDS dona, gate, custo.
- **Ring exterior:** todos os GIO Service Lines impactados (cor: roxo) + todas as DDS impactadas (cor: por DDS, igual `getDDSColor`).
- **Arestas:** cor por severity (high=vermelho, medium=âmbar, low=cinza), espessura por count.
- **Hover na aresta:** highlight + label curto (impact_type).
- **Click na aresta:** abre side panel à direita com:
  - Source/Target
  - Severity, direction, type(s)
  - **Explicação completa** (campo `explanation` da `projects_impact`)
  - Se houver múltiplas explanations agregadas → lista delas
  - Lista de outros projetos relacionados ao mesmo nó (ex. clicou em "GIO Cloud" → mostra outros projetos que tocam Cloud)

**Animações** (Framer Motion ou animações nativas do react-flow): entrada com fade+scale, edges desenhando-se com `stroke-dashoffset`, hover com glow.

**Header da tela:** breadcrumb "← Voltar para Impact" + nome do projeto.

### 4.6 Navegação

Opção mais limpa: nova `ViewType = 'universe'` e estado `focusedProjectId` no `ProjectContext`. Funções:

```ts
openUniverse(projectId: string): void  // setFocusedProjectId + setView('universe')
closeUniverse(): void                  // setView(prev) + clear focus
```

Não vai pro Header (não é uma view "permanente" no menu). Só acessível via clique em card.

### 4.7 API

- `GET /api/impact/project?id=PRJ...` → já existe (`getProjectImpacts`). Confirmar que devolve `ddsEntities` após migration. Adicionar ao mapeamento.
- (Opcional) `GET /api/impact/project/universe?id=PRJ...` → variante que já devolve impactos agrupados por target (GIO services / DDS entities) prontos pra renderizar como nodes do grafo. Faz mais sentido e simplifica o frontend.

## 5. Faseamento (entregas pequenas e testáveis)

### Fase 1 — Backend DDS impacts (1 PR)
1. Catálogo DDS: novo arquivo `src/lib/dds-catalog.ts` com lista + aliases + função `normalizeDds(s)`.
2. Migration de schema (ALTER TABLE no `initSchema`).
3. Atualizar `DEFAULT_IMPACT_PROMPT` com seção DDS.
4. Atualizar parser/store/aggregate/`mapImpactRow` para `dds_entities`.
5. Atualizar tipo `ProjectImpact`.

**Validação:** rodar Full Analysis num batch pequeno (1 batch). Inspeção SQL: `SELECT * FROM projects_impact WHERE target_project_id='DDS_IMPACTS' LIMIT 5` deve retornar linhas com `dds_entities` populado.

### Fase 2 — ImpactView atualizada (1 PR)
1. Filtro "All DDS" no toolbar.
2. Badges DDS nos cards.
3. Card clicável (placeholder navegação).

**Validação:** filtro funciona, badges aparecem, click loga `projectId`.

### Fase 3 — Project Universe View (1 PR)
1. Adicionar dependência `reactflow` (se confirmado).
2. Endpoint `/api/impact/project/universe?id=...` que retorna `{ project, gioNodes[], ddsNodes[], edges[] }`.
3. Componente `ProjectUniverseView.tsx` com layout radial + side panel.
4. Estado `focusedProjectId` e `ViewType='universe'`.
5. Wiring do click no card → openUniverse.

**Validação:** abre Universe, mostra projeto + nodes corretos, clique em aresta abre painel com explicação.

### Fase 4 — Polimento (1 PR)
1. Animações de entrada (Framer Motion ou CSS transitions).
2. Edges com hover glow, severidade colorida, espessura por count.
3. Cards clicáveis também em MatrixView e GraphView.
4. Breadcrumb e botão "voltar".

## 6. Riscos / pontos de atenção

- **Custo LLM:** rodar Full Analysis novamente custa $X (depende de quantos batches). Re-run com prompt novo = todo o orçamento. Se preferir, Fase 1 pode incluir uma flag pra rodar **só** os impactos DDS (mantendo os GIO existentes), mas isso exige bypass da `INSERT OR REPLACE` atual e provavelmente um run paralelo separado. Mais código, ~metade do custo.
- **Normalização de DDS:** projetos com DDS "EU" vs "Europe" precisam ser mergeados, senão a Universe view vai ter 2 nodes pra mesma entidade. A normalização tem que ser aplicada **na entrada do prompt** (passar nome canônico) e **na exibição** (qualquer aliases na DB).
- **Performance Universe:** se um projeto tem 30+ arestas, a visualização fica congestionada. Vale agrupar por categoria (cluster GIO, cluster DDS) e/ou paginar.
- **Mobile/responsive:** react-flow tem touch support OK, mas tela vai ficar apertada. Foco em desktop primeiro.

## 7. Decisão pendente — me responde por favor

**Para destravar a Fase 1:**

1. Catálogo DDS (§3.1) — confirma lista e aliases?
2. DDS são planas ou têm sub-Service-Lines como GIO? (§3.2)
3. Re-rodar tudo (apagar impactos atuais) ou rodar paralelo (caro)? (§3.3)

**Para destravar a Fase 3:**

4. Stack: react-flow (recomendo) ou continuar SVG custom? (§3.4)

Com essas 4 respostas eu começo direto pela Fase 1.
