# Changelog

## 1.0.0 (2026-11-08)

First release.

- Reads an ISO/IEC 27001:2022 Statement of Applicability (xlsx, csv or pasted rows) or a SOC 2 report (form: type, period, categories, Section 4 exceptions).
- Lays either against the 46 FedRAMP 20x Key Security Indicators for Class B, C or D with four readiness states and a "what 20x adds" note per indicator.
- Two open mappings: KSI to Annex A (63 controls) and KSI to Trust Services Criteria (31 criteria).
- Lists the FedRAMP rules for the class that no ISO or SOC 2 control evidences.
- Exports a readiness workbook with a prioritized work plan, plus CSVs.
- Inside claude.ai only: Claude reads a pasted SOC 2 Section 4 into the form, and drafts a one-page readiness note from the result.
- Deployed to GitHub Pages on every push; Cloudflare Pages headers with a hashed Content-Security-Policy included.
