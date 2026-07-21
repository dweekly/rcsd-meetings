---
name: a2p-campaign
description: Playbook for registering US A2P 10DLC SMS campaigns (Twilio/TCR) and WhatsApp senders that pass carrier review on the first try. Use when setting up texting for a project or number ("register a campaign", "light up SMS", "10DLC", "campaign rejected", "WhatsApp sender", "WABA"), or when diagnosing a TCR rejection. Distilled from the rcsd.info info-line campaign (approved 2026-07-20 after two documented rejections).
---

# A2P 10DLC Campaign & WhatsApp Sender Playbook

Lessons from getting the rcsd.info info-line campaign approved (two rejections,
then approval) and its WhatsApp senders unblocked. Follow this and a new
campaign should pass on the first submission. Fresh as of 2026-07-21 (WhatsApp flow verified end-to-end).

## Structure (who registers what)

- **Brand** = the legal entity (one-time). Register a **Standard / Low Volume
  Standard** brand with the entity's EIN — never Sole Proprietor (capped at
  1 campaign / 1 number / 1 MPS). The legal name must match IRS records
  exactly. The brand website should be the *project's* live site — it is what
  reviewers verify. Brand approval is automated EIN matching (~1 minute).
- **Campaign** = the messaging use case ($15 one-time vetting + monthly fee;
  each resubmission after a rejection costs another $15). "Low Volume Mixed"
  ($1.50/mo) suits conversational/informational services under 6,000
  segments/day. One campaign holds up to 49 numbers — put all numbers on one
  campaign; numbers pre-associated to the campaign's Messaging Service
  auto-register on approval.
- Campaign review has taken ~1–5 business days per attempt (Twilio says up to
  2–3 weeks).

## The reviewer verifies EVERYTHING against the live website

This is the #1 rejection source. Before submitting, the brand's website MUST
publicly show, at the exact URLs cited in the registration:

1. **The phone number(s)** with the call-to-action ("Call or text ...").
2. **Consent language at the point of the CTA**, containing verbatim:
   - "Message and data rates may apply" — **exact words; "Msg & data rates"
     gets rejected**; never the word "standard" (implies premium messaging).
   - Message frequency (e.g. "Message frequency varies").
   - "Reply STOP to opt out, HELP for help".
   - A consent statement ("By texting you agree to receive ...").
3. **Brand attribution** connecting the site to the registered legal entity
   (e.g. site footer: "a project of <Legal Entity LLC>").
4. **Privacy policy page** disclosing data collected/used and containing BOTH:
   - "No mobile information will be shared with third parties or affiliates
     for marketing or promotional purposes." (CTIA)
   - "All the above categories exclude text messaging originator opt-in data
     and consent; this information will not be shared with any third parties."
5. **Terms page** with: program name, description, verbatim rates line,
   message frequency, support contact, **HELP and STOP instructions in bold**,
   link to the privacy policy, and "Carriers are not liable for **any**
   delayed or undelivered messages" (include the word "any").
6. A **screenshot of the CTA** hosted at a stable public URL, cited in the
   message_flow as proof (required for text-initiated opt-in).

In this repo, `scripts/build-legal.mjs` generates the compliant privacy/terms
pages (EN at /privacy/ and /terms/, ES at /privacidad/ and /terminos/), the
homepage CTA lives in `scripts/build-homepage.mjs`, and the proof screenshot
is published at /img/sms-cta.png.

## Registration field rules

- **Description**: answer who sends / who receives / why. Lead with the legal
  entity and tie it to the site: "<Legal Entity> operates <site>, ...".
  English only, no PII. If replies can be non-English, say so here.
- **message_flow ("How do end-users consent?")**: name the exact URL where the
  number + disclosures appear, quote the CTA text word-for-word, include the
  proof-screenshot URL, then explain the consent model (for conversational
  services: "texting a question constitutes the opt-in; every message is a
  direct reply; no marketing or recurring messages").
- **Sample messages** (2–5): English ONLY — error 30910 fires on non-English
  samples even with inline translations; note bilingual replies in the
  description instead. Use [bracketed] variables for dynamic content, start
  each with the brand/service name, include the verbatim rates line in at
  least one and STOP language in all. Links must be on the brand's own domain.
- **Content flags**: declare embedded links / phone numbers honestly.
- **Opt-in keywords/message**: leave BLANK for conversational (response-only)
  services — keyword opt-in and confirmation messages are for *recurring*
  campaigns; inventing one contradicts a response-only description.
- The final "I agree" checkbox gates the submit button (easy to miss).

## Rejection codes seen

- **30909** — CTA verification failed: the opt-in couldn't be verified at a
  public URL, or required disclosures were missing at the point of number
  collection.
- **30910** — invalid sample content: non-English samples, missing brand/STOP,
  or wrong rates wording.
- Rejections appear as per-field red flags on the campaign page (Console →
  Messaging → Regulatory Compliance → Campaigns). "Fix Campaign" → edit →
  agree → Update resubmits. Read twilio.com/docs/api/errors/<code> before
  editing, and re-read Twilio's "A2P 10DLC Campaign Onboarding Guide"
  (help.twilio.com article 11847054539547) — its requirements are literal.

## WhatsApp senders (after/parallel to SMS)

- Senders register in the Twilio account that OWNS the number (Console →
  Messaging → Senders → WhatsApp senders → New). Don't move numbers to a
  subaccount for this — moving detaches the A2P campaign and any voice
  trunk/webhook configuration.
- **One WABA binding per Twilio account**: if any WhatsApp Business Account
  was ever connected (even a dead experiment), the wizard forces it. Deleting
  the old sender does NOT release the binding — a Twilio support ticket
  ("please disconnect WABA <id> from account <SID>") does, ~1-day turnaround.
  After the first new sender registers, the account binds to that WABA and
  every later sender must join it (which is what you want).

The registration flow, per number (verified end to end 2026-07-21):

1. Wizard: New Sender → pick the Twilio number → Continue → step 2 stages the
   number and shows "Continue with Facebook". Keep the Twilio window open the
   whole time — the SMS verification code auto-fills back into it.
2. Meta popup, "Enter business information for new assets" screen:
   **Name = the LEGAL entity** (must match what business verification will
   approve, e.g. "Primatech Paper Co") — NOT the brand. **Website = the
   BRAND's site** (e.g. the project domain): Meta's display-name review
   uses it to justify a brand display name that differs from the legal name,
   via the site's footer attribution. Category: pick honestly
   ("Media/News Company" for an info service). Timezone: local.
3. Select/create the WABA under the **legal-entity business portfolio**. For
   the FIRST number let it create a new WABA; for every subsequent number
   select the SAME WABA (one WABA holds many numbers).
4. **Display name is per-number** and set on a later screen — this is where
   the brand goes (e.g. "RCSD Info", "RCSD Info Español" for the Spanish
   line). Verify via SMS; the code auto-fills in Twilio.
5. Sender shows **Online immediately** in limited mode. Full messaging limits
   and final display-name approval land after Meta **business verification**
   on the portfolio (EIN letter upload in Security Center — the long pole,
   days–2 weeks; start it first).
6. Platform hookup last: in Synthflow, each chat agent's Deploy panel has a
   per-agent WhatsApp toggle that appears once the sender exists.

## Post-approval checklist

- Confirm numbers show the campaign's Messaging Service in the Console.
- Wire an autoresponder/agent BEFORE publicizing texting — an approved
  campaign with no inbound handler means people text into a void.
- Keep the CTA/terms/privacy pages stable: they are cited in the registration
  and re-checked on carrier audits.
