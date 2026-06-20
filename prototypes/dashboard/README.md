# Dashboard Redesign — Concept Mockups

Static, self-contained mockups exploring a modern/futuristic redesign of the
`/dashboard` page. Palette + system item-type colors mirror the real app
(`themes.generated.css`, `constants.ts`). Same data as the current dashboard.

## View

```bash
cd prototypes/dashboard
python3 -m http.server 8899
# open http://localhost:8899 and use the tab switcher (top-right)
```

## Concepts

| Tab | Concept | Vibe |
|-----|---------|------|
| A | **Aurora Bento** | Glass bento grid, aurora glows, conic usage ring, type bars |
| B | **Command Deck** | Neon HUD / terminal, mono readouts, corner brackets, segmented type bar |
| D | **Orbital Core** | Glowing core + item-type nodes orbiting on rotating rings |
| E | **Spatial Depth** | visionOS frosted-glass panels with real depth + sheen |
| F | **Mission Control** | Analytics cockpit: sparkline KPIs, activity heatmap, type donut |
| G | **Neon Grid** | Synthwave: neon outlines, perspective grid horizon, mono type |
| H | **Editorial** | Swiss/typographic: oversized numerals, asymmetric grid, hairlines |
| K | **Holographic** | Iridescent animated foil borders, glossy dark cards |

Screenshots: `concept-*.png`. (Spotlight, an earlier minimal concept, was dropped.)

## Modern techniques used (Tailwind v4-aligned)

- `conic-gradient` / `radial-gradient` (usage ring, donut, holographic foil)
- `backdrop-filter` glassmorphism + gradient hairline borders via `mask-composite`
- `@property` animated angle for the holographic rotation
- CSS `perspective` grid floor, radial masks for aurora glow + dot-grid
