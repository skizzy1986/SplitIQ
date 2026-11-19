# Strava API terms: what binds SplitIQ

| Document | URL | Version shown on page | Read on |
|---|---|---|---|
| API Policy (2026) | https://www.strava.com/legal/api_policy | Effective Date: June 1, 2026 | 2026-11-18 |
| API Agreement (2026) | https://www.strava.com/legal/api | Effective Date: June 1, 2026 | 2026-11-18 |
| Rate Limits / Athlete Capacity | https://developers.strava.com/docs/rate-limits/ | undated; the page says "Our API Agreement was last updated June 1, 2026." | 2026-11-18 |
| Getting Started | https://developers.strava.com/docs/getting-started/ | undated | 2026-11-18 |
| Brand Guidelines | https://developers.strava.com/guidelines/ | no date in the header; the foot of the page reads "Last revised on September 29, 2025" | 2026-11-18 |

Code read at origin/main 3017ed4.

**Origin.** #667. The findings were first posted at https://github.com/skizzy1986/SplitIQ/issues/667#issuecomment-6956378933; this file is the dated record they point to.

**Status.** Not legal advice. This is an agent's reading of Strava's published text, made for the project owner. Only a written answer from Strava settles an item marked Ambiguous.

**What this file holds.** Strava's published legal text and SplitIQ's reading of it, and no athlete data: no rows, no counts, nothing from a query. Agents may read it. The #631 rule is unchanged: no Strava data in an agent's context (root `CLAUDE.md`, *Never read Strava data*, and `.claude/hooks/block-strava-data-read.sh`).

## 1. Keeping this current

> Strava may update this Policy from time to time and will publish the updated Policy on the Strava developer site, if so. Your continued use of the Strava API Materials after publication constitutes acceptance of the updated Policy.

— API Policy §1, https://www.strava.com/legal/api_policy

> Any amendment to this Agreement will be effective upon our posting online of such updated terms. Your continued use of the Strava API Materials after such posting constitutes your consent to be bound by this Agreement, as updated and amended.

— API Agreement, preamble, https://www.strava.com/legal/api

> 14.4.1. As set forth above, all amendments to this Agreement will be in writing and effective upon our posting of such updated terms.

— API Agreement §14.4.1, https://www.strava.com/legal/api

- **Verified:** a change takes effect when Strava posts it, and continued use counts as acceptance (Policy §1, the Agreement preamble, Agreement §14.4.1). Neither text promises the developer a separate notice of the change.

**This record is stale when** either Effective Date line differs from June 1, 2026, or the rate-limits page's line about when the API Agreement was last updated changes.

**Re-check it:**

- before any change that widens who sees Strava data, how long it is kept, or who can connect (#673);
- when Strava emails a terms update;
- at the Spec stage of any `strava-*` issue.

**How to re-check.**

1. Download each page's raw HTML with curl, for example `curl -sL 'https://www.strava.com/legal/api_policy' -o api_policy.html`. Do not use WebFetch for quotes: its summariser cuts them at about 125 characters.
2. Convert the HTML to plain text, with a line break at each block element (paragraph, list item, heading).
3. Compare the Effective Date lines with the table above.
4. Check that every line starting with `>` in this file, and every straight-double-quoted string of 25 or more characters, is a whitespace-normalised substring of the new text.
5. Confirm each quote still sits under the section it is attributed to.

**When a quote drifts,** update the quote, its section number and the read date (in the table above and at the quote), add a Record history row with the old and the new wording, and re-label any claim that rests on it. Never edit a quote silently.

## 2. How to read this

**Labels.** Every claim starts with one of these:

- **Verified:** a quoted clause says it directly, or the code says it at 3017ed4 (marked Verified (code), with a path).
- **Inferred:** a reading of how a quoted clause applies, which the text does not state outright.
- **Ambiguous (An):** the text supports more than one reading. Both are given and neither is chosen.
- **Not verified:** not checked, or not checkable from here.
- **Reported (#628):** a fact about the project recorded in #628, not re-checked here.

Section numbers are always prefixed Policy or Agreement. The Agreement's unnumbered summary box is called the Agreement highlights. The Brand Guidelines have their own numbered headings and are cited by heading.

> To use the Strava API, developers must comply with this Strava API Policy (the "Policy"), which is incorporated by reference into, and forms part of, the Strava API Agreement (the "Agreement").

> In the event of a conflict between this Policy and the Agreement, the Agreement controls.

— API Policy §1, https://www.strava.com/legal/api_policy

**Numbering trap.** The two documents number their clauses independently. Agreement §4.4 is termination; Policy §4.4 is Garmin attribution.

> 4.4. Upon termination of this Agreement, you must promptly cease using and permanently delete all the Strava API Materials, any links or access to the Strava Platform in your Developer Application, and all Strava Data provided hereunder and so certify in writing to Strava.

— API Agreement §4.4, first sentence, https://www.strava.com/legal/api

**Defined terms.**

> (i) “Strava Data” means all data you access or collect from the Strava API Materials, including without limitation Strava user personal and activity data and Strava segment and leaderboard data;
>
> (ii) “Developer Application Data” means all other data you access or collect in connection with any of your Developer Applications; and
>
> (iii) “Strava Data” and “Developer Application Data” are collectively defined as “Data.”

— API Agreement §2.3, https://www.strava.com/legal/api

> 5.2. “Personal Data” means data that may be used, either alone or together with other information, to identify an individual user, including, without limitation, a user’s name, address, telephone number, username, email address, city and country, geolocation, unique identifiers, picture, or other similar information and includes personal data as defined in the GDPR and UK GDPR.

— API Agreement §5.2, https://www.strava.com/legal/api

- **Verified:** this file holds no data accessed or collected from the Strava API Materials (Agreement §2.3(i)): no athlete, activity, segment or leaderboard data. Its quotes come from Strava's public web pages.

## 3. At a glance

| Topic | Short answer | Label | Section |
|---|---|---|---|
| Display to others | Three texts limit an athlete's Strava Data to that athlete with no condition; consent and capacity wording elsewhere supports a second reading | **Ambiguous (A1, A2, A3)** | 4 |
| Derived values | Five clauses name derived data; the display clause, Policy §2.3, does not | **Ambiguous (A6)** | 7 |
| Tier and capacity | 1 (Single Player Mode), then 10 self-serve, then 9,999 after review, then Extended Access | **Verified** | 5 |
| Current capacity | 1, held by the owner; only the API settings page is authoritative | **Reported (#628)** | 5 |
| Subscription | Standard-tier apps carry a subscription requirement on the developer or specified end users; who exactly is not stated | **Verified**, **Not verified** | 5 |
| Storage outside the cache | The text supports two readings; the largest open question | **Ambiguous (A5)** | 6 |
| Cache | At most seven days; a resource found gone leaves the cache at once | **Verified** | 6 |
| Deletion on request or revocation | Within 30 days of a request, a revocation or an account deletion | **Verified** | 6 |
| Deletion sync | Deletions on Strava reflected within 48 hours | **Verified** | 6 |
| Policy §2.5 scope | Whether "all Data" includes Developer Application Data | **Ambiguous (A4)** | 6 |
| Combining (Policy §5.4) | Whether the bar on combining reaches data shown only to the same athlete | **Ambiguous (A7)** | 8 |
| Garmin | Attribution on information derived from Garmin-sourced data; how it applies to mixed aggregates is open | **Verified**, **Ambiguous (A8)** | 9 |
| AI and agents | Strava Data and anything derived from it are barred from AI use, context windows included; the Strava MCP, used by a subscriber for their own data, is excepted (Policy §3.5, Policy §5.3) | **Verified** | 10 |
| Webhooks | Getting Started says they are required; the Agreement and Policy text contains no such term | **Ambiguous (A9)** | 11 |
| Onboarding other athletes | Consent, access, support, deletion confirmation, privacy policy and terms obligations apply to every connecting athlete; tracked in #673 | **Verified** | 11 |
| Brand | Link-back text is View on Strava; no Strava name in the app's name | **Verified** | 12 |
| Exported data | Whether data an athlete exports and imports themselves is Strava Data | **Ambiguous (A10)** | 6 |

## 4. Display: who may see an athlete's Strava data

> **2.3 Display Limited to the Authenticated User**
>
> Strava Data provided by a specific Strava user may be displayed or disclosed in your Developer Application only to that user. You may not display or disclose Strava Data related to other users, even if such data is publicly viewable on the Strava Platform.

— API Policy §2.3, https://www.strava.com/legal/api_policy

> **6.1 Scope of Data Access**
>
> Unless your Developer Application has an athlete capacity of 9,999 or less, you may display or disclose to an end user only the specific Strava Data related to that end user. You may not display or disclose Strava Data related to other users, even if such data is publicly viewable on the Strava Platform.

— API Policy §6.1, https://www.strava.com/legal/api_policy

> Except for such limited caching, you may not store Strava Data, or provide or display Strava Data or any associated service, to any third party other than the Strava user using your Developer Application.

— API Policy §6.2, last sentence, https://www.strava.com/legal/api_policy

> You may not use the Strava API Materials in any way that would grant anyone other than you or the applicable Strava user the right to see data related to that user without the prior express consent of that user.

— API Policy §5.13, second sentence, https://www.strava.com/legal/api_policy

> You may not collect, use, store, aggregate, or transfer Strava Data in any manner except as expressly permitted for the operation of your Developer Application.
>
> You may not transfer or disclose Strava Data — including publicly viewable Strava Data — to any third party, except as expressly permitted by this Agreement and your then-current privacy policy and in full compliance with applicable law (including Section 28 of the GDPR and Section 28 of the UK GDPR).
>
> You may not, directly or indirectly, disclose, market, sell, license, lease, or make available in exchange for monetary or other valuable consideration, any Strava Data to any third party — including advertisers, data brokers, AI Application providers, or model developers — even if a user of your Developer Application consents.

— API Policy §5.10, https://www.strava.com/legal/api_policy

> Strava Data provided by a specific user can only be displayed or disclosed in your Developer Application to that user. Strava Data related to other users, even if such data is publicly viewable on the Strava Platform, may not be displayed or disclosed.
>
> You must always respect Strava users and comply with their privacy choices. This includes not sharing a Strava user’s data with other users, end users of your application, or third parties without explicit consent.

— API Agreement, highlights bullets 4 and 6, https://www.strava.com/legal/api

- **Verified:** three texts limit display to the user the data came from, with no condition: Policy §2.3, the last sentence of Policy §6.2, and Agreement highlights bullet 4. Neither the Policy nor the Agreement mentions coaches, teams or clubs.
- **Ambiguous (A1) — consent.** Policy §5.13 bars granting anyone else the right to see a user's data "without the prior express consent of that user", and Agreement highlights bullet 6 bars sharing without explicit consent.
  - Reading 1: read on their own, these clauses imply that a user's express consent permits showing that user's Strava Data to another person.
  - Reading 2: Policy §2.3 and the last sentence of Policy §6.2 carry no consent exception, so consent does not open display to anyone other than the user.
- **Ambiguous (A2) — the opening condition of Policy §6.1.**
  - Reading 1: read literally, its opening words exempt an app at an athlete capacity of 9,999 or less from the first sentence of Policy §6.1.
  - Reading 2: the opening words are a drafting slip: the second sentence of Policy §6.1, and Policy §2.3, repeat the same bar with no condition, so the exemption changes nothing.
- **Ambiguous (A3) — which text controls.** Policy §1 makes the Agreement control over the Policy.
  - Reading 1: Agreement highlights bullet 4 states the display bar with no condition, so the Agreement confirms the strict reading of A1 and A2.
  - Reading 2: Agreement highlights bullet 6 carries the consent wording, so the Agreement itself holds both readings and the precedence rule settles neither A1 nor A2.
- **Inferred:** by Agreement §2.3(i), every field an importer takes from the API is Strava Data.
- **Verified (code):** coach access is an approved specification and is not implemented (`docs/coherence/COACH_ACCESS_SPEC.md:3` at 3017ed4; the specification moved to the private ops repo in #677).
- **Verified (code):** on a row it inserts, SplitIQ's importer writes these columns from API fields: `date`, `type`, `label`, `duration`, `distance_m`, `avg_watts` and `avg_hr` (`supabase/functions/strava-import/mapper.ts:353-359`).

What a coach may see of Strava-sourced data is tracked in #668.

**How to settle it.** The Agreement invites the question:

> If you are unsure if a certain use of the Strava API Materials is permitted or if there is a use case you would like to see covered that is not currently supported by the API or this Agreement, please contact us at developers@strava.com to discuss your needs.

— API Agreement §2.2, https://www.strava.com/legal/api

Whether to ask is an open decision (section 15).

## 5. Tiers, athlete capacity and subscription

> **3.3 Access Tiers and Subscription Requirements**
>
> Strava classifies Developer Applications into the following Access Tiers, each of which has its own eligibility criteria and operating parameters as published on the Strava developer site:
>
> (a) Standard Tier (“Standard Tier Applications”), inclusive of two levels:
>
> - Developer Applications limited to 10 registered Strava users (generally intended for hobbyists, side projects, and early development); and
> - Developer Applications limited to 9,999 registered Strava users (generally intended for growing apps with a substantial user base);
>
> (b) Extended Access Tier (“Extended Access Tier Applications”), generally inclusive of Developer Applications serving 10,000 users or more and approved by Strava. Extended Access Tier Applications are admitted on a case-by-case basis and are not subject to subscription requirements, except as Strava may publish from time to time.
>
> Standard Tier Applications are subject to subscription requirements as published on the Strava developer site, including a requirement that the developer or specified end users maintain an active Strava subscription. Subscription requirements may change from time to time, and Strava may grandfather, exempt, or comp Developer Applications in its discretion.

— API Policy §3.3, https://www.strava.com/legal/api_policy

> Similarly, requests to increase rate limits or athlete capacity will be handled at Strava’s discretion, and increases are not guaranteed. Strava does not commit to a fixed review-time service-level agreement for these requests; you will hear from Strava if you are admitted, or if Strava requires additional information.

— API Policy §3.6, second paragraph, https://www.strava.com/legal/api_policy

> All newly created apps will have an athlete capacity of 1, aka “Single Player Mode”. Developers in Single Player Mode can use their app solely for themselves, and can access their own data.
>
> Once your app is configured, you can upgrade your access directly from your API Settings Dashboard. This raises your access to:
>
> - Athlete capacity of 10
> - Read read limits: 200 requests / 15min & 2,000 requests / day
> - Overall rate limits: 400 requests / 15min & 4,000 requests / day
>
> If you want to scale beyond 10 connected athletes you’ll need to submit your app for review. Until your app has been reviewed, you won’t be able to authenticate any additional athletes to your app. Your application’s athlete capacity will be visible in your API Settings Dashboard.

— Rate Limits page, Athlete Capacity, https://developers.strava.com/docs/rate-limits/

> 4) Submit for Review
>
> Please complete our Developer Program form for review and be sure to include screenshots of all the places Strava data is shown and the “Connect with Strava” button in your application. Please note: increased access is not a guarantee.

— Rate Limits page, Adjustment Requests, https://developers.strava.com/docs/rate-limits/

> A Strava subscription is a prerequisite for creating an app.

— Getting Started, https://developers.strava.com/docs/getting-started/

- **Verified, the ladder:** capacity 1 (Single Player Mode), then 10 (self-serve, from the API Settings Dashboard), then 9,999 (Developer Program review, with screenshots of every place Strava data is shown and of the Connect button; at Strava's discretion; no service-level agreement), then the Extended Access Tier (10,000 or more, case by case).
- **Verified:** Standard-tier apps carry "a requirement that the developer or specified end users maintain an active Strava subscription" (Policy §3.3), and creating an app needs a subscription (Getting Started).
- **Inferred:** the cap counts Strava-connected athletes (registered Strava users, connected athletes), not SplitIQ accounts. The 11th authorisation at capacity 10 fails at Strava: "you won’t be able to authenticate any additional athletes to your app".
- **Reported (#628):** the app is registered at athlete capacity 1, held by the owner. Only https://www.strava.com/settings/api is authoritative for the live figure.
- **Not verified:** the live capacity today.
- **Not verified:** who must hold a subscription; the text does not define specified end users.
- **Not verified:** the Developer Program form's URL, which neither page's text gives.

Raising capacity so that other athletes can connect is tracked in #673.

## 6. Storage, retention and deletion

> **6.2 Cache and Retention**
>
> You may not retain Strava Data in your cache for longer than seven (7) days. If your Developer Application checks for a resource (for example, a segment) and that resource is no longer available from Strava, you must remove it from your cache immediately, regardless of how frequently your cache is refreshed. Except for such limited caching, you may not store Strava Data, or provide or display Strava Data or any associated service, to any third party other than the Strava user using your Developer Application.

— API Policy §6.2, https://www.strava.com/legal/api_policy

> You may not continue displaying or disclosing in your Developer Application any Strava Data that a Strava user has deleted from Strava. Deletions must be reflected in your Developer Application expeditiously but in all cases within forty-eight (48) hours.

— API Policy §6.3, https://www.strava.com/legal/api_policy

> Except as expressly permitted by Section 6.2, you may not retain Data, and you may use and retain Data only so long as necessary for the purpose for which it was originally obtained.

— API Policy §6.4, https://www.strava.com/legal/api_policy

> You may not store Strava Data, or any data derived from Strava Data, in any Persistent Index. The foregoing prohibits indefinite storage in vector stores, embedding stores, search indexes, knowledge graphs, retrieval-augmented data stores, archives, and any other storage configured to enable subsequent retrieval, query, or use. The seven-day cache permitted under Section 6.2 is not a Persistent Index, provided that the cache is operated as a transient cache and is not used to enable any prohibited purpose under this Section 5.5.

— API Policy §5.5, second paragraph, https://www.strava.com/legal/api_policy

> You may not use or access the Strava API Materials to aggregate, cache, or store geographic location information or other user information accessible via the Strava API, except as expressly permitted by Section 6.2.

— API Policy §5.7, https://www.strava.com/legal/api_policy

> **7.4 Deletion Obligation**
>
> Upon (a) a Strava user's request, (b) a Strava user's revocation of your Developer Application's authorization to access the user's Strava account, (c) a Strava user's deletion of the user's Strava account, (d) your cessation of use of the Strava API Materials, or (e) termination of this Agreement, you must promptly and permanently delete the following from your Developer Application and from all systems, networks, and servers under your control:
>
> (i) in the case of clauses (a) through (c), all Strava Data and all Personal Data derived from Strava Data relating to the requesting or revoking user; and
>
> (ii) in the case of clauses (d) and (e), all Strava Data and all Personal Data derived from Strava Data, regardless of user.
>
> Deletion under this Section 7.4 must be completed expeditiously but in any event within thirty (30) days, except where applicable law or an agreement with the affected user requires retention for a longer period (in which case you must retain proof of the legal or contractual basis and provide it to Strava on request). You must certify deletion to Strava in writing on request.

— API Policy §7.4, https://www.strava.com/legal/api_policy

> You must delete all Data about an end user in your possession or control upon that end user's request, or upon the end user's termination or cancellation of the Developer Application's access to the Strava API Materials. You must also provide the user with written confirmation of successful deletion.

— API Policy §2.5, https://www.strava.com/legal/api_policy

> **6.6 User Bulk Data Export**
>
> Each Strava user has the right to access and export the user's own Strava data, free of charge, through the Bulk Data Export Tool published on the Strava service. Nothing in this Agreement is intended to limit or condition that user-facing right.

— API Policy §6.6, https://www.strava.com/legal/api_policy

- **Verified:** Strava Data may sit in a cache for at most seven days, and a resource found to be gone from Strava leaves the cache at once (Policy §6.2).
- **Verified:** deletions made on Strava are reflected within 48 hours (Policy §6.3).
- **Verified:** on a user's request, revocation or account deletion, all of that user's Strava Data and all Personal Data derived from it is deleted within 30 days, and deletion is certified to Strava in writing on request (Policy §7.4).
- **Verified:** the user receives written confirmation of successful deletion (Policy §2.5).
- **Inferred:** SplitIQ's disconnect calls `POST https://www.strava.com/oauth/deauthorize` (`supabase/functions/strava-connect/disconnect.ts:137`, `supabase/functions/strava-import/client.ts:338-345`). That is a revocation under Policy §7.4(b), and plausibly a request under Policy §7.4(a).

How Strava-sourced values on rows kept after disconnect are handled is tracked in #669.

- **Ambiguous (A4) — the scope of all Data in Policy §2.5.** Data is a defined term that includes Developer Application Data (Agreement §2.3(iii)).
  - Reading 1: "all Data about an end user" includes Developer Application Data, so cancelling Strava access reaches everything an app holds about that user, including what the user entered themselves.
  - Reading 2: it reaches only data held through the Strava integration.
- **Ambiguous (A5) — storage outside the cache. This is the largest open question.**
  - Reading 1: the last sentence of Policy §6.2 ("Except for such limited caching, you may not store Strava Data") and Policy §5.5 ("any other storage configured to enable subsequent retrieval, query, or use") together bar any persistent copy of Strava Data outside a transient seven-day cache, including a persistent store of activity records.
  - Reading 2: Policy §6.4 allows keeping Data "only so long as necessary for the purpose for which it was originally obtained", and Policy §2.5 and Policy §7.4 presume stored data exists to be deleted, so a store kept for the purpose the data was obtained for is within the terms.
  - **Reported (#628):** this question is recorded in #628 as accepted by the owner.
- **Ambiguous (A10) — data an athlete exports and imports themselves.** Policy §6.6 gives each Strava user the right to export their own data free of charge through the Bulk Data Export Tool, and Agreement §2.3(i) defines Strava Data as data accessed or collected from the Strava API Materials.
  - Reading 1: data the athlete exports through the Bulk Data Export Tool and imports into an app themselves is not accessed from the API Materials, so it is not Strava Data and the API terms do not reach it.
  - Reading 2: the text does not address it; Policy §6.6 protects the user's export right and says nothing about a developer storing that export.

## 7. Derived data

- **Verified:** Policy §4.4, Policy §5.3, Policy §5.4, Policy §5.5 and Policy §7.4 each name derived data in their text; Policy §2.3 does not.
- **Verified:** Policy §7.4 reaches "all Personal Data derived from Strava Data relating to the requesting or revoking user".
- **Inferred:** a derived value stored on a row keyed to a user relates to an identifiable person, so it is Personal Data under Agreement §5.2, which includes personal data as the GDPR defines it.
- **Ambiguous (A6) — derived values shown to someone else.**
  - Reading 1: Policy §2.3 names only Strava Data, and five other clauses name derived data explicitly, so its silence is deliberate and a derived value is outside the display limit.
  - Reading 2: the last sentence of Policy §6.2 also reaches any associated service, which catches a derived value shown to anyone other than the user.

## 8. Combining and analytics

> **5.4 No Aggregation, Analytics, or De-Identified Processing**
>
> You may not process or disclose Strava Data—even publicly viewable Strava Data—including in an aggregated, de-identified, or anonymized manner, for the purposes of analytics, analyses, customer insight generation, or product or service improvements. You may not combine Strava Data with other customer data for these or any other purposes. The restrictions in this Section 5.4 apply to data derived from Strava Data and to output that incorporates or was generated using Strava Data.

— API Policy §5.4, https://www.strava.com/legal/api_policy

- **Ambiguous (A7) — combining.**
  - Reading 1: the heading and first sentence aim at analytics and insight products, and customer data means other customers' data, so combining one athlete's Strava Data with other data about that same athlete, shown to that athlete, is outside the clause.
  - Reading 2: read literally ("for these or any other purposes"; customer data is not defined), it reaches any combination of Strava Data with other data about the same athlete, including output shown only to that athlete.

## 9. Garmin attribution

> **4.4 Third-Party Attribution**
>
> Data obtained through the Strava API may include data that requires attribution to third parties. If your Developer Application displays information derived from Garmin-sourced data, you must display attribution to Garmin in the form and manner required by Garmin's brand guidelines. Strava may specify additional third-party attribution requirements from time to time, as may the third parties themselves.

— API Policy §4.4, https://www.strava.com/legal/api_policy

- **Verified:** the trigger is "displays information derived from Garmin-sourced data", not raw data alone.
- **Inferred:** every displayed figure from a Garmin-recorded activity, and anything computed from it, needs Garmin attribution.
- **Ambiguous (A8) — aggregates that mix Garmin and other sessions.**
  - Reading 1: an aggregate that includes any Garmin-sourced activity is information derived from Garmin-sourced data, so the aggregate carries attribution.
  - Reading 2: attribution attaches where a Garmin-sourced activity's own figures are shown, and an aggregate across sources is not the kind of display the clause addresses.
- **Not verified:** Garmin's brand guidelines, which set the form of attribution, were not read.
- **Verified:** Strava's Brand Guidelines page does not mention Garmin.
- **Verified (code):** the importer skips Garmin-recorded activities until attribution ships (`supabase/functions/strava-import/mapper.ts:47`; #632).

## 10. AI and agent sessions

> **5.3 No AI/ML Training, Fine-Tuning, Grounding, Evaluation, Embedding, or Retrieval-Augmented Generation**
>
> You may not use the Strava API Materials or Strava Data, directly or indirectly, in connection with the development, training, evaluation, or operation of any AI Application. This prohibition extends to:
>
> - Any data derived from, aggregated from, anonymized from, or generated using Strava Data, in any form (including original, derivative, aggregated, anonymized, de-identified, or model-output form); and
> - Any of the following activities with respect to an AI Application: training, pre-training, post-training, fine-tuning, reinforcement learning, alignment, grounding, evaluation, benchmarking, embedding generation, retrieval-augmented generation, ingestion into a context window or working memory, and any other activity intended or reasonably likely to develop, improve, evaluate, or operate an AI Application.
>
> This prohibition does not extend to use of the Strava MCP, as discussed above in Section 3.5.

— API Policy §5.3, https://www.strava.com/legal/api_policy

> Subscribers to Strava may access the Strava MCP in connection with their personal use of their own Strava data, in accordance with this Policy and any operational requirements published on the Strava developer site, and may bring their own AI Application to interact with their own data through the Strava MCP.

— API Policy §3.5, https://www.strava.com/legal/api_policy

- **Verified:** the Policy §5.3 prohibition covers data derived from Strava Data and "ingestion into a context window or working memory". The Strava MCP exception is for a subscriber's personal use of their own data (Policy §3.5).
- **Verified (code):** agent sessions read `public.sessions_no_strava`, which hides importer-inserted rows (`supabase/migrations/018_strava_backup_exclusion.sql:29-34`), and a PreToolUse hook blocks the obvious reads of Strava data (`.claude/hooks/block-strava-data-read.sh:5`). The rule is in root `CLAUDE.md` (*Never read Strava data*); its fuller version moved to the private ops repo in #677.
- **Not verified:** whether any anchor (for example `rowing_cp`) was calibrated from Strava-imported watts.
- **Not verified:** Policy §5.16 has not been assessed against the database connectors agents use.

## 11. Obligations before other athletes connect

- **Verified:** Policy §2.1 requires consent that, at minimum, discloses "(i) The types of data that will be collected; (ii) The methods by which the data will be collected; (iii) How the user may withdraw consent; (iv) How the user may request deletion of the user's data; and (v) If a deletion request is made, that the deletion was successfully completed."
- **Verified:** Policy §2.2: "Your Developer Application must allow the end user to access data that the end user has generated and that you have collected via the Strava API Materials, upon the end user's request."
- **Verified:** Policy §2.4 requires "easily accessible contact information for end-user support and clear links for users to navigate to their Strava accounts".
- **Verified:** Policy §2.5: "You must also provide the user with written confirmation of successful deletion."
- **Verified:** Policy §7.2, on a change of scope: "In the event of a change in the type of data collected from a Strava user, you must notify the user of such change and obtain the user's consent to the change in scope."
- **Verified:** Policy §7.3: "You must provide a lawful privacy policy for your Developer Application that meets the requirements of the GDPR and the UK GDPR".
- **Verified:** Policy §6.5, on Strava's collection and use of Usage Data: "You agree to include a statement to this effect in your privacy policy."
- **Verified:** Policy §9.2: "Your Developer Application's terms of service must disclaim, on behalf of third-party service providers, all warranties".
- **Verified:** Policy §8.3 requires notice of a security incident "in writing to legal@strava.com, as soon as possible but no later than twenty-four (24) hours after discovery of the incident".
- **Verified:** Policy §7.7: "You must, on Strava's request, provide a current list of Subprocessors that process Strava Data on your behalf, including each Subprocessor's name, role, and processing location."
- **Verified (code):** `supabase/functions/strava-connect/index.ts:66-71` takes the user id from the verified bearer token's `sub` claim, and the function holds no owner allowlist.

Strava Connect is planned for every user, not only the owner (Scott, 2026-11-18). These obligations, and the capacity step in section 5, are tracked in #673.

- **Ambiguous (A9) — webhooks.** Getting Started says "Per our API terms, you need to implement webhooks to know when an athlete has deauthorized your API application". The text of the Agreement and the Policy contains no webhook requirement (checked 2026-11-18: the word does not appear in either).
  - Reading 1: the Getting Started page states a requirement Strava applies in practice, so an app is expected to implement the deauthorisation webhook.
  - Reading 2: the binding texts are the Agreement and the Policy it incorporates, neither of which contains the requirement, so the page's sentence is guidance rather than a term.
  - **Reported (#628):** webhooks were deliberately not filed; a polling reconcile was chosen instead.

## 12. Brand, competition, charging, press

- **Verified (Brand Guidelines, heading 1.1, Connect with Strava buttons):** an app that uses the Connect with Strava button for OAuth links it to https://www.strava.com/oauth/authorize or https://www.strava.com/oauth/mobile/authorize.
- **Verified (Brand Guidelines, heading 3, Linking to Strava Data):** link-back text is exactly View on Strava. The link is legible and marked as a link by bold weight, underline or Strava's orange (the page gives the colour value; this file does not repeat it).
- **Verified (Brand Guidelines, heading 4, and Policy §4.1):** the Strava name is not used in the app's name. Policy §4.1: "You must not use any Strava Mark, or any confusingly similar mark, as the name or part of the name or icon of your Developer Application".
- **Verified (code):** `web/src/components/session/sourceCopy.js:8-10` sets the link text to the exact string `View on Strava` and leaves it untranslated.
- **Not verified:** that link's styling.

> You may not use the Strava API Materials in any manner that is competitive to Strava or the Strava Platform, including in connection with any application, website, or other product or service that includes, features, endorses, or otherwise supports a third party that provides services competitive to Strava's products and services.

— API Policy §5.2, first sentence, https://www.strava.com/legal/api_policy

> You may not create applications that compete with or replicate Strava functionality.

— API Agreement, highlights bullet 2, https://www.strava.com/legal/api

- **Verified:** whether an app's use complies with Policy §5, competition included, is Strava's determination: "Strava shall determine in its sole discretion" (Policy §5, preamble).
- **Verified:** Policy §5.8 bars charging end users "for access to or use of the Strava API Materials", with a carve-out for "charging for the provision of functionality not provided by the Strava Platform in your Developer Application and that is not substantially duplicative of functionality offered by Strava".
- **Verified:** Policy §4.6 bars any press release or announcement that refers to Strava without "Strava's prior written consent".

## 13. What SplitIQ does today

Where the code meets a clause, at 3017ed4. Each row was re-read at the cited lines.

| Clause | What the code does | Where | Label |
|---|---|---|---|
| Policy §6.2 | Stream-cache rows expire six days after fetch; a check constraint refuses more than seven; an hourly sweep deletes expired rows | `supabase/migrations/020_strava_activity_cache.sql:23-27`, `supabase/functions/strava-activity/normalise.ts:11-16` | **Verified (code)** |
| Policy §6.2 | A Strava 404 for the activity deletes that session's cache row at once | `supabase/functions/strava-activity/handler.ts:246-248` | **Verified (code)** |
| Policy §6.2 | A refused or missing grant drops all of the user's cache rows | `supabase/functions/strava-activity/handler.ts:133-136` | **Verified (code)** |
| Policy §5.7 | No latlng or altitude streams are requested | `supabase/functions/strava-import/client.ts:299-304` | **Verified (code)** |
| Policy §6.3 | The deletion sync is due 12 hours after a completed pass and one hour after an aborted one | `supabase/functions/strava-import/reconcile.ts:48-51`, `supabase/migrations/012_strava_integration.sql:178-182` | **Verified (code)** |
| Policy §6.3 | Listing is bounded at about 2,000 activities per pass window; beyond it a pass stops `truncated` and reports | `supabase/functions/strava-import/README.md:594-600` (The ceiling) | **Verified (code)** |
| Policy §7.4(b) | The revocation purge runs 21 days after Strava first refuses the grant; the deadline is set once and never pushed later; the cron's phase B runs it, every 15 minutes per README, Cron registration | `supabase/functions/strava-import/state.ts:59`, `state.ts:85`, `supabase/functions/strava-import/purge.ts:1-8`, `supabase/migrations/012_strava_integration.sql:172-176` | **Verified (code)**; live cron registration **Not verified** |
| Policy §7.4, on disconnect | `purge_strava_user` deletes an importer-inserted row that carries no athlete data, keeps a row the athlete added data to, puts back the `avg_watts` and `avg_hr` the importer overwrote (null on an inserted row), and deletes the link, token, OAuth-state and sync rows. How Strava-sourced values on kept rows are handled is tracked in #669 | `supabase/migrations/019_strava_purge.sql:9-13`, `019_strava_purge.sql:20-35` | **Verified (code)** |
| Policy §4.4 | Garmin-recorded activities are skipped | `supabase/functions/strava-import/mapper.ts:47`, `supabase/functions/strava-import/test.ts:1700` | **Verified (code)** |
| Policy §5.3 | Agents read `sessions_no_strava`; a hook blocks the obvious reads | `supabase/migrations/018_strava_backup_exclusion.sql:29-34`, `.claude/hooks/block-strava-data-read.sh:5` | **Verified (code)** |
| Brand Guidelines, heading 3 | Link-back text is View on Strava | `web/src/components/session/sourceCopy.js:8-10` | **Verified (code)** |

## 14. Not verified

- **Not verified:** the live athlete capacity (Reported as 1 in #628).
- **Not verified:** Garmin's brand guidelines.
- **Not verified:** the Developer Program form's URL.
- **Not verified:** who must hold a Strava subscription.
- **Not verified:** the live pg_cron registration of `strava-import`.
- **Not verified:** Policy §5.16 against the database connectors agents use.
- **Not verified:** whether any anchor was calibrated from Strava-imported watts.
- **Not verified:** whether Strava has emailed any terms notice.

## 15. Open decisions for Scott

1. **Whether to email developers@strava.com** (Agreement §2.2). It sends project details to a third party, so it is Scott's call. Proposed questions:
   - (a) coach display with the athlete's express consent, at an athlete capacity of 9,999 or less (A1, A2);
   - (b) keeping imported activity records outside the seven-day cache (A5);
   - (c) combining imported activities with the athlete's own logged sessions into a training load (A7);
   - (d) the scope of all Data in Policy §2.5 (A4);
   - (e) optional: whether webhooks are required (A9);
   - (f) whether data an athlete exports through the Bulk Data Export Tool and imports themselves falls under the API terms (A10).
2. **Whether the storage question (A5) gets its own issue under #661.**
3. **Whether any anchor was calibrated from Strava-imported watts** (Policy §5.3).
4. **The owner's own data, kept permanently.** Scott's design input (2026-11-18): for his personal account he wants to retain his own data permanently. This is recorded as an open decision, not a verdict. The clauses it meets:
   - **Verified:** Policy §7.4 requires deletion within 30 days on (a) a request, (b) a revocation or (c) an account deletion.
   - **Verified:** while the owner stays connected, retention is governed by Policy §6.2, Policy §6.4 and Policy §5.5, which is A5.
   - The export route is A10. What survives disconnect is tracked in #669.
5. **Confirm the live capacity** at https://www.strava.com/settings/api, and add a Record history row.

## 16. Sibling disposition

Body edits are applied at Deliver; this table states the decision.

| Issue | Disposition (Scott, 2026-11-18) | Body change | Record section |
|---|---|---|---|
| #668 | Kept; rescoped to every importer-written field and to derived displays | Yes, at Deliver | 4, 7 |
| #669 | Kept; scope widened to any Strava-sourced value on rows kept after disconnect; Scott's retention design input recorded; not retitled | Yes, at Deliver (no retitle, no checkbox change) | 6, 13, 15 |
| #632 | Kept; scope confirmed and widened to derived and aggregate displays | Yes, at Deliver | 9 |
| #561 | Kept; its Strava dependency points at #673 | Yes, at Deliver | 11 |
| #673 | New slice under #661, filed 2026-11-18 | Filed | 5, 11 |
| #661 | Epic; findings comment posted | No (body unchanged) | All |

## 17. Where the repo cites these clauses (drift index)

Built from this search, run after this record's pointer edits:

```
git grep -n -I -i -E 'strava.{0,3} (api )?(policy|terms|agreement)|strava.{0,3} (brand )?guidelines|legal/api|developers@strava|deletion deadline' -- . ':!.claude/agent-library' ':!docs/strava'
```

Line numbers rot; what is enforced is that every file the search returns appears in this table. Lines are at 3017ed4, except `VISION.md` and `supabase/functions/strava-import/README.md`, which are after this record's pointer edits. Rows marked *Moved (#677)* name files that #677 moved to the private ops repo; they are no longer in this repo and the search no longer returns them.

| Path:line | Clause cited | Agrees? | Note |
|---|---|---|---|
| `.claude/hooks/block-strava-data-read.sh:5` | Policy §5.3 (written s5.3) | Yes | AI use and context windows |
| `.claude/skills/audit/SKILL.md:82` | Policy §5.3, unnumbered | Moved (#677) | Agent context; agreed at 3017ed4 |
| `.claude/skills/supabase-patterns.md:178` | Policy §5.3 | Moved (#677) | Agent sessions rule; agreed at 3017ed4. The pointer planned for #667 was not added, because the file moved before merge |
| `VISION.md:63-68` | Policy §5.3 | Yes | Updated for #667: read first-hand 2026-11-18 |
| `supabase/functions/strava-activity/normalise.ts:12` | Policy §6.2 | Yes | Seven-day cache |
| `supabase/functions/strava-import/README.md:22-26` | This record | Pointer | Added for #667 |
| `supabase/functions/strava-import/README.md:148` | Policy §4.4 | Yes (paraphrase) | Paraphrase: Garmin device data; the clause says information derived from Garmin-sourced data |
| `supabase/functions/strava-import/README.md:330-331` | Policy §5.3 | Yes | Dry run read by the owner |
| `supabase/functions/strava-import/README.md:518-520` | Policy §6.3, Policy §7.4, unnumbered | Yes | Paraphrase of both deletion clauses |
| `supabase/functions/strava-import/README.md:671` | Policy §6.2 | Yes | Seven-day cache |
| `supabase/functions/strava-import/client.ts:302` | Policy §5.7 | Yes | No geographic streams |
| `supabase/functions/strava-import/mapper.ts:47` | Policy §4.4 | Yes (paraphrase) | Same paraphrase as README:148 |
| `supabase/functions/strava-import/reconcile.ts:1-2` | Policy §6.3, unnumbered | Yes | 48 hours |
| `supabase/functions/strava-import/state.ts:47` | Policy §6.3, unnumbered | Yes | 48 hours |
| `supabase/functions/strava-import/test.ts:1700` | Policy §4.4 | Yes | TC-30 |
| `supabase/migrations/012_strava_integration.sql:179` | Policy §6.3, unnumbered | Yes | In a `COMMENT ON` string; applied migration, not edited |
| `supabase/migrations/018_strava_backup_exclusion.sql:30` | Policy §5.3 | Yes | Applied migration, not edited |
| `supabase/migrations/018_strava_backup_exclusion.sql:169` | Policy §5.3 | Yes | In a `COMMENT ON` string; applied migration, not edited |
| `supabase/migrations/019_strava_purge_rollback.sql:6` | Policy §6.3, Policy §7.4, unnumbered | Yes | Rollback file, not edited |
| `supabase/migrations/020_strava_activity_cache.sql:23-24` | Policy §6.2 | Yes | Its quote of the first sentence matches the live text |
| `supabase/migrations/020_strava_activity_cache.sql:163` | Policy §6.2 | Yes | In a `COMMENT ON` string; applied migration, not edited |
| `web/src/components/session/sourceCopy.js:8` | Brand Guidelines, heading 3 | Yes | Exact link text |
| `coach/REORIENTATION_EPIC_2026-11-06.md:295` | Display to others, from secondary sources | Moved (#677) | Historical; superseded by this record |
| `docs/roadmap/RESEARCH_CODEBASE_2026-11-07.md:289` | Display to others, from secondary sources | Moved (#677) | Historical; superseded by this record |
| `docs/roadmap/RESEARCH_CODEBASE_2026-11-07.md:560` | Display to others, unread | Moved (#677) | Historical; superseded by this record |
| `docs/roadmap/ROADMAP_PACKET_2026-11-07.md:299` | Display to others | Moved (#677) | Historical; superseded by this record |

## 18. Record history

| Date | Change | By |
|---|---|---|
| 2026-11-18 | Created from #667's first-hand read | PR for #667 |
| 2026-11-19 | Rebased on #677: citations to files moved to the private ops repo are marked *Moved (#677)*; the agent rule now points at root `CLAUDE.md` and the hook. No quote or label changed | PR for #667 |
