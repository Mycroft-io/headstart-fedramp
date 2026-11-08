# Changelog

## 1.3.0 (2026-11-08)

- All AI steps now run on Gemma 4 on the device: pasted-text reading, uncertain-exception attribution, and the readiness note. The Claude steps that existed only inside claude.ai are removed.
- "Power up local AI" button in the masthead loads Gemma from anywhere on the page.

## 1.2.0 (2026-11-08)

- Scanner reads the front of the report too: auditor, system described, subservice organizations and carve-out method, complementary user entity controls, locations, and every criterion referenced.
- "Load Gemma on this device" button to fetch the model ahead of time; once loaded, Gemma reviews uncertain exceptions automatically after each scan. Verified end to end in a browser: runtime import, download, inference.
- Fixes: runtime imported from a blob (Hugging Face serves it as text/plain); wrapped table-cell sentences kept whole; an unmapped control no longer borrows the previous row's criterion.

## 1.1.0 (2026-11-08)

- SOC 2 PDF scanner: drop the report, pdf.js reads it in the browser, and a rules-based scanner fills the form with type, period, scope and every Section 4 exception, each with a confidence mark. Reads criteria-to-control mapping tables for reports that list results by control number.
- On-device Gemma 4 E2B step (WebGPU) to resolve exceptions that could belong to more than one criterion. Opt-in; downloads the model once.
- Masthead button covers both sources; US spelling throughout.

## 1.0.0 (2026-11-08)

First release.

- Reads an ISO/IEC 27001:2022 Statement of Applicability (xlsx, csv or pasted rows) or a SOC 2 report (form: type, period, categories, Section 4 exceptions).
- Lays either against the 46 FedRAMP 20x Key Security Indicators for Class B, C or D with four readiness states and a "what 20x adds" note per indicator.
- Two open mappings: KSI to Annex A (63 controls) and KSI to Trust Services Criteria (31 criteria).
- Lists the FedRAMP rules for the class that no ISO or SOC 2 control evidences.
- Exports a readiness workbook with a prioritized work plan, plus CSVs.
- Inside claude.ai only: Claude reads a pasted SOC 2 Section 4 into the form, and drafts a one-page readiness note from the result.
- Deployed to GitHub Pages on every push; Cloudflare Pages headers with a hashed Content-Security-Policy included.
