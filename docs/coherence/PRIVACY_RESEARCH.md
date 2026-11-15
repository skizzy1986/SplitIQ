# R33 — privacy research for coach access

Research date: 2026-11-15. Repository baseline: `3bb0f95`, plus the unmerged #511
coherence changes. **Research, not legal advice or a compliance certification.**
This is the Australian first pass required by roadmap D17. It does not approve
coach access, reverse D25, or decide whether Scott obtains a professional opinion.

## What I found

### Applicability needs a factual assessment

The Federal Register lists Privacy Act compilation C2026C00227, dated 4 June 2026,
as current on the research date. Sections 6C/6D and 6FA/6FB are the starting points
for coverage, small-business exceptions, health information and health services.
A hobby label or absence of revenue does not itself answer these statutory tests.
This note does not conclude that SplitIQ is an APP entity or that it is exempt.
[Privacy Act, current text](https://www.legislation.gov.au/C2004A03712/latest/text).

OAIC explains that an organisation providing a health service and holding health
information may be covered even when small or when health services are not its
main activity. Its examples extend beyond medical practices to gyms and weight
loss services. **Inference:** coach-facing health and training interpretation
makes an exemption assumption particularly unsafe; actual functions, claims and
operator arrangements need assessment.
[OAIC: health service providers](https://www.oaic.gov.au/privacy/your-privacy-rights/health-information/what-is-a-health-service-provider),
[OAIC: health-privacy concepts](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/health-service-providers/guide-to-health-privacy/introduction-and-key-concepts).

### Sharing consent is distinct from registration

OAIC describes valid consent as voluntary, informed, current and specific, with
capacity to consent. A person must understand the handling being authorised;
withdrawal prevents reliance on that consent for future handling. A registration
checkbox is therefore not evidence of agreement to disclosure to a named coach.
The APP 3 guidance also distinguishes consent from whether collection is reasonably
necessary. Treating every user action as consent would miss both requirements.
[OAIC: consent](https://www.oaic.gov.au/privacy/your-privacy-rights/your-personal-information/consent-to-the-handling-of-personal-information),
[OAIC: APP 3](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information).

Proposed product response: named-coach confirmation; an explicit description of
training/calibration access and plan authorship; separate optional grants for
vitals, BP, medication, blood panels and injury history; all optional grants off
initially; refusal leaves the personal log usable. Record the notice version and
consent event. Revocation stops future authorised server reads, but cannot recall
information a coach already saw or copied. These are design recommendations, not
claims that a particular interface satisfies the law.

### Notices, purpose, access and correction need an operating process

If the APPs apply, the published principles cover transparent management (APP 1),
collection notification (APP 5), use/disclosure limits (APP 6), information quality
(APP 10), and access/correction (APPs 12/13). Before wider handling, specify who
operates the service, how to contact them, what is collected, why, recipients,
complaints, and access/correction arrangements. Self-service screens alone are not
the whole operating process. The product should describe actual admin access and
should not promise confidentiality from an administrator who can read the DB.
[OAIC: APP text](https://www.oaic.gov.au/privacy/australian-privacy-principles/read-the-australian-privacy-principles).

### Hosting geography and retention require evidence

Overseas hosting is not automatically prohibited. OAIC distinguishes overseas use
from disclosure based on effective control; APP 8 and section 16C can impose
steps and accountability for disclosure. The correct classification depends on
actual arrangements, not just the provider's region label. Inventory processors,
subprocessors, contracts, support access and locations before deciding what the
notice says. Do not use a generic consent tick as an assumed APP 8 exception.
[OAIC: overseas handling](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/handling-personal-information/sending-personal-information-overseas).

APP 11 concerns reasonable protection and destruction or de-identification once
information is no longer needed, subject to exceptions. Document retention for
primary rows, consent/audit events, logs and backups separately; restore procedures
must respect deletions and revoked grants. This note proposes no invented statutory
retention period and no automatic deletion of the athlete's training history on
coach revocation.
[OAIC: APP 11](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information).

Where the NDB scheme applies, suspected eligible breaches require assessment;
OAIC says to take all reasonable steps to complete that assessment within
30 calendar days, with prompt action rather than treating that period as a target.
For an eligible breach, notification is to individuals at risk of serious harm and
OAIC, unless an exception applies. A practical containment, assessment and notification owner is
needed; an error-monitoring service does not provide this process by itself.
[OAIC: breach response](https://www.oaic.gov.au/privacy/notifiable-data-breaches/quick-reference-guide-for-responding-to-data-breaches).

### Age and geography remain boundaries

OAIC does not describe 18 as a universal statutory age for privacy consent; capacity
is contextual. D25's self-declared 18+ rule is a product boundary, not legal age
verification. Keep coach access adult-only in v1 and do not invent a guardian flow.
[OAIC: capacity and young people](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-b-key-concepts).

Federal analysis does not settle every state or overseas duty. WA's PRIS framework
is directed at the public sector and relevant arrangements; residence in Perth
alone does not establish that SplitIQ falls under it. Other states have additional
health/privacy regimes. Public registration and Spanish support are not geographic
access restrictions. Coverage for actual participants and coaches outside Australia
remains unassessed here.
[OAIC: state and territory legislation](https://www.oaic.gov.au/privacy/privacy-legislation/state-and-territory-privacy-legislation),
[WA: PRIS framework](https://www.wa.gov.au/organisation/office-of-the-information-commissioner/what-are-my-privacy-rights-resource-the-public).

## Confirmed in the repository

- `VISION.md` requires owner-default access, named grants, optional health categories
  and coach writes confined to plans. No billing or organisation accounts.
- Migrations 006/007 and 015/016 contain owner policies for context, strength and
  typed BP/lab/injury records. `coach_log` is a mixed diary, not a medication table.
- `CLAUDE.md` records the DB region as `ap-northeast-1`; `utils/sentry.js` names an
  EU ingestion host and disables several sensitive telemetry categories. These are
  repository facts, not a live vendor, contractual or payload audit.
- Backups exist, and `manifest.json` explicitly distinguishes mirrors and live
  migrations. Reading these files does not verify the current production catalogue.
- Current user queries often rely on owner-only RLS without a subject filter.
  Shared access requires explicit subjects and cache separation before rollout.

## Uncertain

Who is legally operating the service; whether/how the operator and individual
coaches are covered; actual processor contracts and geographic access; retention
obligations; requests/complaints ownership; and jurisdictional coverage for users
outside Australia. No live account settings, contracts or private records were read.
Free-text training notes can themselves contain health information: typed-category
separation cannot classify or redact that text automatically.

## Recommendation and decision record

Use the APP requirements as the engineering baseline while applicability is
resolved. Obtain an Australian privacy professional's assessment of the operator,
coach relationship, health-data handling and vendor arrangements before enabling
coach access or storing another person's health records. **This is a recommendation,
not a new approval gate imposed by this note.** Roadmap D17 reserves that decision
to Scott. His earlier D25 acceptance for registration does not approve coach reads.

**Disposition (Scott, 2026-11-15):** research considered and R37 approved. Privacy
and legal issues remain considerations before enabling access to other people's
data, but must not halt development of the currently private, non-commercial app.
No professional opinion has been obtained or represented as required for self-use
R38 development. The recommendation remains recorded for future coach rollout;
this decision is not a legal conclusion that the app is exempt. No coach policy,
invitation or data access has been enabled.
