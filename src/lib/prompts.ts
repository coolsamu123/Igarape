import fs from 'fs';
import path from 'path';

const PROMPTS_FILE = path.join(process.cwd(), 'data', 'prompts.json');

export const DEFAULT_GOALS_PROMPT = `You are an IT portfolio analyst for Air Liquide's CIOO (Chief Information Officer Office).
You are analyzing project documentation to extract structured information for governance objectives.

{{PROJECT_INFO}}

Extract the following 8 fields from the project documents below. For each field, provide a concise but complete summary. If the information is not found in the documents, respond with "Not identified in available documentation".

Fields to extract:
1. **digital_technologies**: Digital technologies involved (infrastructure, network, platforms, tools, cloud services, databases, middleware, etc.)
2. **change_management**: User change management approach (training plans, adoption strategy, communication plan, organizational impact, number of users affected, rollout phases)
3. **security_impacts**: Security impacts including DRMT (Digital Risk Management Toolkit) grade if mentioned, cybersecurity risks, data protection considerations, compliance requirements
4. **regional_impacts**: Regional impacts — which geographies/regions are affected, deployment scope, local vs global rollout
5. **ia_embedded**: Whether AI/IA (Artificial Intelligence) is embedded in the project — any ML models, AI features, generative AI, automation, intelligent processing
6. **gio_sl_dds_impacts**: Direct impacts with GIO Service Lines and/or DDS (Digital & Data Solutions) — which service lines are involved, dependencies, touchpoints
7. **dds_gio_workload**: Expected DDS / GIO SL workload — effort estimation, FTE required, resource allocation, support needs
8. **business_apps_cis**: Impacts with Business Applications and Configuration Items (CIs) — which applications/systems are affected, integrations, decommissions, new CIs

Respond ONLY with a JSON object (no markdown fences, no explanation) with these exact keys:
{
  "digital_technologies": "...",
  "change_management": "...",
  "security_impacts": "...",
  "regional_impacts": "...",
  "ia_embedded": "...",
  "gio_sl_dds_impacts": "...",
  "dds_gio_workload": "...",
  "business_apps_cis": "..."
}

DOCUMENT TEXT:
{{DOCUMENT_TEXT}}`;

export const DEFAULT_IMPACT_PROMPT = `You are an IT portfolio analyst for Air Liquide.
You MUST analyze these IT projects and find impact relationships between them.

Look for:
- Projects using the same technology, platform, or vendor
- Projects where one blocks or enables another
- Projects sharing infrastructure, data sources, or APIs
- Projects competing for the same resources or budget
- Projects that need coordination due to overlapping scope

CRITICAL - GIO SERVICES DEPENDENCY:
Global Infrastructure Operations (GIO) provides these key services:
1. Security & Compliance (Identity & Access Management, End-user Security & Secure Access, Peripheral Security, Vulnerability & Compliance, CSIRT)
2. Command Center (P2 Task Force, Incident Management, Problem Management, Service KPIs)
3. User Workplace (Service expert pool, XMO process/Nexthink, ComputaCenter on-site support, Packaging factory for Modern Experience, Solution Expert Managed Apps)
4. Site Infrastructure (LAN & WIFI, Firewall inventory, Maintenance subscription)
5. Cloud Services (G&SM/Service Catalog, E&I S/4 HANA Upgrade, T&O Problem management, APAC Citrix Developer workspace, SAP Basis operations)

If a project's description, technology, or "GIO Impacts" indicates it will probably or definitely need any of these services, you MUST create an impact relationship with:
- "source": The Project ID
- "target": "GIO_SERVICES"
- "impact_type": "infrastructure_shared"
- "direction": "requires_coordination"
- "severity": "high" or "medium"
- "explanation": Briefly explain exactly which GIO service is needed. Incorporate specific details from 'GIO Impacts', 'GIO Workload', 'Security Impacts', and 'Business Apps/CIs' directly into your explanation string to provide maximum context.
- "gio_services": A list containing any of these exact strings that apply: ["Security & Compliance", "Command Center", "User Workplace", "Site Infrastructure", "Cloud Services"]. Leave empty [] if target is not GIO_SERVICES.

PROJECTS:
{{PROJECTS_LIST}}

IMPORTANT: You MUST return a JSON array. Find at least the obvious connections.
Each object must have these exact fields:
- "source": project ID (e.g. "PRJ0004517")
- "target": project ID or "GIO_SERVICES"
- "impact_type": one of [technology_dependency, infrastructure_shared, data_dependency, timeline_blocking, resource_contention, organizational, platform_shared, vendor_shared, integration_required, security_dependency]
- "direction": one of [blocks, enables, shares_resource, feeds_data, competes_with, requires_coordination]
- "severity": one of [high, medium, low]
- "explanation": 1-2 sentences why
- "gio_services": array of strings (e.g., ["Cloud Services", "Security & Compliance", "User Workplace"]). Leave empty [] if target is not GIO_SERVICES.

Return ONLY a JSON array. Example:
[{"source":"PRJ0001234","target":"GIO_SERVICES","impact_type":"infrastructure_shared","direction":"requires_coordination","severity":"high","explanation":"Project requires AWS Landing Zone and CARM/OKTA integration.","gio_services":["Cloud Services", "Security & Compliance"]}]`;

export interface PromptsConfig {
  goalsPrompt: string;
  impactPrompt: string;
}

export function getPrompts(): PromptsConfig {
  try {
    if (fs.existsSync(PROMPTS_FILE)) {
      const data = fs.readFileSync(PROMPTS_FILE, 'utf-8');
      return JSON.parse(data) as PromptsConfig;
    }
  } catch (error) {
    console.error('Failed to read prompts file', error);
  }
  return {
    goalsPrompt: DEFAULT_GOALS_PROMPT,
    impactPrompt: DEFAULT_IMPACT_PROMPT,
  };
}

export function savePrompts(prompts: PromptsConfig) {
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
}
