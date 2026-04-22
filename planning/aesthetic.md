# BoardForge — Aesthetic Spec

## Identity

- **Working name**: BoardForge
- **Tone**: Warm, cozy, modern — evokes physical materials (paper, wood) without skeuomorphism. Friendly and inviting, not digital or arcadey.
- **Reference**: Dorfromantik

## Typography

| Role | Typeface |
|---|---|
| Body / UI | Nunito |
| Decorative / special cases (titles, room names) | Beleren |

## Color

### Light mode (default)
- **Base**: Cream (e.g. `#F5F0E8`)
- **Accent**: Terracotta

### Dark mode
- **Base**: Deep warm brown (e.g. `#1C1410`)
- **Surface step**: `#2A221A` for cards and panels
- **Accent**: Terracotta (unchanged from light mode)
- Dark mode must feel friendly and inviting — not cold or stark.

## Shape Language

- **Corner radius**: Playing card radius (~4–6px) — applied consistently across all components.

## Surfaces

| Context | Treatment |
|---|---|
| Lobby / menus / out-of-game UI | Faint warm paper texture + soft drop shadow |
| In-game floating panels | Flat, low-opacity dark background — no texture |

## Iconography

- Deferred — to be decided during visual design iterations.

## Motion

| Context | Style |
|---|---|
| In-game | Minimal and utilitarian — does not compete with the 3D scene |
| Out-of-game (lobby, menus) | Playful and delightful — moderate physics-influenced easing |

## In-Game Chrome

- Full-bleed 3D canvas at all times — UI panels float over the scene, never beside it.
- Panels must be clearly readable against any scene background.

## Density & Spacing

- **Default**: Moderate spacing across lobby and menus.
- **Host editing panel**: Slightly compact — it is a tool panel, efficiency takes priority.

## Lobby Structure

- **Hero layout** — prominent primary actions (Create Room / Browse Games) front and center.
- **Sticky header** — account, settings, and other nav options.
