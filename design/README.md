# Website redesign — for approval

**Status: approved and promoted.** The ledger design is now the live site (`site/`),
with tab-first copy and the hero status card removed per the review. `design/v2/` is kept
as the source of record; promote again with `cp -r design/v2/* site/`.

## What's here

| Path | What it is |
|---|---|
| `v2/index.html` | The proposed homepage |
| `v2/assets/style.css` | Hand-written stylesheet (no framework, no webfonts) |
| `deck.html` | Nine-slide approval deck (arrow keys, `P` to print) |
| `assets/tabbary-redesign-deck.pdf` | The same deck as a PDF, for reading offline |
| `assets/before.png` / `after.png` | The comparison screenshots used in the deck |
| `shoot.mjs` | Regenerates the screenshots (headless) |
| `audit.mjs` | Geometry audit: overflow, spill, oversized elements |
| `pdf.mjs` | Regenerates the deck PDF |

## Direction: "the ledger"

The v1 page is warm, soft, and card-based. This proposal is ruled, serif-led, and
high-contrast — closer to a technical journal than a SaaS landing page.

- **Palette:** cream paper `#F4F1E8`, ink `#14181F`, vermillion `#C8402A` as the single
  accent, moss `#3F6B4F` for "done" states.
- **Type:** Iowan/Palatino display, system sans body, mono for labels and keycaps. All
  system fonts — no webfont requests, no layout shift.
- **Structure:** four numbered sections separated by hairline rules; no cards-with-shadows.
- **Motion:** colour transitions on hover only; everything respects `prefers-reduced-motion`.

## Verification

Rendered headlessly at 1440, 1024 and 390 px:

| Width | Page overflow | Spilling elements | Oversized elements |
|---|---|---|---|
| 1440 | 0 | 0 | 0 |
| 1024 | 0 | 0 | 0 |
| 390 | 0 | 0 | 0 |

No external requests except the three GitHub links. Both HTML files pass a tag-balance
check.

## Promoting it

Once approved:

```bash
rm -rf site && cp -r design/v2 site
git add -A && git commit -m "Site: adopt the ledger design"
git push          # Pages workflow republishes
```

The Pages workflow only triggers on `site/**`, so committing `design/` alone does not
change the live site.

## Open questions

1. ~~Direction~~ → **adopted: ledger.**
2. ~~Status card~~ → **removed**, replaced by a four-item facts strip.
3. ~~Sync in the listing~~ → **included**, documented as self-hosted with a hosted option.

See the deck for the reasoning behind each.

## Icons

`design/icons/build.mjs` renders the mark at 16/32/48/128 plus store promo tiles, all
headless. The glyph is three tab rows with the live one marked — rows of tabs, one active.

| File | Use |
|---|---|
| `public/icons/icon{16,32,48,128}.png` | Extension + toolbar |
| `public/icons/mark.svg` | Site favicon and docs |
| `design/assets/promo-1280x800.png` | Chrome Web Store promo tile |
| `design/assets/promo-440x280.png` | Small promo tile |
| `design/assets/icon-sheet.png` | Review sheet across sizes |

Rendered under 3 KB for the 128px icon; alpha verified at the corners so it sits correctly
on light and dark toolbars.
