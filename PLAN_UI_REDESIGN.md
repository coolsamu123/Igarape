# Plan — Detail & Impact View UI Redesign

## Overview
Redesign the Detail cards and Impact list to be visually richer, with brighter colors, better readability, and consistent design language across both views.

---

## Part 1: DetailView.tsx — Card Redesign

### Task 1.1: Make description text brighter
**File:** `src/components/DetailView.tsx` line 68  
**Change:** Replace `text-gray-500` with `text-gray-300` on the description `<div>`.

```tsx
// BEFORE (line 68)
<div className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-3">

// AFTER
<div className="text-xs text-gray-300 leading-relaxed mb-3 line-clamp-3">
```

### Task 1.2: Make Gate badge more prominent on cards
**File:** `src/components/DetailView.tsx` lines 44-49  
**Change:** The Gate badge already exists in the header but is small. Make it larger and more visually prominent — increase padding, font size, and add a subtle glow/border.

```tsx
// BEFORE (lines 44-49)
{isUseful(p.currentGate) && (
  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold"
    style={{ background: `${getGateColor(p.currentGate)}22`, color: getGateColor(p.currentGate) }}>
    G{p.currentGate}
  </span>
)}

// AFTER — bigger badge with border glow
{isUseful(p.currentGate) && (
  <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold border"
    style={{
      background: `${getGateColor(p.currentGate)}18`,
      color: getGateColor(p.currentGate),
      borderColor: `${getGateColor(p.currentGate)}40`,
      boxShadow: `0 0 8px ${getGateColor(p.currentGate)}25`,
    }}>
    Gate {p.currentGate}
  </span>
)}
```

### Task 1.3: Remove "Security Impact" badge
**File:** `src/components/DetailView.tsx` lines 74-88  
**Change:** Remove the `securityImpacts` badge from the decision badge section. Keep the `latestDecision` badge but remove the entire `securityImpacts` `<span>`. Also clean up the outer condition to only check `latestDecision`.

```tsx
// BEFORE (lines 74-88)
{(isUseful(p.latestDecision) || isUseful(p.securityImpacts)) && (
  <div className="mb-3 flex gap-2 flex-wrap">
    {isUseful(p.latestDecision) && (
      <span ...>{p.latestDecision}</span>
    )}
    {isUseful(p.securityImpacts) && (
      <span className="... bg-red-500/20 text-red-400 border border-red-500/30">
        Security Impact
      </span>
    )}
  </div>
)}

// AFTER — only latestDecision, no securityImpacts badge
{isUseful(p.latestDecision) && (
  <div className="mb-3 flex gap-2 flex-wrap">
    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
      style={{ background: `${getDecisionColor(p.latestDecision)}22`, color: getDecisionColor(p.latestDecision) }}>
      {p.latestDecision}
    </span>
  </div>
)}
```

### Task 1.4: Add subtle top border color accent on cards
**File:** `src/components/DetailView.tsx` line 35-36  
**Change:** Add a colored top border to each card based on the DDS color. This adds visual richness and color coding.

```tsx
// BEFORE (line 35-36)
<div
  key={p.projectId}
  onClick={() => setSelected(isSelected ? null : p.projectId)}
  className={`bg-gray-900 border rounded-xl p-5 cursor-pointer transition-all hover:-translate-y-0.5
    ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-gray-800 hover:border-gray-600'}`}
>

// AFTER — add top border accent via style + slight card glow on hover
<div
  key={p.projectId}
  onClick={() => setSelected(isSelected ? null : p.projectId)}
  className={`bg-gray-900 border rounded-xl p-5 cursor-pointer transition-all hover:-translate-y-0.5
    ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-gray-800 hover:border-gray-600'}`}
  style={{ borderTopColor: color, borderTopWidth: '2px' }}
>
```

### Task 1.5: Improve stats row readability
**File:** `src/components/DetailView.tsx` lines 91-97  
**Change:** Make the stats row text slightly brighter (`text-gray-400` instead of `text-gray-500`) and add subtle icons or better formatting.

```tsx
// BEFORE (line 92)
<div className="flex justify-between text-[11px] text-gray-500">

// AFTER
<div className="flex justify-between text-[11px] text-gray-400">
```

---

## Part 2: ImpactView.tsx — Redesign to Card Layout

### Task 2.1: Remove "Impact Type" from filter dropdown
**File:** `src/components/ImpactView.tsx` lines 340-360  
**Change:** Remove the `<optgroup label="Impact Types">` section from the filter `<select>`. Keep only the GIO Services optgroup. Rename the dropdown label from "All Types & Services" to "All GIO Services".

```tsx
// BEFORE (lines 340-360)
<select ...>
  <option value="All">All Types & Services</option>
  {filterOptions.impactTypes.length > 0 && (
    <optgroup label="Impact Types">
      {filterOptions.impactTypes.map(t => (
        <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
      ))}
    </optgroup>
  )}
  {filterOptions.gioServices.length > 0 && (
    <optgroup label="GIO Services">
      {filterOptions.gioServices.map(s => (
        <option key={`GIO_${s}`} value={`GIO_${s}`}>{s}</option>
      ))}
    </optgroup>
  )}
</select>

// AFTER — only GIO Services
<select ...>
  <option value="All">All GIO Services</option>
  {filterOptions.gioServices.map(s => (
    <option key={`GIO_${s}`} value={`GIO_${s}`}>{s}</option>
  ))}
</select>
```

### Task 2.2: Remove "Impact Type" badge from impact cards
**File:** `src/components/ImpactView.tsx` lines 448-449  
**Change:** Remove the impact type `<span>` badge from the badges section at the bottom of each card.

```tsx
// REMOVE these lines (448-449):
<span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-400 shrink-0">
  {TYPE_LABELS[imp.impactType] || imp.impactType}
</span>
```

### Task 2.3: Convert impact list items to card layout (match DetailView style)
**File:** `src/components/ImpactView.tsx` lines 375-484  
**Change:** Redesign each impact item from a flat list row to a card-style layout matching DetailView. Use:
- `rounded-xl` instead of `rounded-lg`
- `p-5` instead of `p-4`
- Add a colored top border based on severity (`borderTopColor: sevColor, borderTopWidth: '2px'`)
- Change from `space-y-2` parent to `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4` for card grid layout
- Brighten the explanation text from `text-gray-400` to `text-gray-300`

```tsx
// BEFORE (line 376)
<div className="space-y-2">

// AFTER
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
```

For each card:
```tsx
// BEFORE (lines 382-390)
<div key={imp.id}
  onClick={...}
  className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors cursor-pointer"
>

// AFTER
<div key={imp.id}
  onClick={...}
  className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-all hover:-translate-y-0.5 cursor-pointer"
  style={{ borderTopColor: sevColor, borderTopWidth: '2px' }}
>
```

### Task 2.4: Restructure card content layout for grid
**File:** `src/components/ImpactView.tsx`  
**Change:** Adjust the internal layout of each impact card for the grid. Instead of horizontal `flex items-start gap-3`, use a vertical stack:

```tsx
// AFTER card inner layout:
<div>
  {/* Severity + Source -> Target header */}
  <div className="flex items-center gap-2 mb-2">
    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: sevColor }} title={imp.severity} />
    <span className="text-[10px] font-mono" style={{ color: getDDSColor(src?.dds || '') }}>
      {imp.sourceProjectId === 'GIO_SERVICES' ? 'GIO' : imp.sourceProjectId.replace('PRJ00', '')}
    </span>
    <span className="text-xs text-gray-500">→</span>
    <span className="text-[10px] font-mono" style={{ color: getDDSColor(tgt?.dds || '') }}>
      {imp.targetProjectId === 'GIO_SERVICES' ? 'GIO' : imp.targetProjectId.replace('PRJ00', '')}
    </span>
  </div>

  {/* Source project name */}
  <div className="text-sm font-bold text-gray-100 mb-1 leading-snug line-clamp-2">
    {imp.sourceProjectId === 'GIO_SERVICES' ? 'GIO Services & Infrastructure' : src?.name || imp.sourceProjectId}
  </div>

  {/* Direction label */}
  <div className="text-[10px] text-gray-400 mb-2">
    {DIRECTION_LABELS[imp.direction] || imp.direction} → {imp.targetProjectId === 'GIO_SERVICES' ? 'GIO Services & Infrastructure' : tgt?.name || imp.targetProjectId}
  </div>

  {/* Explanation (brighter text) */}
  <div className="text-xs text-gray-300 leading-relaxed mb-3 line-clamp-3">
    {imp.explanation}
  </div>

  {/* Badges: severity + GIO services only (no impact type) */}
  <div className="flex gap-1.5 flex-wrap">
    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
      style={{ background: `${sevColor}22`, color: sevColor }}>
      {imp.severity}
    </span>
    {imp.gioServices && imp.gioServices.map(svc => (
      <span key={svc} className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-900/30 text-purple-300 border border-purple-800/50">
        {svc}
      </span>
    ))}
  </div>
</div>
```

### Task 2.5: Update filter logic — remove impact type filtering
**File:** `src/components/ImpactView.tsx` lines 186-193  
**Change:** In the `filtered` useMemo, simplify the `filterType` logic to only handle GIO services (remove the `else` branch that checks `impactType`).

```tsx
// BEFORE (lines 187-193)
if (filterType !== 'All') {
  if (filterType.startsWith('GIO_')) {
    const svc = filterType.replace('GIO_', '');
    if (!imp.gioServices?.includes(svc)) return false;
  } else {
    if (imp.impactType !== filterType) return false;
  }
}

// AFTER
if (filterType !== 'All') {
  const svc = filterType.replace('GIO_', '');
  if (!imp.gioServices?.includes(svc)) return false;
}
```

### Task 2.6: Clean up unused constants
**File:** `src/components/ImpactView.tsx` lines 23-33  
**Change:** Remove the `TYPE_LABELS` constant since impact type is no longer displayed.

---

## Part 3: Shared — Optional CSS enhancements

### Task 3.1: (Optional) Add card glow animation on hover
**File:** `src/app/globals.css`  
**Change:** Add a subtle glow transition class that can be used on both views.

```css
/* Add after .animate-fadeIn */
.card-glow:hover {
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.08);
}
```

---

## Execution Order
1. Tasks 1.1, 1.2, 1.3, 1.4, 1.5 (DetailView — can be done in sequence in one file)
2. Tasks 2.6, 2.5, 2.1, 2.2, 2.3, 2.4 (ImpactView — one file, clean up first then restructure)
3. Task 3.1 (CSS — optional polish)

## Files Modified
- `src/components/DetailView.tsx`
- `src/components/ImpactView.tsx`
- `src/app/globals.css` (optional)
