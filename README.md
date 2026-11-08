# Headstart 20x

A single web page that reads an ISO/IEC 27001:2022 Statement of Applicability or a SOC 2 report and shows how far it gets you toward FedRAMP 20x Class B, C or D: where your programme gives you a head start, where it falls short, and what 20x adds on top.

It runs entirely in the browser. Nothing is uploaded, the page makes no network requests, and `dist/index.html` works when opened from disk. The copy published inside claude.ai adds two optional steps that ask Claude, on the viewer's own account and with their consent: reading a SOC 2 report's Section 4 into the form, and drafting a one-page readiness note from the result. The public site has neither and never contacts a model.

**Version 1.0.** Live at [mycroft-io.github.io/headstart-fedramp](https://mycroft-io.github.io/headstart-fedramp/). Built and maintained by [Mycroft](https://mycroft.io). Not a FedRAMP tool and not endorsed by FedRAMP. The mapping is Mycroft's own work and is open to review.

Sibling project: [Crosswalk 20x](https://github.com/Mycroft-io/crosswalk-rev5-to-20x) reads a finished 20x package for agency reviewers.

## What it does

1. **Reads an ISO SoA** from Excel, CSV or pasted rows, **or a SOC 2 report** from a short form: report type, period, Trust Services categories in scope, and the exceptions from Section 4 (one per line, starting with the criterion). Criteria in a category outside the report's scope read as gaps; an exception against a strongly related criterion flags the indicator.
   The SoA parser It finds the Annex A control IDs (A.5.1 to A.8.34), whether each control is applicable, and its implementation status where the SoA tracks one. 2013-numbered SoAs are rejected with a note.
2. **Reads it against the 46 Key Security Indicators** using `data/mapping.json`. Each indicator gets one state:

   | State | Meaning |
   |---|---|
   | Head start | Every strongly related Annex A control is applicable and implemented. Expect to re-evidence it in 20x terms. |
   | Partial | Some related controls are in place. |
   | Gap | None of the related controls are applicable and implemented. |
   | Excluded in SoA / Exception noted | ISO: a strongly related control is marked not applicable. SOC 2: the report noted an exception against a strongly related criterion. |

   Every indicator also carries a note on what 20x asks for beyond ISO: automation, continuous evidence, FIPS-validated cryptography, FedRAMP reporting, and so on.
3. **Lists the FedRAMP rules** that apply to a provider of the chosen class (157 for Class B and C, 156 for Class D in rules 2026.11.02.01). No ISO control evidences them; they are new programme work.
4. **Exports** a readiness workbook with a prioritised work plan, plus CSVs.

There is no percentage score on purpose. A control crosswalk cannot support one, and an assessor would not accept it.

## The mappings

`data/mapping-soc2.json` links each KSI to Trust Services Criteria (31 of 61 criteria appear; processing integrity and privacy criteria relate to no indicator) with the same strength scale and an `adds` note written for a SOC 2 reader.

`data/mapping.json` links each KSI to Annex A controls with a strength (`strong`: the control substantially evidences the indicator's outcome; `partial`: part of it) and an `adds` note. It was seeded from the NIST SP 800-53 Rev. 5 controls FedRAMP lists as related to each indicator, then written indicator by indicator. 63 of the 93 Annex A controls appear; the 30 that do not are physical, HR and legal controls no indicator speaks to.

Corrections are welcome as pull requests against those two files. Each change should say why.

## Build

```
npm install
npm run sample   # regenerate the fictional sample SoA
npm run build    # dist/index.html
npm test
```

`data/fedramp.json` (indicators and rules) is built from the Crosswalk 20x reference bundle with `npm run data`, which in turn comes from [FedRAMP/rules](https://github.com/FedRAMP/rules) (CC0).

## Hosting

`.github/workflows/pages.yml` publishes `dist/` to GitHub Pages on every push to `main`. `site/_headers` carries a Content-Security-Policy for Cloudflare Pages that pins the inline script by hash.

## Known limits

- SoA formats vary. Headstart detects columns by header text and keywords; check the "Your SoA" tab to see how each row was read.
- An SoA without a status column is read as "applicable means implemented", and the page says so.
- Class B optional indicators are shown but not counted.
- The SOC 2 form reads exceptions by criterion. If a report lists exceptions by control number only, map them to criteria first (or let Claude do it in the claude.ai copy).
- Tested on the fictional samples only. Real SoAs will find parser gaps; please file them with an anonymised row.

## Licence

Code: Apache-2.0, copyright 2026 Mycroft Technologies Inc. See `LICENSE` and `NOTICE`. FedRAMP data is CC0. Fonts are under the SIL Open Font License.
