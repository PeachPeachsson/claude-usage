# Provider marks

The Claude symbol comes from [LobeHub Icons](https://github.com/lobehub/lobe-icons), retrieved
2026-09-06. `codex.svg` was supplied directly by the project owner on 2026-09-07; its path data
is byte-identical to the LobeHub icon below, so both marks trace back to the same source.
OpenAI publishes no standalone Codex glyph of its own — the official VS Code extension and the
Codex docs both brand it with the OpenAI logomark plus the word "Codex".


- https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/claude.svg
- https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/codex.svg

Paths are unchanged. SVG dimensions are fixed to 24 × 24 and the fill is black so `expo-image` can
tint the bundled assets to match the selected tab — `currentColor` does not resolve outside a
document, and a missing `width`/`height` leaves the rasterizer without intrinsic dimensions. Do not
use a `viewBox` with a non-zero origin for padding: `expo-image` ignores the min-x/min-y offset and
shifts the artwork out of frame. No network requests are required to display them.

The `*-backdrop.svg` variants use the same paths with a diagonal alpha gradient for the decorative background treatment. Their colour is supplied by the app theme.

The upstream MIT license is included in LICENSE. Claude and Codex marks belong to their respective owners and identify the connected services, not the Usage app itself.
