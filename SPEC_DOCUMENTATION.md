# CIOO Project Intelligence — Full Specification & Documentation

## Overview

The **CIOO Project Intelligence** platform is an IT Portfolio Analytics web application designed for Air Liquide. It helps identify thematic overlaps, dependencies, security risks, and synergies across hundreds of IT projects.

The application achieves this by combining:
1. **Excel Data**: High-level metadata (costs, dates, decisions, basic descriptions) uploaded via a tracker.
2. **Sub-App Data (Drive Extractor)**: Deep, AI-extracted insights (8 structured dimensions) pulled from actual project documents (PDF, DOCX, XLSX) stored in Google Drive.
3. **Gemini AI Engine**: An intersection analysis engine that dynamically compares projects based on these two data sources to highlight conflicts, synergies, and bottlenecks.

---

## 1. Architecture & Data Sources

The application relies on a local SQLite database (`data/cioo.db`) as its single source of truth, populated by two distinct workflows:

### A. Core Metadata (The Main App)
Users upload the master Excel file (`0_CIOO Forecast`) via the UI. This populates the `projects` table with essential tracking data:
* `project_id` (ServiceNow #)
* `name`
* `dds` (Division)
* `cost_keur`
* `gate`, `decision`
* `description`, `remarks`

### B. Deep Insights (The Goals Extractor Sub-App)
The sub-app scans a local folder (`gdrive_manual_test/`) containing downloaded Drive files, reads the raw text, and asks Gemini to extract exactly 8 dimensions per project. These are stored in the `project_goals` table:
1. `digital_technologies`
2. `change_management`
3. `security_impacts`
4. `regional_impacts`
5. `ia_embedded`
6. `gio_sl_dds_impacts`
7. `dds_gio_workload`
8. `business_apps_cis`

### C. The JOIN Mechanism
Whenever the frontend requests data via `/api/projects`, the backend performs a `LEFT JOIN` between `projects` and `project_goals` on the `project_id`. This means projects are seamlessly enriched with deep AI insights if they have been processed by the sub-app.

---

## 2. Gemini AI Analysis Engine

The application uses **Gemini 2.0 Flash** to compute how projects intersect. Instead of just relying on the short manual descriptions from the Excel file, the engine explicitly injects the 8 sub-app dimensions into the prompt context to find precise, actionable connections.

### Prompt Context Generation
When analyzing a project, its context is built dynamically based on available data:

```javascript
// Generated Context Snippet
- ServiceNow ID: PRJ0010712
- Division (DDS): APAC
- Current Gate: Gate 2
- Cost: 500k€
- Description: Moving to AWS.
- Remarks: Need security review.

// If Sub-App Data is available, this is automatically appended:
- Digital Technologies: AWS, Kubernetes
- AI/IA Embedded: Uses Gemini for log analysis
- Security Impacts: High data exposure risk
- Change Management: Requires global training
- Regional Impacts: APAC only
- GIO SL/DDS Impacts: Network bandwidth spikes
- DDS/GIO Workload: 2 FTEs required
- Business Apps & CIs: SAP, Salesforce
```

### Pairwise Analysis Prompt
When the user selects two projects and clicks "Analyze Intersection", this is the exact prompt sent to Gemini:

```text
You are an IT portfolio analyst for a large industrial company (Air Liquide).
Analyze the intersection between these two IT projects:

PROJECT A: {Project_A_Name}
{Project_A_Context}

PROJECT B: {Project_B_Name}
{Project_B_Context}

Analyze and return ONLY a JSON object (no markdown, no code fences) with this structure:
{
  "themes": ["theme1", "theme2"],
  "synergies": ["synergy1", "synergy2"],
  "risks": ["risk1", "risk2"],
  "recommendations": ["recommendation1", "recommendation2"],
  "similarityScore": 0.0 to 1.0
}

Focus on:
1. Thematic overlaps (technology, business domain, infrastructure, data)
2. Potential synergies (shared resources, common platforms, cost optimization) - specifically look for matching elements in Digital Technologies and Business Apps & CIs
3. Risks (dependency conflicts, resource contention, timeline clashes, redundancy) - specifically look for compounding complexities in Security Impacts or Change Management
4. Concrete recommendations for coordination between these projects - including operational bottlenecks or overlapping constraints in DDS/GIO Workload or GIO SL/DDS Impacts
```

*(A similar prompt structure is used for **Batch/Cluster Analysis**, analyzing up to 22 projects at a time to find multi-project redundancies and portfolio optimization opportunities).*

---

## 3. How to Start from Zero (Clean Slate Guide)

The system has been completely wiped (databases, uploads, and cached analysis cleared). Follow these steps to rebuild the portfolio intelligence from scratch:

### Step 1: Start the Applications
1. Open a terminal in the root directory (`/home/samuel/Igarape/`).
2. Run the main application:
   ```bash
   ./start.sh
   ```
3. Open a **second** terminal and run the Sub-App:
   ```bash
   ./start_subapp.sh
   ```

### Step 2: Extract Deep Goals via Sub-App
1. Navigate to **http://localhost:3333/goals** in your browser.
2. Click the **"Run Analysis"** button in the top right.
3. The sub-app will scan the `gdrive_manual_test/` directory, extract text from the `.docx`, `.pdf`, and `.xlsx` files, and use Gemini to generate the 8 dimensions.
4. *Wait for the progress bar to complete (this populates the `project_goals` database table).*

### Step 3: Upload Core Metadata via Main App
1. Navigate to **http://localhost:3333/** in your browser.
2. Click the **"Upload Excel"** button in the top right.
3. Drag and drop your master `0_CIOO Forecast.xlsx` file.
4. The system will parse the rows, match the `PRJ` numbers against the sub-app data, and instantly render the Graph, Matrix, and Timeline views.

### Step 4: Configure the Admin Panel
1. Click the **Admin Panel** icon (the settings gear) in the top right.
2. Ensure your **Gemini API Key** is configured and saved.
3. *(Optional)* Use the "Test Connection" button to ensure the AI can communicate with the server.

### Step 5: Run AI Impact Analysis
1. Return to the main dashboard.
2. Go to the **Impact** tab.
3. Click **"Start Full Analysis"**.
4. Gemini will now batch-process all projects division by division, utilizing both the short Excel descriptions AND the deep 8-dimension insights extracted by the sub-app to generate an incredibly accurate web of dependencies, risks, and synergies.

### Features to Explore
* **Graph View Tooltips**: Hover over projects to instantly see if they are "AI Powered ✨" or have a "Security Impact", based entirely on sub-app extraction.
* **Detail View Panel**: Click any project node to open its drawer. Scroll down to see the "AI Extracted Insights" beautifully formatted.
* **Sidebar KPIs**: Note the new specific tracking metrics on the left panel ("AI Analyzed" and "AI Powered").