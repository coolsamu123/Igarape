// Canonical definitions for the GIO Service Lines and DDS entities used by the
// Impact engine and Deep Dive analyses.
//
// The Impact engine treats the *names* below as canonical identifiers. The
// Deep Dive prompt enriches them with the `description` text so the LLM stops
// guessing what e.g. "User Workplace" means inside Air Liquide and grounds its
// analysis on a stable definition.
//
// HOW TO FILL THIS FILE
// --------------------
// Each entry has:
//   - name         (DO NOT change — must match the canonical strings used by
//                   prompts.ts and the goals extractor)
//   - description  (1–3 sentences: what this service line / entity actually
//                   covers, its scope, and the kind of touchpoints a project
//                   would have with it)
//
// Leave `description` empty until you're ready — `getTargetDefinition` falls
// back gracefully to the kind-level helper text when a description is empty.

export type TargetKind = 'gio' | 'dds';

// Stable enum of roles a project can play in relation to a target. Mirrors the
// `role` field that Goals will emit per impact_claim (Onda 3 of the refactor).
// `impact-engine.ts` derives the impact `direction` from this:
//   - 'primary_provider'        → 'provides_to'
//   - 'downstream_consumer'     → 'depends_on'
//   - 'regional_executor'       → 'requires_coordination'
//   - 'risk_owner'              → 'requires_coordination'
//   - 'blocked_by'              → 'depends_on'
export type TargetRole =
  | 'primary_provider'
  | 'downstream_consumer'
  | 'regional_executor'
  | 'risk_owner'
  | 'blocked_by';

export interface TargetDefinition {
  name: string;
  description: string;
  // Optional. When set, biases the LLM toward picking one of these roles when
  // a project's content places it in this target. Not restrictive — the LLM
  // can still emit a role outside this list if evidence is unambiguous. Empty
  // = no bias.
  typicalRoles?: ReadonlyArray<TargetRole>;
  // Optional. Same idea for `impact_type` (security_dependency, etc). Helps
  // disambiguate borderline cases. Empty = no bias.
  typicalImpactTypes?: ReadonlyArray<string>;
}

// ─── GIO Service Lines (5) ──────────────────────────────────────────────────
// Canonical list mirrors prompts.ts:32

export const GIO_SERVICE_DEFINITIONS: ReadonlyArray<TargetDefinition> = [
  {
    name: 'Security & Compliance',
    description: "Designs, builds, and operates the solutions that protect the Group's digital estate. Portfolio is organised in four pillars: Identity & Access Management (IAM), End-user Security, Perimeter Security, and Vulnerability & Compliance. Includes the CSIRT (Computer Security Incident Response Team) for detection, investigation, and response to cybersecurity incidents. Led by Jean-Charles Martin.",
    typicalRoles: ['primary_provider', 'risk_owner'],
    typicalImpactTypes: ['security_dependency', 'infrastructure_shared', 'organizational'],
  },
  {
    name: 'Command Center',
    description: 'Operational brain of GIO, ensuring 24/7 stability. Centralises monitoring of all digital operations to prevent SLA breaches, coordinates Major Incident Management across regions, and runs SIAM (Service Integration & Management) to harmonise multiple MSP service providers. Led by Graeme White.',
    typicalRoles: ['primary_provider', 'risk_owner'],
    typicalImpactTypes: ['infrastructure_shared', 'organizational', 'vendor_shared'],
  },
  {
    name: 'User Workplace',
    description: "Owns the digital ecosystem used by employees day-to-day. Scope covers endpoint hardware (PCs, mobile devices, printers), workplace software (Google Workspace, application stores), and videoconferencing systems. Runs the global Service Desk and L1/L2 local support via partners such as Computacenter, and drives continuous improvement of the employee digital experience through the eXperience Management Office (XMO). Led by Jérôme Bachelerie.",
    typicalRoles: ['downstream_consumer', 'primary_provider'],
    typicalImpactTypes: ['platform_shared', 'technology_dependency'],
  },
  {
    name: 'Site Infrastructure',
    description: 'Owns connectivity and physical infrastructure at Air Liquide sites. Covers global LAN, Wi-Fi, and WAN networks (including perimeter firewall security), telephony and Telecom Expense Management (TEM), and OT (Operational Technology) integration for industrial and IoT environments. Led by Olivier Duccini.',
    typicalRoles: ['primary_provider'],
    typicalImpactTypes: ['infrastructure_shared', 'regional_rollout'],
  },
  {
    name: 'Cloud Services',
    description: 'Owns server infrastructure and modern platforms. Mission covers design and build of cloud platforms (e.g. the migration to GCP) and automation environments. Operates Container-as-a-Service (CaaS) and database services, and coordinates the sunset of physical datacenters. Led by Pierre Bansillon.',
    typicalRoles: ['primary_provider'],
    typicalImpactTypes: ['infrastructure_shared', 'platform_shared', 'technology_dependency'],
  },
];

// ─── DDS Entities (~20) ─────────────────────────────────────────────────────
// Canonical list mirrors prompts.ts:27-29
// Three sub-groups: geographic zones, business divisions/SBUs, app/functional
// groups. Sub-group is informational only — the engine treats all DDS entries
// uniformly.

export const DDS_ENTITY_DEFINITIONS: ReadonlyArray<TargetDefinition> = [
  // Geographic zones — regional "centers of gravity" for digital governance and
  // strategy implementation across the Group.
  {
    name: 'Americas',
    description: 'Regional hub overseeing North America (NAM), Argentina (ARG), and Latin America (LATAM). Includes major subsidiaries such as Airgas.',
    typicalRoles: ['regional_executor'],
    typicalImpactTypes: ['regional_rollout'],
  },
  {
    name: 'Europe',
    description: 'Regional hub managing a perimeter that includes Central Europe (CE), South West Europe (SWE), and North East Europe (NEC).',
    typicalRoles: ['regional_executor'],
    typicalImpactTypes: ['regional_rollout'],
  },
  {
    name: 'APAC',
    description: 'Regional hub covering Greater China (GCH) and the broader Asia-Pacific region.',
    typicalRoles: ['regional_executor'],
    typicalImpactTypes: ['regional_rollout'],
  },
  {
    name: 'AMEI',
    description: 'Regional hub responsible for digital operations across Africa, Middle East, and India.',
    typicalRoles: ['regional_executor'],
    typicalImpactTypes: ['regional_rollout'],
  },

  // Business divisions / SBUs — specialized Digital Delivery Services (DDS) or
  // World Business Lines (WBLs).
  {
    name: 'CF',
    description: 'Corporate Functions. Covers critical Group domains including Finance, HR, Procurement, Communication, Legal, and Intellectual Property.',
  },
  {
    name: 'GM&T',
    description: 'Global Markets & Technologies. A business division supported by dedicated D&IT Business Partners.',
  },
  {
    name: 'E&C',
    description: 'Engineering & Construction. Operates as a separate DDS entity from InnoTech for the 2026 roadmap.',
  },
  {
    name: 'HC D&IT',
    description: 'Healthcare Digital & Information Technology. Provides specialised digital services for the Healthcare business line.',
  },
  {
    name: 'Alizent',
    description: 'Subsidiary focused on industrial IoT and asset tracking.',
  },
  {
    name: 'GDO',
    description: 'Global Digital Organization. The central driver for digital transformation and innovation across the Group.',
  },
  {
    name: 'SEPPIC',
    description: 'Specialty healthcare and beauty ingredient subsidiary, maintained as its own DDS entity.',
  },
  {
    name: 'Airgas',
    description: 'Key entity within the Americas hub, specifically focused on industrial and medical gas markets.',
  },
  {
    name: 'HHC',
    description: 'Home Healthcare. Manages digital solutions for chronic patient care, such as the kairin respiratory monitoring solution.',
  },

  // App / Functional groups — delivery units and governance structures within
  // Global Digital Services (GDS).
  {
    name: 'Industrial Apps',
    description: 'Group within GDS that partners with Industrial Direction to define technical product roadmaps.',
  },
  {
    name: 'Enterprise Apps',
    description: 'Group focused on digital solutions for core enterprise-wide business processes.',
  },
  {
    name: 'Data & AI Apps',
    description: 'Specialised technical chapter within GDS dedicated to managing data strategy and artificial intelligence products.',
  },
  {
    name: 'Digital Factory',
    description: 'Delivery engine within GDS responsible for the rapid development and scaling of digital products.',
  },
  {
    name: 'InnoTech',
    description: 'Organisational grouping planned to eventually integrate E&C and IDD; for the 2026 roadmap they remain distinct.',
  },
  {
    name: 'CDIO Office',
    description: "Office of the Chief Digital & Information Officer. Sets the Group's overall Digital & IT vision and governance.",
    typicalRoles: ['primary_provider', 'risk_owner'],
    typicalImpactTypes: ['organizational'],
  },
  {
    name: 'IDD',
    description: 'Innovation & Development Division. Currently operating as a separate DDS from the InnoTech umbrella.',
  },
];

// ─── Lookup helpers ─────────────────────────────────────────────────────────

const GIO_BY_NAME = new Map(GIO_SERVICE_DEFINITIONS.map(d => [d.name, d]));
const DDS_BY_NAME = new Map(DDS_ENTITY_DEFINITIONS.map(d => [d.name, d]));

/**
 * Returns the canonical description for a target if one exists in the catalog.
 * Falls back to an empty string when:
 *   - the target name is not in the canonical list (unknown / typo), or
 *   - the description field hasn't been filled in yet.
 *
 * Callers (e.g. the Deep Dive prompt builder) should treat an empty return as
 * "no canonical definition available" and degrade to the generic kind helper.
 */
export function getTargetDefinition(kind: TargetKind, target: string): string {
  const map = kind === 'gio' ? GIO_BY_NAME : DDS_BY_NAME;
  return map.get(target)?.description.trim() || '';
}

/**
 * Returns the full canonical entry (description + bias hints) for a target.
 * Used by the Goals prompt builder (Onda 3) to inject per-target context
 * inline when asking the LLM to emit `impact_claims`. Returns null when the
 * target name is not in the canonical list.
 */
export function getTargetEntry(kind: TargetKind, target: string): TargetDefinition | null {
  const map = kind === 'gio' ? GIO_BY_NAME : DDS_BY_NAME;
  return map.get(target) ?? null;
}

/**
 * Used by validators in `impact-engine.ts` to reject impact_claims whose
 * `target` is not in the canonical catalog (catches LLM typos and drift).
 */
export function isCanonicalTarget(kind: TargetKind, target: string): boolean {
  const map = kind === 'gio' ? GIO_BY_NAME : DDS_BY_NAME;
  return map.has(target);
}
