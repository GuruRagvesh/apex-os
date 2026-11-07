---
version: alpha
name: Apex OS
description: >
  Design rules for Apex OS, TechnoEdge's all-in-one business OS (Operations, HR, Sales CRM).
  Calm, dense and legible. It writes down the UI that already ships (Codex's current look)
  so that every new feature matches it without later UI fixes. Draft v0.1, proposed and
  not yet applied in code. Light values are the base tokens; every "-dark" token is the
  John Wick Dark value for the same role.

colors:
  # Brand / action (follows the user's accent choice; Royal Blue is the default)
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  primary-text: "#1e40af"
  primary-subtle: "#eef4ff"
  on-primary: "#ffffff"
  primary-dark: "#2563eb"
  primary-hover-dark: "#3b82f6"
  primary-text-dark: "#60a5fa"
  primary-subtle-dark: "#14203a"

  # Surfaces: page < card < modal
  page: "#f0f7ff"
  surface-sidebar: "#ffffff"
  surface-card: "#ffffff"
  surface-elevated: "#ffffff"
  surface-sunken: "#f8fafc"
  surface-hover: "#f1f5f9"
  page-dark: "#050505"
  surface-sidebar-dark: "#0d0d0f"
  surface-card-dark: "#151518"
  surface-elevated-dark: "#1c1c20"
  surface-sunken-dark: "#0a0a0c"
  surface-hover-dark: "#1f1f23"

  # Text and ink
  text-primary: "#0f172a"
  text-secondary: "#475569"
  text-tertiary: "#52617a"
  ink-strong: "#173f70"
  ink-muted: "#5a7290"
  text-primary-dark: "#fafafa"
  text-secondary-dark: "#c4c4cc"
  text-tertiary-dark: "#a1a1aa"
  ink-strong-dark: "#fafafa"
  ink-muted-dark: "#c4c4cc"

  # Borders
  border-card: "#bcd5f5"
  border-card-subtle: "#dbe8f8"
  border-control: "#cbd5e1"
  border-divider: "#e2e8f0"
  border-card-dark: "#2f2f35"
  border-card-subtle-dark: "#242429"
  border-control-dark: "#3f3f46"
  border-divider-dark: "#27272a"

  # Meaning colours: one family each. "-text" is for words, "-fill" for dots/bars/solid chips.
  success-text: "#047857"
  success-fill: "#10b981"
  success-bg: "#ecfdf5"
  warning-text: "#b45309"
  warning-fill: "#f59e0b"
  warning-bg: "#fffbeb"
  danger-text: "#b91c1c"
  danger-fill: "#ef4444"
  danger-bg: "#fef2f2"
  info-text: "#1e40af"
  info-fill: "#3b82f6"
  info-bg: "#eff6ff"
  neutral-text: "#475569"
  neutral-bg: "#f1f5f9"
  success-text-dark: "#34d399"
  success-bg-dark: "#0f2a22"
  warning-text-dark: "#fbbf24"
  warning-bg-dark: "#2e2410"
  danger-text-dark: "#f87171"
  danger-bg-dark: "#2e1414"
  info-text-dark: "#60a5fa"
  info-bg-dark: "#14203a"
  neutral-text-dark: "#c4c4cc"
  neutral-bg-dark: "#1f1f23"
  review-text: "#6d28d9"
  review-fill: "#8b5cf6"
  review-bg: "#f5f3ff"
  review-text-dark: "#a78bfa"
  review-bg-dark: "#221a3a"

  # Analytics only: chart series, in this order. Never used for UI chrome or status.
  chart-1: "#2563eb"
  chart-2: "#0d9488"
  chart-3: "#d97706"
  chart-4: "#7c3aed"
  chart-5: "#db2777"
  chart-6: "#64748b"
  chart-1-dark: "#60a5fa"
  chart-2-dark: "#2dd4bf"
  chart-3-dark: "#fbbf24"
  chart-4-dark: "#a78bfa"
  chart-5-dark: "#f472b6"
  chart-6-dark: "#94a3b8"

  # Command surfaces (Ctrl+K, announcements): navy in both themes
  command: "#0b1220"
  on-command: "#e2e8f0"

typography:
  page-title:
    fontFamily: Hyperlegible Sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
  section-title:
    fontFamily: Hyperlegible Sans
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  card-title:
    fontFamily: Hyperlegible Sans
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: Hyperlegible Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  ui:
    fontFamily: Hyperlegible Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: Hyperlegible Sans
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.45
  button:
    fontFamily: Hyperlegible Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1
  meta:
    fontFamily: Hyperlegible Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: Hyperlegible Sans
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.35
  eyebrow:
    fontFamily: Hyperlegible Sans
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0.04em
  kpi-value:
    fontFamily: Hyperlegible Sans
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.1
  nav-item:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4

rounded:
  control: 8px
  card: 16px
  panel: 24px
  full: 9999px

spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "6": 24px
  "8": 32px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    height: 36px
    padding: 0 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    height: 36px
    padding: 0 16px
  button-secondary-dark:
    backgroundColor: "{colors.surface-card-dark}"
    textColor: "{colors.text-primary-dark}"
  button-ghost:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    height: 36px
  button-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.control}"
    height: 36px
  button-danger-dark:
    backgroundColor: "{colors.danger-bg-dark}"
    textColor: "{colors.danger-text-dark}"
  button-sm:
    height: 32px
    padding: 0 12px
  button-lg:
    height: 40px
    padding: 0 20px
  input:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 36px
    padding: 0 12px
  input-dark:
    backgroundColor: "{colors.surface-sunken-dark}"
    textColor: "{colors.text-primary-dark}"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: 24px
  card-dark:
    backgroundColor: "{colors.surface-card-dark}"
    textColor: "{colors.text-primary-dark}"
  modal:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.panel}"
    padding: 24px
  modal-dark:
    backgroundColor: "{colors.surface-elevated-dark}"
    textColor: "{colors.text-primary-dark}"
  badge-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  badge-success-dark:
    backgroundColor: "{colors.success-bg-dark}"
    textColor: "{colors.success-text-dark}"
  badge-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  badge-warning-dark:
    backgroundColor: "{colors.warning-bg-dark}"
    textColor: "{colors.warning-text-dark}"
  badge-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  badge-danger-dark:
    backgroundColor: "{colors.danger-bg-dark}"
    textColor: "{colors.danger-text-dark}"
  badge-info:
    backgroundColor: "{colors.info-bg}"
    textColor: "{colors.info-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  badge-info-dark:
    backgroundColor: "{colors.info-bg-dark}"
    textColor: "{colors.info-text-dark}"
  badge-neutral:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  badge-neutral-dark:
    backgroundColor: "{colors.neutral-bg-dark}"
    textColor: "{colors.neutral-text-dark}"
  nav-item-active:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.primary-text}"
    typography: "{typography.nav-item}"
    rounded: "{rounded.control}"
  nav-item-active-dark:
    backgroundColor: "{colors.primary-subtle-dark}"
    textColor: "{colors.primary-text-dark}"
  badge-review:
    backgroundColor: "{colors.review-bg}"
    textColor: "{colors.review-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  badge-review-dark:
    backgroundColor: "{colors.review-bg-dark}"
    textColor: "{colors.review-text-dark}"
  chip-neutral:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  chip-neutral-dark:
    backgroundColor: "{colors.neutral-bg-dark}"
    textColor: "{colors.text-secondary-dark}"
  page-header:
    typography: "{typography.page-title}"
    textColor: "{colors.text-primary}"
    padding: 0 0 24px
  table-header:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.meta}"
    height: 40px
    padding: 0 12px
  table-header-dark:
    backgroundColor: "{colors.surface-sunken-dark}"
    textColor: "{colors.text-secondary-dark}"
  table-row:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    typography: "{typography.ui}"
    height: 44px
    padding: 0 12px
  table-row-dark:
    backgroundColor: "{colors.surface-card-dark}"
    textColor: "{colors.text-primary-dark}"
  table-row-hover:
    backgroundColor: "{colors.surface-hover}"
  tab-active:
    textColor: "{colors.primary-text}"
    typography: "{typography.label}"
    height: 36px
  tab-active-dark:
    textColor: "{colors.primary-text-dark}"
  select:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 36px
    padding: 0 32px 0 12px
  checkbox:
    rounded: "{rounded.control}"
    size: 16px
  switch:
    rounded: "{rounded.full}"
    width: 32px
    height: 18px
  avatar:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.primary-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    size: 32px
  kpi-tile:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    typography: "{typography.kpi-value}"
    rounded: "{rounded.card}"
    padding: 16px
  kpi-tile-dark:
    backgroundColor: "{colors.surface-card-dark}"
    textColor: "{colors.text-primary-dark}"
  empty-state:
    textColor: "{colors.text-secondary}"
    typography: "{typography.ui}"
    padding: 48px 16px
  toast:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: 12px 16px
    width: 360px
  toast-dark:
    backgroundColor: "{colors.surface-elevated-dark}"
    textColor: "{colors.text-primary-dark}"
  tooltip:
    backgroundColor: "{colors.command}"
    textColor: "{colors.on-command}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: 6px 8px
  drawer:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.panel}"
    padding: 24px
    width: 480px
  drawer-dark:
    backgroundColor: "{colors.surface-elevated-dark}"
    textColor: "{colors.text-primary-dark}"
  kanban-column:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.card}"
    padding: 8px
  kanban-column-dark:
    backgroundColor: "{colors.surface-sunken-dark}"
  kanban-card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    typography: "{typography.ui}"
    rounded: "{rounded.card}"
    padding: 12px
  kanban-card-dark:
    backgroundColor: "{colors.surface-card-dark}"
    textColor: "{colors.text-primary-dark}"
  command-palette:
    backgroundColor: "{colors.command}"
    textColor: "{colors.on-command}"
    rounded: "{rounded.panel}"
---

# Apex OS Design System

> **Status: v1.0, agreed 2026-11-04.** Foundations are applied in `frontend/app/globals.css`
> and `frontend/tailwind.config.ts` (see *In code* at the end). Where a rule differs from
> what shipped before, it is marked **(fix)**.

## Overview

Apex OS is a work tool that people keep open all day: tickets, attendance, leave,
projects, assets and a Sales CRM in one place. The UI must feel **calm, dense and
predictable**, so that a product with many features still feels simple.

**The personality:** light blue-tinted pages, white cards with a soft blue edge, one accent
colour, and readable Hyperlegible Sans. In dark mode ("John Wick Dark") the same layout sits on
near-black zinc surfaces.

**Five principles, borrowed from how the best all-in-one suites treat their users:**

1. **Learn once, use everywhere (Odoo).** Every list page and every record page has the same
   skeleton. Someone who knows Tickets already knows Leads, Employees and Assets.
2. **Show people only their part (Zoho One).** Group navigation by role and purpose. Hide what a
   role cannot use instead of showing it disabled.
3. **Keep the daily action one click away (Bitrix24).** Start work, breaks and punch stay small and
   always visible. Never add clutter to make room for them.
4. **Quiet screens make important things loud (Frappe/ERPNext).** Neutral surfaces. Colour appears
   only when it means something.
5. **A glance tells the story (monday.com).** Status is shown as a word plus one meaning-colour,
   and it reads the same on every page.

**Same shape, different light.** Both themes share every size, spacing, radius, weight and layout
rule. Only colour tokens change between light and dark, so switching themes never feels like
arriving somewhere else.

## Colors

### How colour works
- Code **never uses hex codes or raw Tailwind palette colours** (`bg-indigo-600`, `text-rose-500`).
  It uses **tokens**: CSS variables in `frontend/app/globals.css`, exposed to Tailwind as
  `bg-apex-*` / `text-apex-*`.
- Every token is a **pair**. The light value is the token above, and the dark value is the same
  name with `-dark`. In CSS both live under one variable name, and `html[data-theme]` picks the value.
- **Colour budget:** 1 accent + 5 meanings (success, warning, danger, info, neutral) + neutrals.
  A colour outside this set needs a design decision and an update to this file first.

### Roles
| Role | Light | Dark | Use it for |
|---|---|---|---|
| `primary` (accent) | `#2563eb` | `#2563eb` | The one main button, links, focus ring, selected item |
| `primary-text` | `#1e40af` | `#60a5fa` | Accent-coloured *words* (links, active tab text) |
| `primary-subtle` | `#eef4ff` | `#14203a` | Selected row, active nav background |
| `page` | `#f0f7ff` | `#050505` | App background behind cards |
| `surface-card` | `#ffffff` | `#151518` | Cards, tables, panels |
| `surface-elevated` | `#ffffff` | `#1c1c20` | Modals, dropdowns, popovers |
| `surface-sunken` | `#f8fafc` | `#0a0a0c` | Inputs, inset areas |
| `text-primary` | `#0f172a` | `#fafafa` | Headings, main content |
| `text-secondary` | `#475569` | `#c4c4cc` | Labels, descriptions, table meta. Dark is a bright grey so labels feel fresh, not dull. |
| `text-tertiary` | `#52617a` | `#a1a1aa` **(fix)** | Quiet labels, placeholders, disabled text. Still readable (6.3:1 / 7.1:1). |
| `ink-strong` | `#173f70` | → `text-primary` | Codex's navy headings on Home/calendar **(new token, same colour)** |
| `ink-muted` | `#5a7290` **(fix)** | → `text-secondary` | Codex's blue-grey labels. Today `#7890ae` fails contrast. |
| `border-card` | `#bcd5f5` | `#2f2f35` **(fix)** | The signature card edge: about 1.5:1 against its surroundings in **both** themes, enough to define the box without shouting. |
| `border-control` | `#cbd5e1` | `#3f3f46` | Inputs, secondary buttons |
| `border-divider` | `#e2e8f0` | `#27272a` | Lines between rows and sections |

### Meaning colours: one family each **(fix)**
| Meaning | Family | Text (light / dark) | Fill | Badge background (light / dark) |
|---|---|---|---|---|
| Success, Done, Approved, Present | emerald | `#047857` / `#34d399` | `#10b981` | `#ecfdf5` / `#0f2a22` |
| Warning, Pending, Late, Due soon | amber | `#b45309` / `#fbbf24` | `#f59e0b` | `#fffbeb` / `#2e2410` |
| Danger, Rejected, Blocked, Absent, Overdue | red | `#b91c1c` / `#f87171` | `#ef4444` | `#fef2f2` / `#2e1414` |
| Info, In progress, Open | blue | `#1e40af` / `#60a5fa` | `#3b82f6` | `#eff6ff` / `#14203a` |
| Neutral, Closed, Cancelled, Draft | slate | `#475569` / `#c4c4cc` | `#94a3b8` | `#f1f5f9` / `#1f1f23` |
| In review (tickets) | violet | `#6d28d9` / `#a78bfa` | `#8b5cf6` | `#f5f3ff` / `#221a3a` |

- **Six colour families exist in the UI:** slate, blue, emerald, amber, red, violet.
  `green`, `teal`, `lime` → emerald. `rose`, `pink`, `fuchsia` → red. `orange`, `yellow` → amber.
  `gray`, `zinc`, `neutral`, `stone` → slate. `sky`, `cyan` → blue. `indigo`, `purple` → violet.
  The Tailwind config enforces this mapping, so an old class like `bg-green-100` already renders
  emerald.
- Violet means **"In review"** (and the CRM space marker). It is not a second accent.
- **Fill colours are never used for text.** For example, `#10b981` on white is 2.5:1 and unreadable.
- **Review** (tickets) and **priority** keep their existing tokens (`--priority-*`) and must
  still pass 4.5:1 for text in both themes.

### Analytics colours
Charts are the one place where more colours are allowed, and only inside the chart.
| Series | Light | Dark |
|---|---|---|
| 1 | `#2563eb` blue | `#60a5fa` |
| 2 | `#0d9488` teal | `#2dd4bf` |
| 3 | `#d97706` amber | `#fbbf24` |
| 4 | `#7c3aed` violet | `#a78bfa` |
| 5 | `#db2777` pink | `#f472b6` |
| 6 | `#64748b` slate | `#94a3b8` |

- Use series in this order. A chart with **more than 6 series groups the rest into "Other"**.
- A chart about one thing uses **one colour** (`chart-1`) with lighter steps, not a rainbow.
- When the chart *is* about meaning (on time / late / absent), use the meaning colours instead.
- Gridlines use `border-divider`, axis text uses `meta` in `text-secondary`, and numbers use
  `tabular-nums`. Every chart has a legend or direct labels, and a text summary of the key number.

### Workspaces
The Sales CRM moves onto these same tokens over time. Indigo survives only as a small
"Sales" space marker (an icon tint or tab dot), never as a second accent.

## Typography

- **Font:** Hyperlegible Sans everywhere. The left navigation alone uses Plus Jakarta Sans.
  No other fonts.
- **Six working sizes, nothing below 11px (fix).**

| Token | Size / weight | Tailwind | Use |
|---|---|---|---|
| `page-title` | 24 / 600 | `text-2xl font-semibold` | One per page, in PageHeader. Normal case **(fix)**: "Tickets", not "TICKETS". |
| `section-title` | 16 / 600 | `text-lg font-semibold` | Section and modal titles |
| `card-title` | 14 / 600 | `text-base font-semibold` | Card headers |
| `body` | 14 / 400 | `text-base` | Paragraphs, form fields |
| `ui` / `label` | 13 / 400 or 500 | `text-sm` | Most UI text, table cells, labels |
| `meta` | 12 / 400 | `text-xs` | Timestamps, helper text, table headers |
| `caption` | 11 / 500 | `text-caption` *(new)* | Badges, chips, tiny calendar labels. **The floor.** |
| `eyebrow` | 11 / 600, +0.04em, UPPERCASE | `text-caption uppercase` | The only place uppercase is allowed: tiny section labels |
| `kpi-value` | 30 / 700 | `text-3xl font-bold` | Big numbers on KPI tiles only |

- **Weights:** 400 text · 500 labels, buttons and menu · 600 titles · 700 KPI numbers only.
  `font-extrabold` and `font-black` are not used.
- **Banned:** arbitrary sizes like `text-[9px]` or `text-[10.5px]`, inline `fontSize`, and text under 11px.
- Users can scale everything with Settings → Font size (14 / 16 / 18px root), so sizes are `rem`
  in code.

## Layout

- **Spacing scale (4px grid):** 4 · 8 · 12 · 16 · 24 · 32 (`1 2 3 4 6 8` in Tailwind).
  - Inside a component (icon to label, chip gap): 4–8.
  - Between items in a card: 8–12.
  - Card padding: 24 (16 in compact mode or on mobile).
  - Between cards and sections: 16–24.
  - Page padding: 24 desktop, 16 mobile.
- **Every page uses the same skeleton:**

```
┌ Sidebar ┬──────────────────────────────────────────────────────────┐
│ (spaces │ TopBar: search (Ctrl+K) · workday clock · notifications · me │
│  & nav) ├──────────────────────────────────────────────────────────┤
│         │ PageHeader: breadcrumb                                    │
│         │   Page title            [secondary action] [Primary]      │
│         │   one-line description                                    │
│         │ Toolbar: search · filters · group/sort · view (List|Board|Cal) │
│         │ Content: cards / table / board                            │
└─────────┴──────────────────────────────────────────────────────────┘
```

- **Record pages** (ticket, lead, employee, project, asset): main content on the left, and an
  **Activity / History** panel on the right (stacked below on mobile).
- **Button placement:** page actions sit top-right. Modal and form footers go right-aligned
  `[Cancel] [Primary]`. Destructive actions go far-left in the footer or in a "More" menu.
- **Progressive disclosure:** show the essentials and put the rest behind tabs, "More" menus or
  drawers. A screen should have **one primary button**.
- **Responsive:** at 1024px the sidebar collapses to icons. Below 768px it becomes a drawer, and
  tables become cards or scroll inside their container. No horizontal page scroll. Touch
  targets are at least 40px on touch devices.

## Elevation & Depth

| Level | Light | Dark | Used for |
|---|---|---|---|
| 0 Page | `page` | `page-dark` | Background |
| 1 Card | white + `border-card` + soft shadow | `#151518` + `border-card-dark`, no visible shadow | Cards, tables |
| 2 Raised | `shadow-md` on hover | `surface-hover-dark` + `border-control-dark` | Hovered or clickable cards |
| 3 Floating | `surface-elevated` + `shadow-lg` | `#1c1c20` + `border-card-dark` | Dropdowns, popovers, modals |
| Overlay | `rgba(15,23,42,0.4)` scrim | `rgba(0,0,0,0.6)` scrim | Behind modals and drawers |

In dark mode, **depth comes from lighter surfaces and edges, not shadows**: page < card < modal,
each a step lighter. Focus is always a 3px `primary` ring at 35% opacity in both themes.

## Shapes

| Token | Radius | Use |
|---|---|---|
| `rounded-control` *(new name)* | 8px | Buttons, inputs, selects, small tiles |
| `rounded-card` *(new name)* | 16px | Cards, tables, KPI tiles |
| `rounded-panel` *(new name)* | 24px | Modals, drawers, the Home hero |
| `rounded-full` | pill | Badges, chips, avatars, toggles |

Today's config has a trap: `rounded-lg` is 24px but `rounded-xl` is 16px. The old names keep
working, so no screen moves, but **new code uses the role names**.

**Icons:** lucide-react only, outline, 1.5–2px stroke, colour `currentColor`. Sizes:
12 (inside badges) · 14 (inside buttons) · 16 (default) · 20 (card/section headers) ·
24 (empty states only).

## Components

Build every screen from these. If you need something that isn't here, add it to `shared/ui`
and to this file. Don't make a one-off.

| Component | Rules |
|---|---|
| **Button** | Variants: Primary, Secondary, Ghost, Danger. Sizes: sm 32 / **md 36 (default)** / lg 40. Icon 14–16 before the label. Icon-only buttons are square and need an `aria-label`. Press scale is 0.97. Disabled is 50% opacity. Danger always asks to confirm. |
| **Input / Select / Textarea** | Height 36, `surface-sunken`, `border-control`, 8px radius. Focus is a `primary` border plus ring. Label above (`label` style), help or error text below (`meta`, error in `danger-text`). |
| **Card / SectionCard** | `surface-card`, `border-card`, 16px radius, 24px padding. Optional header row: `card-title` on the left, actions on the right. |
| **PageHeader** | Breadcrumb, `page-title`, optional description, actions on the right. One per page. |
| **Toolbar / FilterBar** | Search on the left. Filters and sort, then the view switcher on the right. Same place on every list page. |
| **DataTable** | Header in `meta` 500 `text-secondary`, rows 44px (36 in compact), dividers `border-divider`, hover `surface-hover`. The empty state sits inside the table frame. |
| **StatusBadge** | `caption` size, pill, meaning-colour bg and text from the table above. **Always the word**, never colour alone. Sentence case ("In review"). |
| **KPI tile** | `card` + label (`label`) + `kpi-value` + one line of `meta` context ("8 due today"). |
| **Modal / Drawer** | Sizes sm 400 / md 560 / lg 720, or a right-side drawer of 480. Header title is `section-title`, footer `[Cancel] [Primary]`. Esc closes it and focus is trapped. |
| **Tabs** | Underline style, active in `primary-text` with a 2px `primary` bar. |
| **Avatar** | Round, sizes 24 / 32 / 40, initials when there's no photo. |
| **States** | Every data view has **Loading** (Skeleton in the final layout's shape), **Empty** (icon, one sentence and the next action), and **Error** (what failed and a Retry button). |
| **Toast** | Bottom-right. Success disappears after 4s; errors stay until closed. The message says what happened, not "Success!". |
| **Command palette** | One palette (Ctrl+K) for search and actions, navy `command` surface in both themes. |

## Colour policy

Colour is a budget. Atlassian's, Linear's and Notion's systems agree on one idea: **neutrals do the
everyday work, and colour appears only where it carries meaning**. Apex follows the same idea.

### The fixed palette
| Job | Colour | Notes |
|---|---|---|
| Brand / primary action | `primary` Royal Blue `#2563eb` | Main button, links, focus ring, selected item. |
| Surfaces and text | slate neutrals + white | Everything that is not a signal. |
| Meaning | emerald, amber, red, blue (info), slate (neutral), violet (in review) | Status only, as small indicators. |
| Analytics | `chart-1` … `chart-6` | Inside charts only. |

No other colour enters the UI without a change to this file.

### Where colour is allowed
**Colour zones.** These areas may be colourful, because the colour *is* the information:
- The **Home hero** (time-of-day sky) and its quick-action buttons.
- **Charts and analytics** (chart palette).
- **Calendars**: attendance and holiday day cells, the timeline segments.
- **KPI tiles**: one small tinted icon square per tile; the number stays `text-primary`.
- **Sticky notes** and other user-chosen colours, and **avatars**.

**Everywhere else is neutral.** Cards, lists, tables, boards, forms, drawers and settings use
white/`surface-card` surfaces, slate text and `border-card` edges. Colour may appear only as:
- the **accent** on the one primary action, the selected item, links and focus;
- **small meaning indicators**: an 8px dot, a chip, an icon, or a short coloured word.

### Rules
1. **Never tint a whole card, row or column** by status, priority or department. Use a dot or chip
   inside it. The only exception is a real alert state (an overdue or blocked item may get a
   `danger-bg` banner strip, not a coloured card).
2. **At most two coloured elements per card or row** (for example a priority icon and an
   overdue word). If a third wants colour, it becomes neutral.
3. **Categories are not meanings.** Departments, ticket types, projects and tags show as a
   neutral chip with a small coloured dot (8px), never a full-colour fill.
4. **No coloured side stripes** on cards, except the active nav item and a real alert.
5. **Priority**: Urgent = red icon and word, High = amber icon, Medium and Low = neutral. A
   priority is never shown by card background.
6. **No emoji as status** (🔥 ⚠️ ⏰). Use a lucide icon in the meaning colour.

### Board cards (Kanban), the reference case
The current board colours each card by status, priority stripe, department and emoji at once.
The target, to be applied when the board is fixed:
- **Column**: neutral background (`surface-sunken`), header = name in `card-title` + count in a
  neutral chip + one 8px status dot. No tinted column backgrounds.
- **Card**: `surface-card`, 1px `border-card`, `rounded-card`, 12px padding, no left stripe.
  - Row 1: ticket key (`meta`, `text-tertiary`), priority icon on the right only when High or Urgent.
  - Row 2: title, `ui` 13/500, up to two lines.
  - Row 3: assignee avatar (24px), due date in `meta` (`danger-text` only when overdue), one
    neutral type/department chip with a dot.
  - Overdue or blocked: one `danger` or `warning` word with an icon. No red border around the card.
- **Hover**: border to `accent-border` and `shadow-md`. **Dragging**: `shadow-lg`, 2° tilt at most.

## Patterns

### Forms
- One column by default. Two columns only for short paired fields (start/end date).
- Label above the field (`label` style), with an optional hint below in `meta`. Required fields
  get a short `*` after the label. Optional fields say "(optional)" instead when most are required.
- Field height 36px (`input` component), full width in its column, 16px between fields, 24px
  between groups. Group titles use `section-title`.
- Validate on blur and on submit, never on every keystroke. The error replaces the hint, in
  `danger-text` with an alert icon, and says how to fix it ("Enter a date after the start date").
- The submit button stays enabled; on submit with errors, focus moves to the first error.
- Footer: `[Cancel] [Primary]` on the right. While saving, the primary button shows a spinner and
  "Saving…", and the form is not submitted twice.
- Disabled fields use `surface-sunken` and `text-tertiary`, and say why in the hint when it isn't obvious.

### Tables and lists
- Header: `meta` 500, `text-secondary`, `surface-sunken` background, sticky on scroll.
- Rows 44px (36px compact), `border-divider` between rows, hover `surface-hover`, no zebra stripes
  unless the table is wider than 8 columns.
- Text left-aligned; numbers, durations and money right-aligned with `tabular-nums`.
- Long text truncates with an ellipsis and a tooltip; names never wrap to three lines.
- Sortable columns show the sort icon on hover and when active. Default sort is stated in the header.
- Row actions: a `…` menu at the row end; the most common action may be one ghost button.
- Bulk select: checkbox column on the left; a toolbar appears above the table with the count and actions.
- Pagination below the table: "1–25 of 312" plus prev/next. Lists over ~200 rows paginate or virtualise.
- Empty, loading and error states render inside the table frame (see Components → States).

### Navigation
- The sidebar groups pages by purpose: **My work**, **Team**, **HR**, **Operations**, **Sales**,
  **Admin**. A role sees only the groups and pages it can use.
- **One page, one name** everywhere: the sidebar label, the page title and the breadcrumb match.
  ("Tickets" is "Tickets" for every role; not "My Team Tasks" in one place.) A page appears once in the sidebar.
- Active item: `primary-subtle` background, `primary-text` label, 3px accent bar.
- Breadcrumbs on detail pages only: Section › Record. The last item is not a link.
- Global search and commands live in one palette (Ctrl+K). The top bar holds search, the workday
  clock, notifications and the profile menu, in that order.

### Feedback
| Situation | Pattern |
|---|---|
| An action worked | Toast, bottom-right, 4s: what happened ("Leave request sent to your team lead"). |
| An action failed | Toast that stays until closed, plus an inline error where possible: what failed and what to do. |
| A field is wrong | Inline error under the field (see Forms). Never a toast. |
| Something affects the whole page | Banner at the top of the content (`info`, `warning` or `danger` tint), with one action. |
| A destructive or irreversible action | Confirm dialog: title names the action ("Delete this ticket?"), body says the consequence, buttons `[Cancel] [Delete ticket]` with the danger button naming the action. |
| A long task | Progress in place (button spinner, progress bar); don't block the page. |

Never use `alert()`, `confirm()` or "Success!" / "Error!" alone.

### Iconography
- lucide only, outline, `currentColor`. Sizes from Shapes (12/14/16/20/24).
- An icon accompanies a label; **icon-only** buttons are allowed for universal actions (close,
  more, edit, delete, search) and always carry `aria-label` and a tooltip.
- Fixed pairs, used everywhere: success `CheckCircle2`, warning `AlertTriangle`, danger/error
  `AlertCircle`, info `Info`, overdue `Clock`, blocked `Ban`, review `Eye`, meeting `Users`,
  break `Coffee`, leave `Plane`, holiday `Star`.
- Icons are `text-secondary` by default; they take a meaning colour only when they *are* the status.

### Responsive behaviour
| Width | Behaviour |
|---|---|
| ≥ 1280 | Full layout, sidebar expanded. |
| 1024–1279 | Sidebar collapses to icons; record pages keep the side panel. |
| 768–1023 | Record side panel moves below the content; toolbars wrap to two rows. |
| < 768 | Sidebar becomes a drawer; tables become cards or scroll inside their frame; modals become full-height sheets; page padding 16px. |

- Touch targets are at least 40px. Hover-only actions get a visible alternative on touch.
- The Home calendar and timeline scroll inside their own frame on narrow screens; the page never scrolls sideways.

### Writing
- Sentence case for everything except the `eyebrow` style.
- Buttons are verbs that name the result: "Apply leave", "Start work", "Create ticket", "Save changes".
- Dates: `4 Nov 2026`; with weekday `Wed, 4 Nov`; times `09:42` (24-hour) in the company time zone;
  relative times only under 7 days ("5 min ago", "Yesterday").
- Durations `7h 45m`; counts abbreviate from 10,000 (`12.4k`); percentages without decimals unless under 10%.
- Empty states: what this place is for and the next step ("No tickets yet. Create one to get started.").
- Use the product's terms consistently: ticket, workday, punch, regularization, leave, department.

### Charts
- Bar for comparing categories, line for change over time, stacked bar for parts of a total over
  time, donut only for 2–4 parts of one total, never 3D or pie with more than 4 slices.
- One series uses `chart-1`; more series use the chart palette in order; meaning charts
  (on time / late / absent) use meaning colours.
- Axis labels `meta` in `text-secondary`, gridlines `border-divider`, no chart borders or backgrounds.
- Every chart has a title, a one-line takeaway ("Late punches down 12% from October"), and a legend or direct labels.
- Tooltips use `surface-elevated`, show the exact value and unit, and work with keyboard focus.

## Do's and Don'ts

**Do**
- Use tokens (`var(--…)`, `bg-apex-*`) and shared components for everything.
- Keep one primary button per screen and put it top-right.
- Show status as word + colour, in sentence case.
- Check every change in **light and dark**, at **desktop and 375px phone** width.
- Keep text at least 11px and contrast at least 4.5:1 in both themes.
- Write labels in plain words: "Apply leave", "Start work", "Request correction".
- Give every list a loading, empty and error state.

**Don't**
- Hard-code colours (`#173f70`, `bg-indigo-600`, `style={{ color: … }}`).
- Use arbitrary sizes (`text-[10px]`, `px-[13px]`, `size={15}`).
- Add a second accent colour, gradients or decorative colour.
- Write UPPERCASE page titles or uppercase badges.
- Use fill colours (`#10b981`, `#f59e0b`) as text colours.
- Fix dark mode with `!important` overrides. Give the token a dark value instead.
- Disable things a role can never use. Hide them.

## Craft: designed, not generated

AI tools build from the *average* of every app they have seen, so their output looks like
everything and nothing. Apex looks designed when every choice is **specific, restrained and
finished**. Three tests run on every screen:

1. **Specific:** could this screen belong to any other app? If yes, it is missing Apex's own
   details: real terms (ticket keys like `TKT-1042`, "Start work", "Regularization"), real data
   shapes (company time zone, shifts, leave balances), and the signature look below.
2. **Restrained:** is there **one** thing the eye goes to first? Every extra colour, effect or
   badge must answer "what does this tell the user?" If nothing, remove it.
3. **Finished:** does it handle the boring cases? Long names, zero, 1,250 items, no data, slow
   network, errors, phone width, dark mode.

### Signature elements (keep and protect these)
- Hyperlegible Sans: a readability face most apps don't use.
- White cards with the soft blue `border-card` edge on the blue-tinted `page`.
- Codex's navy ink (`ink-strong`) for Home and calendar headings.
- The always-visible workday clock, and attendance shown with real punch photos and times.
- Plain, operational copy in the user's own words ("Apply leave", "Request correction").

### AI tells: banned unless this file allows them
| Tell | Rule for Apex |
|---|---|
| Purple, indigo or pink gradients; gradient text | No decorative gradients. The Home hero's time-of-day sky is the one allowed exception. |
| Glass / `backdrop-blur`, glows, neon edges | Only behind overlays (modal scrim, sticky header). No coloured glow shadows. |
| Pulsing or bouncing things | Animate only **live** state: a running workday timer or live meeting. Static status never pulses. No bounce easing. |
| Emoji as icons or bullets | lucide icons only. Emoji are allowed only inside user-written content. |
| Pill badge above a headline; icon tile above every card title | Put the information in the headline; put the icon beside the title, without a box. |
| Identical card grids, cards inside cards | Group by importance. A card is for something the user acts on as a whole. Inside a card, use spacing and dividers, not more cards. |
| Coloured side stripes on cards | Only for real status (an overdue item, an alert). The active nav item is the one standing use. |
| Status dots with no meaning | Every dot maps to a defined state and has a text label or tooltip. |
| Hype copy ("AI-powered", "seamless", "unlock", "supercharge"), em-dash-heavy sentences | Say what the user can do and what happens. Short sentences. |
| Placeholder content (John Doe, Lorem ipsum, fake numbers) | Never. Use real data, or a designed empty state. |
| Decorative grids, blobs, spotlights, random illustrations | Plain surfaces. Imagery only when it carries information (a punch photo, a user avatar). |

### Finishing details that make it feel crafted
- **Numbers line up.** Times, durations, money and counts use `tabular-nums`. Durations always read the same way (`7h 45m`).
- **One date and time style** everywhere, from the shared company-date helpers, in the company time zone.
- **Headings wrap well:** `text-wrap: balance` on titles, `text-wrap: pretty` on paragraphs.
- **Grouping by distance:** items that belong together sit closer than the groups around them,
  and a heading sits nearer its own content than the block above.
- **Edges and baselines align** across sibling cards, so labels and values start at the same x.
- **Long text never breaks the layout:** names and titles truncate with a tooltip, counts abbreviate (`1.2k`), and nothing overflows its card.
- **Every number has context:** "8 due today", "+2 vs last week". No bare big numbers.
- **Dark mode is designed, not inverted:** its own surfaces, edges and text values (see Colors).
- **Copy sounds like a colleague:** "Your leave request was sent to your team lead", not "Request submitted successfully!".

## Accessibility

- Contrast is at least 4.5:1 for text and 3:1 for icons and control borders, **in both themes**.
- Every interactive element is reachable with Tab and shows a visible focus ring.
- Respect the user settings Apex already has: font size, compact mode, more contrast and
  reduced motion (`html[data-*]`). Never fight them with fixed pixel values or forced animation.
- Icon-only buttons have `aria-label`; images have `alt`; and status is never colour alone.

## Motion

Quick and quiet: 100ms (hover), 200ms (most), 350ms (drawers). Pages fade up 6px, modals
scale from 0.96 and drawers slide from the right. All of it switches off under reduced motion.

## Agent Guide

For Codex, Claude and any developer building UI in this repo:
1. Read this file before writing frontend code. **Blend in with the existing UI. Don't redesign.**
2. Build from `shared/ui` components and `.apex-*` classes. Use tokens, never hex codes.
3. Pick sizes only from the scales above (type, spacing, radius, icon, button).
4. For every new screen, include PageHeader, the states, and the light/dark and phone checks.
5. If a rule blocks a real need, propose a change to this file. Don't work around it.

## New feature checklist

Every new screen, panel or component passes this list before it is handed back. It is what
keeps a new feature looking like the rest of Apex without a later UI pass.

1. **Structure**: page starts with `PageHeader`; lists use the Toolbar + table/board patterns;
   record pages use content + Activity panel.
2. **Pieces**: built from `shared/ui` and `.apex-*` classes. A new reusable piece goes into
   `shared/ui` and gets a row in Components and a spec in the token section.
3. **Colour**: tokens only. Colour appears only in the allowed zones (Colour policy); everything
   else is neutral with small meaning indicators. At most two coloured elements per card or row.
4. **Type and spacing**: only scale values; 11px minimum; titles in normal case; weights 400–700.
5. **Both themes**: checked in light and dark. A CSS module with literal colours carries its dark
   values (Dark theme in feature CSS). Card edges use `border-card`.
6. **States**: loading, empty and error designed; long text, zero and large numbers handled.
7. **Responsive**: works at 375px without sideways page scroll.
8. **Words**: sentence case, verbs on buttons, product terms, dates and times in the house format.
9. **Check**: `npm run frontend:verify-design-rules` shows no new warnings for the changed files.

## Rollout

The order of the fixes. Each step is small and none redesigns a screen:
1. Add the missing tokens (ink colours, meaning colours with dark values, `text-caption`,
   role radii). No visual change.
2. Add the shared Button / PageHeader / SectionCard / StatusBadge / states, copying today's look.
3. Raise text under 11px, fix the failing contrast colours (`ink-muted`, `text-tertiary-dark`,
   `border-card-dark`), and switch page titles to normal case.
4. Add a warn-only rule checker for changed files in pull requests.
5. Move pages over one at a time, newest first. Remove the `!important` dark overrides as pages
   stop needing them.

**Decided:** weights 400/500/600/700, Codex's blue page tint stays, main actions on the right.

## In code

Where each rule lives, so new work picks it up automatically:

| Rule | Where | How to use it |
|---|---|---|
| Colour tokens, light + dark | `frontend/app/globals.css` (`DESIGN.md TOKENS` block, theme blocks) | `var(--success-text)`, `var(--ink-strong)`, `var(--chart-1)` |
| Six colour families | `frontend/tailwind.config.ts` (`paletteFamilies`) | `bg-green-100` renders emerald, `text-gray-500` renders slate, and so on |
| Meaning colours in Tailwind | `tailwind.config.ts` (`success`, `warning`, `danger`, `info`, `neutral`, `review`) | `text-success-text bg-success-bg`, `bg-danger-fill` |
| Ink and chart colours | `tailwind.config.ts` | `text-ink-strong`, `text-ink-muted`, `fill-chart-1` |
| 11px floor | `text-caption` (and `text-2xs`, now 11px) | `text-caption` for badges and tiny labels |
| Weights 400–700 | `font-extrabold` / `font-black` render as 700 | Use `font-medium`, `font-semibold`, `font-bold` |
| Radius by role | `rounded-control` 8, `rounded-card` 16, `rounded-panel` 24 | Old `rounded-lg` / `rounded-xl` still work |
| Page title | `.apex-page-title` (24/600, normal case) | Or `<PageHeader>` from `@apex/shared-ui` |
| Page header | `PageHeader` in `shared/ui/frontend/components/page-header.tsx` | `<PageHeader title description breadcrumb actions />` |
| Page padding | `frontend/app/(dashboard)/layout.tsx` `<main>` | 16px on phones, 24px from `sm` up |
| Buttons | `.apex-btn` + `-primary/-secondary/-ghost/-danger`, sizes `.apex-btn-sm` / default / `.apex-btn-lg`, `.apex-btn-icon` | 32 / 36 / 40px |
| Badges | `.apex-badge-success/warning/danger/info/neutral/review`, `StatusBadge` | Sentence case, `text-caption` |
| Eyebrow label | `.apex-eyebrow` | The only uppercase text |
| Rule checker | `npm run frontend:verify-design-rules` (`--all` for the whole app) | Warn-only, on changed files |
| Agent instructions | `AGENTS.md` (Codex), `CLAUDE.md` (Claude) | Both point here |

## Dark theme in feature CSS

Light and dark are tested together. A CSS module that still hard-codes light colours
(`#fff`, Codex's navy `#173f70`, blue-greys) must also carry dark values, or it shows up as
a white island in John Wick Dark. The rules:

- Prefer tokens (`var(--surface-card)`, `var(--ink-strong)`, `var(--success-text)`), which switch on their own.
- When a module keeps literal light colours, add its dark values at the end of the file under
  `:global(html[data-theme="john-wick-dark"]) .className { … }`. The Home timeline, Home
  calendar and My Attendance modules do this.
- Dark mapping: near-white surfaces → `#151518` (card) or `#1c1c20` (inset); pastel tints →
  the meaning tints (`#14203a` blue, `#0f2a22` green, `#2e2410` amber, `#2e1414` red, `#221a3a` violet,
  `#1f1f23` grey); navy text → `#fafafa`; blue-grey text → `#c4c4cc`; light borders → `#242429`
  or `#2f2f35`; saturated status fills stay as they are.
- Accent-coloured **words** use `var(--accent-text)`, never `var(--accent)`, so they stay readable on dark.
- White text sits only on fills of at least the 600 step (700 for green and amber).
- Status colours that come from data (attendance outcomes in `status-presentation.ts`, Kanban
  column colours) pass through `color-mix()` with `--status-tint-keep` / `--status-ink-keep`, so the
  written light values stay exact and dark mode gets a quiet tint plus a lighter, readable colour.
- Third-party widgets (FullCalendar, Recharts) are pointed at the tokens in `globals.css`.
- Grey labels: `slate-500` is `#52617a` (darker than stock Tailwind), and `--text-tertiary` matches
  it in light, so labels pass 4.5:1 on white and on tinted table headers.
- Avatars with a data-driven colour deepen it (`color-mix(... 55%, #0f172a)`) so white initials stay readable.
