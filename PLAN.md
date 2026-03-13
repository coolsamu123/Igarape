# CIOO Project Intelligence — Industrialization Plan

## Overview

Transform the `al-project-intelligence.jsx` prototype into a production-ready web application that reads real CIOO project data from the Excel tracking spreadsheet and uses Google Gemini API to analyze intersections between projects.

## Data Source Mapping

### Excel Structure (`0_CIOO Forecast` sheet — 1166 projects)

| Excel Column | Field | Prototype Equivalent | Notes |
|---|---|---|---|
| A — GCIOO Date | `reviewDate` | *(new)* | Excel serial number → Date |
| B — DDS | `dds` (division) | `domain` | AMEI, APAC, Americas, CF, E&C, EU, GIO, GM&T, HC D&IT, IDD, Digital, etc. |
| C — Project # in ServiceNow | `projectId` | `id` | e.g. PRJ0004517 |
| D — Project Name | `name` | `name` | |
| E — Gate | `gate` | `phase` | 0, 1, 1 MVP, 2, 3, 4, MVP Closure, MVP Interm., Contract note, OverRun |
| F — Project cost k€ | `costKEur` | `budget` | Some have "$" prefix, needs parsing |
| G — Documents | `documentsStatus` | *(new)* | 1-Expected, 2-Received, 3-Complete, 4-Shared, 0-On Hold |
| H — Diffusion restricted | `restricted` | *(new)* | Y/N |
| I — Remarks | `remarks` | *(new — used by Gemini)* | Free text, critical for AI analysis |
| J — Q&A | `qa` | *(new)* | |
| K — Short description | `description` | `description` | Core field for AI intersection |
| L — Cost before Gate 2 | `costBeforeGate2` | *(new)* | |
| M — Est. Gate 2 date | `estGate2Date` | *(new)* | |
| N — Review Status | `reviewStatus` | *(new)* | 1.To be confirmed → 6.Min. published |
| O — Decision mode | `decisionMode` | *(new)* | Meeting / Off-line |
| P — Date | `decisionDate` | *(new)* | |
| Q — Début | `sessionStart` | `start` (repurposed) | Time of review session |
| R — Fin | `sessionEnd` | `end` (repurposed) | Time of review session |
| S — Decision | `decision` | *(new)* | Passed, Not Passed, On Hold, Delegated |
| T — Participants | `participants` | `responsible` (derived) | |
| U — Link to GCIOO Positions | `linkPositions` | *(new — used by Gemini)* | Google Drive URL |
| V — HyperLink to folder | `linkFolder` | *(new — used by Gemini)* | Google Drive URL |
| W — HyperLink to CIOO positions | `linkCIOOPositions` | *(new — used by Gemini)* | Google Drive URL |
| X — Année | `year` | *(derived)* | |
| Y — Mois | `month` | *(derived)* | |

### Additional Sheets Used
- **Lists** (sheet 8): Dropdown values for DDS, Gates, Document status, Review status, Decision
- **Links** (sheet 3): Reference links (CIOO guidelines, portfolio in ServiceNow, calendars)

---

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20+ LTS |
| Framework | Next.js (App Router) | 14+ |
| Language | TypeScript | 5+ |
| Excel Parsing | SheetJS (`xlsx`) | Latest |
| AI Engine | `@google/generative-ai` | Latest (Gemini 2.0 Flash) |
| Styling | Tailwind CSS | 3+ |
| Visualization | Custom SVG + Recharts | — |
| Database | SQLite via `better-sqlite3` | Latest |
| State | React Context + hooks | — |
| Deployment | Windows local / Vercel | — |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser (React)                    │
│  ┌──────────┬──────────┬──────────┬───────────────┐  │
│  │  Graph   │  Matrix  │ Timeline │   Details/AI  │  │
│  │  View    │  View    │  View    │   Analysis    │  │
│  └────┬─────┴────┬─────┴────┬─────┴───────┬───────┘  │
│       └──────────┴──────────┴─────────────┘          │
│                    ProjectContext                     │
└───────────────────────┬──────────────────────────────┘
                        │ API calls
┌───────────────────────┼──────────────────────────────┐
│              Next.js API Routes                       │
│  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │ /api/projects   │  │ /api/analyze             │   │
│  │ Upload + Parse  │  │ Gemini intersection      │   │
│  │ Store in SQLite │  │ analysis                 │   │
│  └────────┬────────┘  └──────────┬───────────────┘   │
│           │                      │                    │
│     ┌─────┴─────┐          ┌─────┴──────┐            │
│     │ xlsx lib  │          │ Gemini API │            │
│     │ SQLite DB │          │ + Web Fetch│            │
│     └───────────┘          └────────────┘            │
└───────────────────────────────────────────────────────┘
```

## Storage Layer — SQLite

All data is stored in a single SQLite file (`data/cioo.db`) using `better-sqlite3`.

### Tables

```sql
-- Parsed project data from Excel
CREATE TABLE projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,          -- ServiceNow # (PRJ0004517)
  name            TEXT NOT NULL,
  dds             TEXT,                   -- Division (AMEI, APAC, CF, etc.)
  gate            TEXT,                   -- 0, 1, 1 MVP, 2, 3, 4, etc.
  cost_keur       REAL,                   -- Project cost in k€
  description     TEXT,                   -- Short description
  remarks         TEXT,                   -- Remarks (rich context for AI)
  qa              TEXT,                   -- Q&A notes
  review_date     TEXT,                   -- GCIOO Date (ISO format)
  decision        TEXT,                   -- Passed, Not Passed, On Hold, Delegated
  decision_mode   TEXT,                   -- Meeting / Off-line
  decision_date   TEXT,
  review_status   TEXT,                   -- 1.To be confirmed → 6.Min. published
  documents_status TEXT,                  -- 1-Expected → 4-Shared
  restricted      TEXT,                   -- Y/N
  cost_before_g2  REAL,
  est_gate2_date  TEXT,
  session_start   TEXT,                   -- Début
  session_end     TEXT,                   -- Fin
  participants    TEXT,
  link_positions  TEXT,                   -- Google Drive URL
  link_folder     TEXT,                   -- Google Drive URL
  link_cioo       TEXT,                   -- Google Drive URL
  year            INTEGER,
  month           INTEGER,
  uploaded_at     TEXT DEFAULT (datetime('now')),
  batch_id        TEXT                    -- Groups rows from same upload
);

CREATE INDEX idx_projects_project_id ON projects(project_id);
CREATE INDEX idx_projects_dds ON projects(dds);
CREATE INDEX idx_projects_gate ON projects(gate);
CREATE INDEX idx_projects_decision ON projects(decision);
CREATE INDEX idx_projects_batch ON projects(batch_id);

-- Gemini analysis results (cached)
CREATE TABLE analysis_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_type   TEXT NOT NULL,          -- 'pairwise' | 'cluster' | 'document'
  project_ids     TEXT NOT NULL,          -- JSON array of project_ids involved
  prompt_hash     TEXT NOT NULL,          -- SHA256 of prompt (dedup)
  request_prompt  TEXT,                   -- Full prompt sent to Gemini
  response_json   TEXT,                   -- Gemini structured response
  similarity_score REAL,                  -- AI-computed similarity (0-1)
  created_at      TEXT DEFAULT (datetime('now')),
  model_used      TEXT DEFAULT 'gemini-2.0-flash'
);

CREATE UNIQUE INDEX idx_analysis_hash ON analysis_cache(prompt_hash);
CREATE INDEX idx_analysis_projects ON analysis_cache(project_ids);

-- Fetched document content from Google Drive links
CREATE TABLE documents_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL UNIQUE,
  content_text    TEXT,                   -- Extracted text content
  content_type    TEXT,                   -- PDF, DOCX, Slides, etc.
  fetch_status    TEXT,                   -- 'success' | 'error' | 'access_denied'
  error_message   TEXT,
  fetched_at      TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_documents_url ON documents_cache(url);
```

### Storage Strategy

- **Excel upload** → parse → INSERT into `projects` table with a `batch_id`
- **Re-upload** → new batch replaces old data (old batches kept for history)
- **Gemini results** → cached by `prompt_hash` — never re-analyzed unless user forces
- **Document content** → fetched once, cached indefinitely
- **Backup**: copy `data/cioo.db` (single file, portable)

---

## Tasks

### Phase 1: Project Setup & Data Layer

- [ ] **T1.1** Initialize Next.js project with TypeScript, Tailwind CSS
- [ ] **T1.2** Define TypeScript types/interfaces for the CIOO project data model
- [ ] **T1.3** Build Excel parser (`/api/projects/upload`) — parse `0_CIOO Forecast` sheet
  - Handle Excel serial date conversion
  - Parse cost field (handle `$19k`, `306.0`, etc.)
  - Map DDS, Gate, Decision to clean enums
  - Extract hyperlinks from columns U, V, W
- [ ] **T1.4** Build file upload UI component (drag & drop `.xlsx`)
- [ ] **T1.5** Create ProjectContext provider with state management
- [ ] **T1.6** Add data persistence (localStorage or file-based cache)

### Phase 2: Core Views (Adapted from Prototype)

- [ ] **T2.1** Adapt **Graph View** — force-directed network
  - Replace domain colors with DDS colors (21 divisions)
  - Node size based on project cost
  - Gate as phase badge
  - Decision status indicator (Passed=green, On Hold=yellow, Not Passed=red)
- [ ] **T2.2** Adapt **Matrix View** — intersection heatmap
  - Initial similarity: keyword overlap in description + remarks + same DDS
  - Highlight Gemini-analyzed pairs differently
- [ ] **T2.3** Adapt **Timeline View**
  - Use GCIOO review dates (column A) as timeline axis
  - Group by DDS instead of phase
  - Show Gate progression over time for same project (multiple rows = gate reviews)
  - Mark today's date dynamically
- [ ] **T2.4** Adapt **Detail View** — project cards
  - Show all real fields: Gate, DDS, Decision, Cost, Description, Remarks
  - Show document links (columns U, V, W) as clickable buttons
  - Show review history (same project across multiple rows)
- [ ] **T2.5** Update **Sidebar KPIs**
  - Projects by DDS, by Gate, by Decision
  - Total portfolio cost
  - Document readiness distribution

### Phase 3: Gemini AI Integration

- [ ] **T3.1** Create `/api/analyze` endpoint
  - Accept project pair or project group
  - Build prompt with: descriptions, remarks, DDS, gate, cost, decision
  - Return structured JSON: themes, risks, synergies, recommendations
- [ ] **T3.2** Create `/api/analyze/document` endpoint
  - Fetch Google Drive document content from links (U, V, W)
  - Pass document text to Gemini for deeper analysis
  - Handle Google Drive access (public links, or API key)
- [ ] **T3.3** Build **AI Analysis Panel** in UI
  - "Analyze Intersection" button on project pairs
  - "Analyze Portfolio Cluster" for groups of related projects
  - Display Gemini response with structured formatting
  - Cache results to avoid repeated API calls
- [ ] **T3.4** Enhance similarity computation
  - Base similarity: tag/keyword overlap (existing logic)
  - AI-enhanced similarity: Gemini scores stored and blended
  - Visual indicator for AI-analyzed vs computed-only pairs
- [ ] **T3.5** Build **Batch Analysis** feature
  - Analyze all project pairs within same DDS
  - Analyze cross-DDS intersections above threshold
  - Generate portfolio-wide insight report

### Phase 4: Advanced Features

- [ ] **T4.1** Multi-row project tracking
  - Same project (ServiceNow #) appears multiple times at different gates
  - Build project history/lifecycle view
- [ ] **T4.2** Filters & Search
  - Full-text search across name, description, remarks
  - Filter by: DDS, Gate, Decision, Year, Cost range
  - Date range picker for GCIOO review dates
- [ ] **T4.3** Export capabilities
  - Export analysis results as PDF/Excel
  - Export graph as SVG/PNG
- [ ] **T4.4** Settings page
  - Gemini API key configuration
  - Similarity threshold defaults
  - Color scheme customization

### Phase 5: Polish & Deployment

- [ ] **T5.1** Responsive design for different screen sizes
- [ ] **T5.2** Loading states, error handling, empty states
- [ ] **T5.3** Windows batch script for easy startup (`start.bat`)
- [ ] **T5.4** README with setup instructions
- [ ] **T5.5** Performance optimization for 1166+ projects in graph view

---

## Key Adaptation Decisions

### 1. Project Identity
The prototype uses simple IDs (P001). Real data uses ServiceNow numbers (PRJ0004517). Same project can appear multiple times (different gate reviews). We group by ServiceNow # and show the latest gate as current status.

### 2. Similarity Computation
**Prototype**: Jaccard on hardcoded tags + domain/responsible match.
**Production**:
- NLP keyword extraction from description + remarks (no manual tags)
- DDS match bonus
- Same project family detection (similar names)
- Gemini deep analysis on demand

### 3. Timeline
**Prototype**: Start/end dates per project.
**Production**: GCIOO review dates — timeline shows when projects were reviewed, at which gate, with what decision. This is a governance timeline, not a project execution timeline.

### 4. Document Links
Columns U, V, W contain Google Drive links. The app will:
1. Display them as clickable links in the detail view
2. On "Analyze" action, fetch document content and send to Gemini
3. Handle cases where links are broken or access-restricted

### 5. Dates
Excel stores dates as serial numbers (days since 1900-01-01). Column A (GCIOO Date) needs conversion. Column M (Est. Gate 2 date) can be date or text ("ASAP"). Columns Q/R (Début/Fin) are session times, not project dates.

---

## Gemini Prompts Strategy

### Pairwise Intersection Analysis
```
Analyze the intersection between these two IT projects:

Project A: {name} (DDS: {dds}, Gate: {gate}, Cost: {cost}k€)
Description: {description}
Remarks: {remarks}

Project B: {name} (DDS: {dds}, Gate: {gate}, Cost: {cost}k€)
Description: {description}
Remarks: {remarks}

Identify:
1. Thematic overlaps (technology, business domain, infrastructure)
2. Potential synergies (shared resources, common platforms, cost optimization)
3. Risks (dependency conflicts, resource contention, timeline clashes)
4. Recommendations for coordination

Return JSON: { themes: string[], synergies: string[], risks: string[], recommendations: string[], similarityScore: number }
```

### Document-Enhanced Analysis
```
Based on the project documentation below, provide a deeper intersection analysis...
[Document content from Google Drive links]
```

### Portfolio Cluster Analysis
```
Analyze this cluster of {n} related IT projects within {dds} division...
[All project descriptions and remarks]
Identify common threads, redundancies, and portfolio optimization opportunities.
```

---

## File Structure

```
/home/samuel/Igarape/
├── PLAN.md                          ← This file
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
├── .env.local                       ← GEMINI_API_KEY
├── start.bat                        ← Windows launcher
├── public/
│   └── favicon.ico
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 ← Main dashboard
│   │   ├── globals.css
│   │   └── api/
│   │       ├── projects/
│   │       │   ├── route.ts         ← GET projects from SQLite
│   │       │   └── upload/route.ts  ← Parse Excel → SQLite
│   │       └── analyze/
│   │           ├── route.ts         ← Gemini intersection analysis
│   │           └── document/route.ts← Gemini document analysis
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Toolbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── GraphView.tsx
│   │   ├── MatrixView.tsx
│   │   ├── TimelineView.tsx
│   │   ├── DetailView.tsx
│   │   ├── AIAnalysisPanel.tsx
│   │   ├── FileUpload.tsx
│   │   └── ProjectCard.tsx
│   ├── context/
│   │   └── ProjectContext.tsx
│   ├── lib/
│   │   ├── types.ts                 ← TypeScript interfaces
│   │   ├── db.ts                    ← SQLite connection + schema init
│   │   ├── excel-parser.ts          ← xlsx parsing logic
│   │   ├── similarity.ts            ← Similarity computation
│   │   ├── gemini.ts                ← Gemini API client
│   │   ├── date-utils.ts            ← Excel date conversion
│   │   └── constants.ts             ← DDS colors, gate order, etc.
│   └── hooks/
│       ├── useForceLayout.ts
│       └── useProjects.ts
└── data/
    ├── cioo.db                      ← SQLite database (auto-created)
    ├── uploads/                     ← Original .xlsx files kept as backup
    └── .gitkeep
```

---

## Execution Order

1. **Start with T1.1–T1.3**: Get the project scaffold and data parsing working
2. **T1.4–T1.5**: Upload UI and state management
3. **T2.1–T2.5**: Port all four views with real data
4. **T3.1–T3.5**: Gemini integration (the differentiating feature)
5. **T4.1–T4.4**: Advanced features
6. **T5.1–T5.5**: Polish and deployment

Estimated: ~15-20 files to create, prototype provides 70% of the UI logic.
