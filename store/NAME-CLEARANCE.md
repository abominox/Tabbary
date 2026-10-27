# Name clearance record — Tabbary

**Date:** 27 October 2026
**Status:** usable, with one manual step still outstanding (USPTO/EUIPO database search).

This is a record of what was actually checked, so the decision can be audited later.
It is **not legal advice**, and it does not replace a trademark search by a professional
if the project ever takes money or a company name.

---

## Why the name changed

The previous name, *Windrow*, described nothing about the product. *Tabbary* is
tab + *-bary* (as in **library**, **apiary**, **aviary**): the place the tabs are kept.
It reads as a tab manager before you read the description.

## Collisions found and rejected

The browser-extension namespace is extremely crowded. These were found while
shortlisting and caused their candidate to be dropped:

| Candidate | Why rejected |
|---|---|
| TabSill | Live competitor, launched 13 Oct 2026 — "save & restore your tabs. On your machine, not a server." Nearly identical positioning. |
| TabFold | Live competitor: grouping, suspend, sessions, export. |
| TabPark / TabStash / Tabblar / Tabbiy / Tabby / Tab Deck / Tabery / TabFlow / TabStocker / TabBurrow / TabBandit | All in use as tab-management products. |
| Tabstand | `.com` registered 2010. |
| Tabstow | `.com` registered Aug 2025. |
| tabstack, tabnest, tabrow, tabwise, tabfolio, tabkeeper, tabrail | GitHub name already taken. |
| sheaf, quire, bindery, ream, trove, corral, muster, cairn, endpaper, flyleaf | Taken on npm and/or GitHub. Common literary nouns are exhausted. |

## Mechanical checks on "Tabbary" — all clear

| Channel | Result |
|---|---|
| npm registry (`tabbary`) | Unregistered (HTTP 404) |
| `tabbary.com` / `.dev` / `.app` / `.org` | Unregistered (RDAP 404 on all four) |
| `tabbary.io` | Available |
| `github.com/tabbary` | Free; no user or org |
| Chrome Web Store | No extension named Tabbary found |
| General web / Product Hunt | No software product named Tabbary found |

## What "Tabbary" actually is, and why that helps

"Tabbary" is not a coined word — it is one of several transliterations of the Arabic
surname **Tabari** (also rendered Tabary, Tabbari). It is used by unrelated businesses:
a Dubai plastics wholesaler ("Al Tabbari Trading") and a small Amazon jewellery brand.

Two consequences:

1. **No software collision.** None of those are in Class 9 software or Class 42 SaaS, so
   there is no product-market overlap.
2. **The word is weak as a mark.** Surnames and their spelling variants are generally
   hard to monopolise. That cuts both ways: it makes the name low-risk to *use*, but it
   would be hard to *defend* if the project ever wanted exclusivity. For a free MIT
   extension that is an acceptable trade.

The nearest phonetic neighbour in the same market is **Tabery** (a Japanese retail-tech
company, formerly Tabery Co., Ltd., now 10X). It is not a tab manager, and the spellings
and goods differ, so likelihood of confusion is low — but it is the name to watch.

## What was NOT checked

**USPTO (TESS/TSDR) and EUIPO could not be queried.** Both block automated access:
USPTO's public search requires a browser session and its legacy API endpoints return
`NoSuchKey`/`401`; EUIPO's eSearch is a JS application that refused connection from this
environment. A web search is **not** a substitute for either database.

**Outstanding manual step, before publishing:**

1. Search [tmsearch.uspto.gov](https://tmsearch.uspto.gov) for `TABBARY`, and for
   `TABARY` / `TABBARI`, in **Class 9** (downloadable software, browser extensions) and
   **Class 42** (SaaS). Look for live marks and pending applications.
2. Repeat on [EUIPO eSearch](https://euipo.europa.eu/eSearch/) and, if selling in the UK,
   the UKIPO register.
3. If any live mark appears in Class 9 or 42, treat the name as blocked and revisit.

## Residual risk, stated plainly

- Risk of a **software** trademark conflict: low, based on everything that could be
  searched. No product uses this name in this market.
- Risk of a **phonetic** conflict with `Tabery`/`Tabbiy`/`Tabby` in search results: real
  but modest. Distinctive logo and the "tab manager" descriptor mitigate it.
- Risk from the **unsearched databases**: unknown until step 1–3 above are done. This is
  the reason the store checklist still has an open item for trademark clearance.

Because the extension has not been published, renaming again costs one commit. After
publication, a rename means a new store listing and losing accumulated reviews — which is
why this is worth finishing before submitting.
