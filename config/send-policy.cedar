// Could this send go right now? Every rule about who, when and how much lives
// here, in Cedar (cedarpolicy.com). `chewbacca send-policy could ...` asks it
// from a shell; send_approval.take() and people send ask it before a send.
// Types are in send-policy.cedarschema, the reader is crates/sendpolicy, and
// the facts each rule reads are gathered in tools/send_policy.py.
//
// The shape: everything is permitted, then each forbid below names one thing
// that stops a send. A send goes only when no forbid fires. A rule that can't
// be evaluated counts as a no (the reader denies on any error).
//
// This file only says no. It never stands in for a person's press: the press
// is send_approval.take(), which runs after this says yes.

@id("base")
permit (principal, action, resource);

// ---- every channel --------------------------------------------------------

// Tests and careful sessions set CHEWBACCA_NO_SEND. On 2026-10-08 a check
// meant to refuse a send had not applied, and a test call delivered "hi" to a
// client; since then every sink honors it, and this says so once.
@id("no-send")
@reason("sending is turned off on this machine (CHEWBACCA_NO_SEND)")
forbid (principal, action in [Action::"text", Action::"clay_write"], resource)
when { context.no_send };

@id("no-send-cold")
@reason("sending is turned off on this machine (CHEWBACCA_NO_SEND)")
forbid (principal, action == Action::"cold_email", resource)
when { context.no_send && !context.dry_run };

// ---- texts, email, Slack, bridged chats -----------------------------------

// Quiet hours a person asked for, read from $PEOPLE_DIR/quiet-hours.json
// (never in the repo, it names people). Sagar, 2026-10-11 00:58: "Do not text
// directly after 11pm in our respective time zones, and 7pm on Friday and
// Saturday ... Group chat texts are fine". Quiet runs from that day's cutoff
// to `until` the next morning. 420 (7am) when the rule gives no `until`:
// guessed, never stated by Sagar, it's when a direct text stops being a
// late-night one. `--after-hours` on people send is a person's override.
@id("quiet-hours")
@reason("inside the hours this person asked not to get a direct text")
forbid (principal, action == Action::"text", resource)
when {
  context has direct && context.direct && context has quiet &&
  ((context.quiet has cutoff_today &&
    context.quiet.minute >= context.quiet.cutoff_today) ||
   (context.quiet has cutoff_yesterday &&
    context.quiet.minute <
      (if context.quiet has until then context.quiet.until else 420)))
}
unless { context has after_hours && context.after_hours };

// An address only counts if it provably belongs to the person: the card's
// own phone or email, or a handle the store resolves back to them. On
// WhatsApp or Slack a sender picks their own display name, and on 2026-10-08
// a dry run of `people send dad` resolved to "prestons dad". Anything else
// sends only when --to repeats the exact address the dry run printed.
@id("unowned-address")
@reason("this address isn't a saved contact's, and --to didn't repeat it")
forbid (principal, action == Action::"text", resource)
when { context has address_owned && !context.address_owned }
unless { context has to_confirmed && context.to_confirmed };

// gmail.py files mail whose From failed Gmail's own sender check under
// "unverified:". A reply there answers whoever forged the name.
@id("unverified-sender")
@reason("the last email from them failed Gmail's sender check, so it may be forged")
forbid (principal, action == Action::"text", resource)
when { context has unverified_sender && context.unverified_sender };

// ---- cold email from a client's inbox (gtme send) -------------------------

@id("cold-weekend")
@reason("cold email goes out Monday to Friday, in their business hours")
forbid (principal, action == Action::"cold_email", resource)
when { context.utc_weekday >= 5 && !context.weekend_ok };

// A warmed inbox ramps 5, 10, 20, 40 a day over four weeks (outbound-rules.md,
// BMA). A primary Gmail never warmed for cold mail gets half that ceiling:
// 5 a day the first week, 10 the second, 15 the third, then 20. Guessed from
// those two sources, not measured on a fresh inbox. Days count from the
// client's first step-1 send; no send yet is the first week.
// tests/test_send_policy.py holds this to gtme_solo.RAMP and DAILY_CAP.
@id("cold-daily-cap")
@reason("today's cold email limit for this inbox is reached")
forbid (principal, action == Action::"cold_email", resource)
when {
  context.sent_today >=
    (if context has days_since_first then
       (if context.days_since_first < 7 then 5
        else if context.days_since_first < 14 then 10
        else if context.days_since_first < 21 then 15
        else 20)
     else 5)
};

@id("cold-suppressed")
@reason("they asked not to be emailed, or bounced")
forbid (principal, action == Action::"cold_email", resource)
when { context.suppressed };

@id("cold-already-sent")
@reason("this email already went to them")
forbid (principal, action == Action::"cold_email", resource)
when { context.already_sent };

// ---- Clay writes (chewbacca clay <op>) ------------------------------------

@id("clay-allow-writes")
@reason("a Clay write needs --allow-writes")
forbid (principal, action == Action::"clay_write", resource)
when { !context.allow_writes };

// Caleb's ok: him typing the op name at a terminal, or a prompt from him in
// chat within the last 2 hours. A reply answers a person who wrote first, so
// it needs no ok (Caleb, 2026-10-11, after 16 investors sat a weekend
// unanswered: "clay replies NEVER need human confirmation").
@id("clay-person-ok")
@reason("a Clay write needs Caleb's ok")
forbid (principal, action == Action::"clay_write", resource)
when { !context.person_ok && context.op != "reply" };

@id("clay-reply-finished")
@reason("the reply is empty, or still has a placeholder or a long dash in it")
forbid (principal, action == Action::"clay_write", resource)
when { context.op == "reply" }
unless { context has reply_finished && context.reply_finished };

// campaign-update and campaign-sequence touch only a draft: on a live one a
// new segment emails whoever is in it. A START goes only to a draft too, so
// it is always a launch and never a resume.
@id("clay-draft-only")
@reason("only a draft campaign is edited or started from here")
forbid (principal, action == Action::"clay_write", resource)
when { context.op == "campaign-update" || context.op == "campaign-sequence" || context.start }
unless { context has campaign_status && context.campaign_status == "draft" };

@id("clay-graded")
@reason("no passing gtme-grade for this campaign")
forbid (principal, action == Action::"clay_write", resource)
when { context.start || context.op == "add-leads" }
unless { context has grade_pass && context.grade_pass };
