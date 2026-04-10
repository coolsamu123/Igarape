# Sub-Application Plan: CIOO Project Goals Extractor

## Context

We have **747 files** (516 `.docx`, 159 `.xlsx`, 72 `.pdf`) across **121 projects** manually downloaded from Google Drive into `/home/samuel/Igarape/gdrive_manual_test/`.

Files are organized as:
```
gdrive_manual_test/
  {Month folder}/
    {Month folder (extracted)}/
      {REGION} - {PROJECT_NAME} - {PROJECT_ID} - {GATE}/
        Q&A ({PROJECT_NAME} - {PROJECT_ID}).docx
        Gate X - Note - {PROJECT_ID} - {PROJECT_NAME}.docx
        Digital Risk Management Toolkit vX.X - {PROJECT_NAME}.xlsx
        IT Canonical Appendix - {PROJECT_NAME} - {PROJECT_ID}.xlsx
        Archives/
          CIOO-Archiv_*.docx|xlsx|pdf
```

---

## Goal

Build a sub-application that:
1. Scans `gdrive_manual_test/`, identifies each project by folder name (extracting project ID + name + region + gate)
2. Extracts text from all project documents (DOCX, XLSX, PDF)
3. Sends document content to **Gemini API** to extract 8 structured fields per project
4. Stores results in a SQLite table
5. Exposes a simple UI page to browse/export the extracted goals

---

## Data Model

### Table: `project_goals`

| Column                    | Type    | Description                                                        |
|---------------------------|---------|--------------------------------------------------------------------|
| `id`                      | INTEGER | Auto-increment PK                                                  |
| `project_id`              | TEXT    | e.g. `PRJ0019889`                                                  |
| `project_name`            | TEXT    | e.g. `Intelex Medical validation`                                  |
| `region`                  | TEXT    | e.g. `CF`, `GDO`, `Americas`, `APAC`                               |
| `gate`                    | TEXT    | e.g. `Gate 2`, `Contract note`                                     |
| `month_folder`            | TEXT    | e.g. `September 2025`                                              |
| `digital_technologies`    | TEXT    | Infra, network technologies identified (JSON or structured text)   |
| `change_management`       | TEXT    | User change management approach and impacts                        |
| `security_impacts`        | TEXT    | Security impacts including DRMT grade if available                 |
| `regional_impacts`        | TEXT    | Regional impacts and scope                                         |
| `ia_embedded`             | TEXT    | Whether AI/IA is embedded in the project and how                   |
| `gio_sl_dds_impacts`      | TEXT    | Direct impacts with GIO Service Lines and/or DDS                   |
| `dds_gio_workload`        | TEXT    | Expected DDS / GIO SL workload                                     |
| `business_apps_cis`       | TEXT    | Impacts with business applications and Configuration Items         |
| `raw_gemini_response`     | TEXT    | Full Gemini JSON response for traceability                         |
| `source_files`            | TEXT    | JSON array of file paths used for analysis                         |
| `analyzed_at`             | TEXT    | ISO timestamp of when Gemini analysis ran                          |
| `status`                  | TEXT    | `pending` / `success` / `error`                                    |
| `error_message`           | TEXT    | Error details if analysis failed                                   |

---

## Implementation Steps

### Step 1: File Scanner (`src/lib/goals-scanner.ts`)
- Walk `gdrive_manual_test/` recursively
- Parse folder names with regex: `{REGION} - {PROJECT_NAME} - {PROJECT_ID} - {GATE}`
- Group all files (including Archives/) by project ID
- Return: `{ projectId, projectName, region, gate, monthFolder, files: string[] }[]`
- Include ALL files (archives + current) — nothing skipped

### Step 2: Text Extraction (`src/lib/goals-extractor.ts`)
- **DOCX**: Use `mammoth` (already in Node ecosystem) to extract raw text
- **XLSX**: Use `xlsx` (already a dependency) to extract cell text, sheet by sheet
- **PDF**: Use `pdf-parse` to extract text
- Concatenate all text per project, truncate to ~60,000 chars (Gemini context limit)

### Step 3: Gemini Analysis (`src/lib/goals-analyzer.ts`)
- For each project, build a structured prompt:
  ```
  You are analyzing CIOO project documentation for project "{PROJECT_NAME}" ({PROJECT_ID}).
  Extract the following information from the documents provided.
  For each field, provide a concise summary. If the information is not found, respond with "Not identified".

  Fields to extract:
  1. Digital Technologies (infrastructure, network, platforms)
  2. User Change Management (approach, training, adoption impacts)
  3. Security Impacts (DRMT grade, cybersecurity considerations)
  4. Regional Impacts (which regions affected, how)
  5. AI/IA Embedded in Project (any AI/ML components, use cases)
  6. Direct Impacts with GIO SL and/or DDS (dependencies, touchpoints)
  7. DDS / GIO SL Workload Expected (effort estimation, resource needs)
  8. Impacts with Business Applications and CIs (systems affected, integrations)

  Respond in JSON format with these exact keys:
  { "digital_technologies", "change_management", "security_impacts",
    "regional_impacts", "ia_embedded", "gio_sl_dds_impacts",
    "dds_gio_workload", "business_apps_cis" }

  --- PROJECT DOCUMENTS ---
  {CONCATENATED_TEXT}
  ```
- Use `gemini-2.0-flash` (already configured in the main app)
- Batch with 1-second delay between calls to avoid rate limits
- Parse JSON response, store in DB

### Step 4: Database Setup (`src/lib/goals-db.ts`)
- Create `project_goals` table in `data/cioo.db` (reuse existing DB)
- Upsert logic: re-running analysis updates existing rows
- Add index on `project_id`

### Step 5: API Route (`src/app/api/goals/route.ts`)
- `GET /api/goals` — list all project goals (with filters: region, gate, status)
- `POST /api/goals/run` — trigger the scan + extraction + analysis pipeline
- `GET /api/goals/status` — pipeline progress (running, processed/total, errors)
- `GET /api/goals/export` — CSV export of all results

### Step 6: UI Page (`src/app/goals/page.tsx`)
- Table view of all projects with the 8 extracted fields
- Filters by region, gate, month, status
- Click to expand full detail per project
- "Run Analysis" button to trigger pipeline
- Progress indicator during analysis
- "Export CSV" button

---

## Tech Stack (reuses existing)

- **Next.js 14** — app router, API routes
- **better-sqlite3** — same DB
- **@google/generative-ai** — Gemini SDK (already configured)
- **xlsx** — already a dependency for Excel parsing
- **mammoth** — new dependency for DOCX text extraction
- **pdf-parse** — new dependency for PDF text extraction
- **Tailwind CSS** — consistent with main app styling

---

## Execution Order

1. `npm install mammoth pdf-parse` — add dependencies
2. Implement Step 4 (DB table) — foundation
3. Implement Step 1 (scanner) — discover projects
4. Implement Step 2 (extractor) — get text from files
5. Implement Step 3 (analyzer) — Gemini integration
6. Implement Step 5 (API routes) — wire it up
7. Implement Step 6 (UI) — make it usable
8. Test with 2-3 projects first, then full batch

---

## Estimated Scope

- ~121 projects to analyze
- ~251 active files (excluding archives) to extract text from
- ~121 Gemini API calls (one per project)
- New files: 6 source files + 1 page component
- New dependencies: 2 (`mammoth`, `pdf-parse`)

---

## Decisions

1. **Archives folder**: Include ALL files (archives + current) — nothing skipped
2. **Multiple months**: Merge all documents across months for the same project ID
3. **Gemini model**: `gemini-2.0-pro` for best accuracy
4. **Export format**: CSV
