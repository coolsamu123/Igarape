# Strom — Portfolio Intelligence

**An AI-powered IT portfolio analytics platform for Air Liquide's CDIOO (Chief Digital & Information Operations Officer) governance process.**

---

## What It Does

Strom is an internal tool that ingests, enriches, and visualizes the full lifecycle of IT projects reviewed by Air Liquide's CDIOO committee. It combines structured data (Excel exports, Google Sheets) with unstructured documents (Google Drive folders) and uses **Google Gemini 2.0 Flash** to extract governance insights and identify cross-project impact relationships at scale.

The platform answers questions like:
- Which projects share infrastructure, vendors, or technology dependencies?
- What is the security, regional, or organizational impact of a project?
- Which GIO services are affected by a given project?
- Where are timeline-blocking or resource-contention risks across the portfolio?

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js 14 Frontend                      │
│  8 views: Graph · Matrix · Timeline · Details · Impact      │
│           Goals Extractor · Drive Sync · ArchFlow           │
├─────────────────────────────────────────────────────────────┤
│                    Next.js API Routes                       │
│  /api/projects · /api/impact · /api/goals · /api/drive      │
│  /api/analyze · /api/prompts · /api/admin · /api/services   │
├─────────────────────────────────────────────────────────────┤
│                    Engine Layer                              │
│  impact-engine · goals-analyzer · drive-engine               │
│  similarity · gemini · excel-parser · sheets-engine          │
├──────────────┬──────────────────────────────────────────────┤
│   SQLite DB  │         Google Gemini 2.0 Flash              │
│  (cioo.db)   │  (impact analysis, goals extraction)         │
└──────────────┴──────────────────────────────────────────────┘
```

**Stack:** Next.js 14, React 18, TypeScript, TailwindCSS, SQLite (better-sqlite3), Google Generative AI SDK, Google Drive API, Google Sheets API.

---

## Core Data Pipeline

The platform operates a **3-step enrichment pipeline**:

### Step 1 — Drive Sync
- Extracts Google Drive folder links from project records
- Downloads all files (PDFs, DOCX, spreadsheets, presentations) and converts them to plain text
- Caches document content in the `documents_cache` table
- Supports bulk sync or single-project downloads

### Step 2 — Goals Extraction (Gemini AI)
- For each project, sends its downloaded documents to Gemini
- Extracts **8 governance fields**:
  - Digital Technologies
  - Change Management
  - Security Impacts
  - Regional Impacts
  - AI Embedded
  - GIO SL / DDS Impacts
  - DDS / GIO Workload
  - Business Apps & CIs
- Results stored in `project_goals` table

### Step 3 — Impact Analysis (Gemini AI)
- Groups projects into batches (~22 per batch), first by DDS (division), then cross-DDS
- Gemini identifies directional impact relationships between projects
- Each impact has: **type** (technology, infrastructure, data, timeline, resource, organizational, platform, vendor, integration, security), **direction** (blocks, enables, shares_resource, feeds_data, competes_with, requires_coordination), **severity** (high, medium, low), and **GIO services** affected
- Results stored in `projects_impact` table

---

## Data Sources

| Source | What It Provides | How It's Ingested |
|--------|-----------------|-------------------|
| **Excel upload** | Historical CIOO review data (project metadata, gates, decisions, costs, dates) | Admin page → `excel-parser.ts` → `projects` table |
| **Google Sheets** | Live CDIOO review spreadsheet (current period reviews) | Drive Sync tab → `sheets-engine.ts` → `drive_sheet_rows` + auto-sync to `projects` table |
| **Google Drive** | Project documentation (PDFs, DOCX, presentations) | Drive Sync → `drive-engine.ts` → `documents_cache` table |
| **Gemini AI** | Governance field extraction + impact relationships | Goals Extractor + Impact Analysis → `project_goals` + `projects_impact` tables |

---

## Views

### Graph
Force-directed graph visualization where nodes are projects (colored by DDS division) and edges represent impact relationships. Supports pairwise and cluster AI analysis via selection.

### Matrix
Heatmap matrix showing impact relationships between projects. Color intensity reflects severity. Includes a tag cloud of technologies across the portfolio.

### Timeline
Projects grouped by review month with a vertical timeline. Each project shown as a compact row with date, full project ID, gate badge, decision badge, project name, and DDS. Filterable and sortable.

### Details
Card grid of all projects. Each card shows project ID, name, description, gate badge, decision badge, DDS color accent, cost, tags, and expandable AI-extracted insights (digital technologies, business apps, security impacts, etc.).

### Impact
Full impact analysis results. Row-based list showing each impact relationship with direction, target, source project, severity, GIO services affected, and complete explanation text. Filterable by severity, GIO service, and project search.

### Goals Extractor
UI for the governance field extraction pipeline. Shows extracted fields per project, filterable by region and status. Supports bulk and single-project analysis, CSV export.

### Drive Sync
Google Drive integration management. Two tabs:
- **Drive Links**: Download status per project, add new links, discover projects from URLs
- **Projects Table**: Load and sync Google Sheets data into the projects database

### ArchFlow
Architecture documentation view showing the 3-step data pipeline with SQL queries used at each stage.

---

## Database Schema

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | All CIOO project records (one row per review) | project_id, name, dds, gate, cost_keur, description, review_date, decision, services |
| `project_goals` | AI-extracted governance fields per project | project_id, digital_technologies, security_impacts, gio_sl_dds_impacts, ... |
| `projects_impact` | AI-identified impact relationships | source_project_id, target_project_id, impact_type, direction, severity, explanation, gio_services |
| `analysis_cache` | Cached Gemini analysis results (SHA256-keyed) | prompt_hash, response_json, similarity_score |
| `documents_cache` | Downloaded document texts from Drive | url, content_text, content_type, fetch_status |
| `drive_sheet_meta` | Google Sheets sync metadata | sheet_id, gid, source_url, headers_json |
| `drive_sheet_rows` | Cached Google Sheets row data | row_index, data_json |

---

## Key Concepts

- **DDS (Division)**: Organizational unit (AMEI, APAC, GIO, Europe, CF, Digital, etc.) — each has a distinct color
- **Gate**: Project governance milestone (0 → 1 → 2 → 3 → 4, plus MVP variants)
- **Decision**: Review outcome (Passed, Not Passed, On Hold, Delegated)
- **GIO Services**: Shared IT infrastructure services (User Workplace, Network & Telecom, Security & Compliance, Cloud Platform, etc.)
- **Impact**: A directional relationship between two projects or between a project and GIO services, with type, severity, and explanation

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main page (view router)
│   ├── layout.tsx                  # Root layout with ProjectProvider
│   ├── globals.css                 # Global styles (DM Sans font, dark theme)
│   ├── admin/page.tsx              # Admin dashboard
│   └── api/
│       ├── projects/               # Project CRUD + upload
│       ├── impact/                 # Impact analysis engine control
│       ├── goals/                  # Goals extraction control
│       ├── drive/                  # Drive sync + sheet management
│       ├── analyze/                # Gemini pairwise/cluster analysis
│       ├── services/               # Service catalog + mappings
│       ├── prompts/                # Custom Gemini prompt management
│       └── admin/                  # Config, cache, Gemini test
├── components/
│   ├── Header.tsx                  # Navigation bar (8 view tabs)
│   ├── Toolbar.tsx                 # Global filters (DDS, gate, decision, year, search)
│   ├── Sidebar.tsx                 # Selected project detail panel
│   ├── DetailView.tsx              # Project card grid
│   ├── GraphView.tsx               # Force-directed graph
│   ├── MatrixView.tsx              # Impact heatmap matrix
│   ├── TimelineView.tsx            # Monthly timeline
│   ├── ImpactView.tsx              # Impact relationship list
│   ├── GoalsView.tsx               # Goals extraction UI
│   ├── DriveView.tsx               # Drive sync + sheet management
│   ├── ArchFlowView.tsx            # Pipeline documentation
│   ├── FileUpload.tsx              # Excel drag-and-drop upload
│   └── AIAnalysisPanel.tsx         # Gemini analysis results display
├── context/
│   └── ProjectContext.tsx          # Global state management
├── hooks/
│   └── useForceLayout.ts           # Force-directed graph physics
└── lib/
    ├── db.ts                       # SQLite schema + connection
    ├── types.ts                    # TypeScript interfaces
    ├── constants.ts                # Colors, gate order, decision labels
    ├── impact-engine.ts            # Impact analysis orchestration
    ├── goals-analyzer.ts           # Goals analysis orchestration
    ├── goals-extractor.ts          # Gemini goals field extraction
    ├── goals-scanner.ts            # Local file system scanner
    ├── drive-engine.ts             # Google Drive sync engine
    ├── sheets-engine.ts            # Google Sheets CSV fetcher
    ├── gemini.ts                   # Gemini AI client (pairwise/cluster)
    ├── similarity.ts               # Jaccard similarity + tag extraction
    ├── excel-parser.ts             # XLSX file parser
    ├── prompts.ts                  # Gemini prompt templates
    └── date-utils.ts               # Date/cost parsing utilities
data/
    └── cioo.db                     # SQLite database
```

---

## Running

```bash
npm install
npm run dev        # http://localhost:3000
```

Requires:
- Node.js 18+
- `GEMINI_API_KEY` in `.env.local`
- Google service account credentials for Drive/Sheets access
