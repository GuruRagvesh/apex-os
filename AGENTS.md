# Apex OS — notes for coding agents

## Frontend UI

Read [DESIGN.md](DESIGN.md) before writing or changing any screen. It is the UI rulebook for
light and dark themes: colour tokens, the type scale (nothing below 11px), weights, spacing,
corner radii, icon sizes, buttons, page layout and the "designed, not generated" craft rules.

- Blend in with the existing UI. Fix toward the rules; don't redesign screens.
- Use tokens (`var(--…)`, `bg-apex-*`, `text-success-text`, `rounded-card`) and shared pieces
  from `shared/ui` (`PageHeader`, `StatusBadge`, `EmptyState`, `Skeleton` …) and the `.apex-*`
  classes in `frontend/app/globals.css`. No hex codes or arbitrary sizes in feature code.
- New pages start with `<PageHeader title=… description=… actions=… />`.
- Check every change in light and dark, at desktop and phone width.
- Run `npm run frontend:verify-design-rules` before handing work back; it warns about rule
  breaks in the files you changed.
