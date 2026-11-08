"""Two fictional SOC 2 Type 2 report excerpts in different layouts, as PDFs, for scanner tests. Not real companies."""
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
ss = getSampleStyleSheet(); P = lambda t, s='BodyText': Paragraph(t, ss[s])

def report_a(path):
    doc = SimpleDocTemplate(path, pagesize=letter); f = []
    f += [P("Northwind Analytics Ltd.", 'Title'), P("SOC 2 Type 2 Report", 'Heading2'),
          P("Report on Northwind Analytics Ltd.'s Description of Its Analytics Platform System and on the Suitability of the Design and Operating Effectiveness of Its Controls Relevant to Security and Availability throughout the period July 1, 2025 to June 30, 2026."),
          Spacer(1, 12), P("Section 1: Independent Service Auditor's Report", 'Heading2'),
          P("In our opinion, in all material respects, the controls stated in the description were suitably designed and operated effectively to provide reasonable assurance that the service commitments and system requirements were achieved based on the applicable trust services criteria relevant to security and availability (applicable trust services criteria) set forth in TSP section 100."),
          PageBreak(), P("Section 4: Trust Services Criteria, Related Controls, and Tests of Controls and Results", 'Heading2')]
    rows = [["Criteria", "Control #", "Control Activity", "Test Performed", "Results"],
            ["CC6.1", "AC-01", "Access to production is restricted to authorized personnel via SSO with MFA.", "Inspected SSO configuration.", "No exceptions noted."],
            ["CC6.2", "AC-02", "New user access requires manager approval.", "Inspected a sample of 25 new hires.", "No exceptions noted."],
            ["CC6.3", "AC-03", "Access is removed within 24 hours of termination.", "Inspected a sample of 25 terminated employees.", "Exception noted: for 2 of 25 sampled terminated employees, access was removed more than 24 hours after the termination date."],
            ["CC7.1", "VM-01", "Authenticated vulnerability scans are performed monthly.", "Inspected scan reports for each month.", "Exception noted: scan evidence was not available for two of the twelve months in the period."],
            ["CC7.2", "LM-01", "Security events are monitored by a SIEM with alerting.", "Observed SIEM dashboards and alert rules.", "No exceptions noted."],
            ["CC8.1", "CM-01", "Changes are approved before deployment.", "Inspected a sample of 40 changes.", "Deviation noted: for 3 of 40 sampled changes, approval was recorded after deployment to production."],
            ["A1.2", "BC-01", "Backups are performed daily and replicated across regions.", "Inspected backup job logs.", "No exceptions noted."],
            ["A1.3", "BC-02", "Recovery plans are tested annually.", "Inspected the most recent test report.", "No exceptions noted."]]
    t = Table([[P(c) for c in r] for r in rows], colWidths=[50, 50, 160, 120, 150], repeatRows=1)
    t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.5, colors.grey), ('VALIGN', (0, 0), (-1, -1), 'TOP')]))
    f.append(t); doc.build(f)

def report_b(path):
    # Layout B: results listed by control, criteria mapping in a separate table, 'as of' Type 1 style wording avoided
    doc = SimpleDocTemplate(path, pagesize=letter); f = []
    f += [P("Contoso Cloud, Inc.", 'Title'), P("System and Organization Controls (SOC) 2 Type II Report", 'Heading2'),
          P("Description of Contoso Cloud, Inc.'s Hosting Platform relevant to Security, Availability, and Confidentiality for the period from 1 January 2026 through 30 September 2026."),
          PageBreak(), P("Section IV – Tests of Operating Effectiveness and Results", 'Heading2'),
          P("Control CC6.1-1 Encryption at rest. Test: inspected KMS configuration. Result: No exceptions noted."),
          P("Control CC6.7-2 Encryption in transit. Test: inspected TLS configuration. Result: No exceptions noted."),
          P("Control C1.2-1 Customer data is deleted within 30 days of contract termination. Test: inspected a sample of 10 offboarded customers. Result: Exceptions were noted. For 1 of 10 sampled customers, data was retained for 47 days."),
          P("Control CC9.2-1 Vendor risk assessments are performed annually. Test: inspected assessments for in-scope vendors. Result: Control was not operating effectively; 4 of 12 vendors had no assessment in the period."),
          P("Control A1.1-1 Capacity is monitored with alerting. Test: observed dashboards. Result: No exceptions noted.")]
    doc.build(f)
report_a('test/fixtures/northwind-soc2-type2.pdf'); report_b('test/fixtures/contoso-soc2-type2.pdf'); print('fixtures written')

def report_c(path):
    # Layout C: criteria mapping table first, then results by control number only (hard case)
    doc = SimpleDocTemplate(path, pagesize=letter); f = []
    f += [P("Fabrikam Payments LLC", 'Title'), P("SOC 2 Type 2 Report on Fabrikam Payments LLC's Payment Gateway System relevant to security throughout the period October 1, 2025 to September 30, 2026.", 'BodyText'),
          PageBreak(), P("Section 4: Tests of Controls and Results", 'Heading2'), P("Criteria to control mapping", 'Heading3')]
    m = [["Criterion", "Controls"], ["CC6.1", "IAM-1, IAM-2"], ["CC6.3", "IAM-3"], ["CC7.1", "VULN-1"], ["CC7.2", "LOG-1"], ["CC8.1", "CHG-1, CHG-2"]]
    f.append(Table([[P(c) for c in r] for r in m], colWidths=[80, 200]))
    f += [Spacer(1, 12), P("Results of tests", 'Heading3')]
    r = [["Control", "Description", "Result"],
         ["IAM-1", "SSO enforced for production access.", "No exceptions noted."],
         ["IAM-3", "Access removed on termination within 1 business day.", "Exception noted: 1 of 15 sampled terminations exceeded 1 business day."],
         ["VULN-1", "Critical vulnerabilities remediated within 30 days.", "No exceptions noted."],
         ["LOG-1", "Logs retained for 12 months.", "No exceptions noted."],
         ["CHG-2", "Emergency changes reviewed after the fact.", "Deviation noted: 2 of 6 emergency changes had no post-implementation review."],
         ["NET-4", "Firewall rule changes are reviewed quarterly.", "Exception noted: the Q2 review was not performed."]]
    t = Table([[P(c) for c in x] for x in r], colWidths=[60, 240, 230]); t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.5, colors.grey)])); f.append(t)
    doc.build(f)
report_c('test/fixtures/fabrikam-soc2-type2.pdf'); print('fixture c written')
