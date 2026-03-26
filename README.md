# Broadridge Site Scanner

DOM-first live site scanner for Broadridge FA sites. Validates links, CTAs, layout, and compares **original vs migrated** sites.

## What It Does

- Navigates every page on a Broadridge site using Playwright
- Extracts a structured **JSON snapshot** of each page: links, CTAs, sections, forms, images, menu, contact info, layout metrics
- **Validates every link** (HEAD requests, flags 404s/5xx)
- **Validates every CTA** (clicks buttons, records where they actually navigate)
- Runs **61 rule-based assertions** from the QA ground rules checklist
- **Compares two different sites** — original vs migrated — section by section
- Generates an **HTML report** and optional **CSV** for Google Sheets

## Quick Start

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Scan a single site
npm run dev -- scan www.blankequity.com

# Compare original vs migrated (the main use case)
npm run dev -- compare-sites \
  --original www.blankequity.com \
  --migrated blankequity.wixsite.com/migrated
```

## CLI Commands

### `scan` — Audit a single site

```bash
npm run dev -- scan <domain> [options]

Options:
  -l, --label <label>          Scan label (default: "scan")
  -v, --viewports <list>       Comma-separated: desktop,tablet,mobile (default: all)
  -s, --screenshots            Capture per-section screenshots
  -c, --concurrency <n>        Parallel link validation (default: 10)
  -t, --timeout <ms>           Page load timeout (default: 30000)
  --auth <token>               Auth token for BR Source API
  -o, --output <dir>           Output directory (default: ./scans)
  --csv                        Also export CSV
```

### `compare-sites` — Original vs Migrated

The primary use case. Scans both sites, then diffs them.

```bash
npm run dev -- compare-sites \
  --original www.blankequity.com \
  --migrated blankequity.wixsite.com/migrated \
  --csv
```

This produces:
```
scans/compare-<timestamp>/
├── original/
│   └── snapshot.json
├── migrated/
│   └── snapshot.json
└── comparison/
    ├── report.html
    └── report.csv
```

### `compare` — Before/After Snapshots

Compare two previously captured snapshots of the same site.

```bash
# Step 1: Scan before
npm run dev -- scan www.blankequity.com --label before

# Step 2: Run fix scripts...

# Step 3: Scan after
npm run dev -- scan www.blankequity.com --label after

# Step 4: Compare
npm run dev -- compare \
  --before ./scans/www.blankequity.com/<timestamp>/snapshot.json \
  --after  ./scans/www.blankequity.com/<timestamp>/snapshot.json
```

## What Gets Compared (Original vs Migrated)

| Category | What's Checked |
|----------|---------------|
| Links | Every link's href, text, target attribute, HTTP status |
| CTAs | Button destinations, navigation behavior |
| Sections | Presence, visibility, height, bg color, text color, content |
| Menu | Item names, order, sub-items, dropdown arrows |
| Forms | Form types, prohibited forms flagged |
| Images | Link preservation, upscaling, distortion |
| Contact | Phone, email, address consistency |
| Layout | Horizontal scroll, font sizes, padding, text overflow |

## Architecture

```
INPUT: Two domains (original + migrated)
  ↓
PHASE 1: Crawl & extract structured JSON snapshot per site
  ↓
PHASE 2: Validate (links, CTAs, 61 ground rules)
  ↓
PHASE 3: Compare snapshots — match by page path/title
  ↓
PHASE 4: HTML + CSV report
```

## Project Structure

```
src/
├── index.ts                  # CLI entry point
├── scanner.ts                # Main scan orchestrator
├── config.ts                 # Viewports, selectors, thresholds
├── crawler/
│   ├── page-discovery.ts     # Find pages from API or nav menu
│   ├── link-collector.ts     # Extract all <a> links
│   ├── cta-collector.ts      # Extract buttons / CTAs
│   ├── section-inspector.ts  # Section styles & dimensions
│   ├── form-detector.ts      # Classify forms
│   ├── image-auditor.ts      # Image quality & links
│   ├── menu-analyzer.ts      # Menu structure
│   ├── contact-extractor.ts  # Contact info
│   └── layout-measurer.ts    # Padding, overflow, fonts
├── validators/
│   ├── link-validator.ts     # HEAD request all links
│   ├── cta-validator.ts      # Click-test CTAs
│   └── rules-engine.ts       # 61 ground rule assertions
├── comparison/
│   ├── snapshot-differ.ts    # Diff two snapshots
│   └── site-comparer.ts      # Orchestrate cross-site compare
├── reporters/
│   ├── html-reporter.ts      # Interactive HTML report
│   └── csv-reporter.ts       # CSV for Google Sheets
├── api/
│   └── site-fetcher.ts       # BR Source API client
├── utils/
│   ├── playwright-helpers.ts # Browser management
│   └── fs-helpers.ts         # File I/O
└── types/
    └── index.ts              # All TypeScript interfaces
```

## Ground Rules Coverage

The scanner implements **61 automated checks** mapped from the QA checklist:
- **55 Vanilla site rules** (V1-V55)
- **14 Flex/Deprecated site rules** (F1-F14)

Categories: Forms, Images, Mobile, Links, Menu, Footer, Hero, Contact, Map, Sections, Callout, Social, Team, Typography, Spacing

## Requirements

- Node.js 18+
- Playwright (Chromium)
