# Repeat mistakes

Ranked 2026-10-11 after another tab asked "Why does the repeat mistake keep
happening???". `chewbacca lessons` said 231 corrections on file, 60 enforced
by code (26%), 171 context only.

## How this was counted

1. Every message Caleb typed into Claude Code in the 14 days to 2026-10-11 that
   reads like a repair (bro, wtf, never, again, still, why, ???, fix chewb and
   the like), deduped by day and text: 470 messages, each kept with the tail of
   the reply it answered.
2. One model (sonnet, batches of 30) mapped each message to the single saved
   correction it repeats, or to none, given every correction's description.
   141 of the 470 mapped to a lesson.
3. The counts below are for the 171 context-only lessons. A count includes the
   message that first gave the correction when it falls inside the window, so
   2 or more means he had to say it at least twice.

The mapping is a model's reading, not ground truth. Spot checks against the
reply before each message held up for the top 20; the long tail is noisier.

## Ranked

| #   | Lesson                                        | Times | Days                              |
| --- | --------------------------------------------- | ----- | --------------------------------- |
| 1   | feedback_nothing_takes_this_long              | 8     | 10-06, 10-08, 10-09, 10-10        |
| 2   | feedback_clay_api_vs_ux                       | 7     | 10-03, 10-05                      |
| 3   | feedback_slow_means_broken                    | 6     | 09-28, 10-03, 10-05, 10-07, 10-09 |
| 4   | feedback_never_read_only                      | 5     | 10-09, 10-10, 10-11               |
| 5   | feedback_dont_report_what_you_can_fix         | 4     | 10-09, 10-10, 10-11               |
| 6   | feedback_no_confirmation_prompts              | 4     | 10-01, 10-06, 10-10               |
| 7   | feedback_always_land_on_main                  | 4     | 10-05, 10-08, 10-09               |
| 8   | feedback_3d_means_nalana                      | 3     | 10-05, 10-06, 10-11               |
| 9   | feedback_find_the_existing_thing_first        | 3     | 10-03, 10-04, 10-07               |
| 10  | feedback_no_permission_prompts                | 3     | 10-04                             |
| 11  | feedback_no_unasked_study_nudges              | 2     | 10-10                             |
| 12  | feedback_phone_is_never_lesser                | 2     | 10-10                             |
| 13  | feedback_no_walls_of_text                     | 2     | 10-10                             |
| 14  | feedback_paper_draft_first_then_compare       | 2     | 09-29, 10-09                      |
| 15  | feedback_too_many_tabs_one_goal               | 2     | 10-03, 10-09                      |
| 16  | feedback_catalogued_is_not_read               | 2     | 10-04, 10-09                      |
| 17  | feedback_cli_not_app_windows                  | 2     | 10-09                             |
| 18  | feedback_never_hand_him_a_command             | 2     | 10-08, 10-09                      |
| 19  | feedback_writing_as_caleb                     | 2     | 10-03, 10-07                      |
| 20  | feedback_aura_sites_dont_show_product         | 2     | 10-07                             |
| 21  | feedback_use_the_ui_not_just_cli              | 2     | 10-05, 10-06                      |
| 22  | feedback_read_the_thread_before_drafting      | 2     | 10-05, 10-06                      |
| 23  | feedback_pdf_for_normal_people                | 2     | 10-03                             |
| 24  | feedback_no_ai_disclosure_in_docs             | 1     | 10-11                             |
| 25  | feedback_quiet_thread_is_not_broken_reader    | 1     | 10-10                             |
| 26  | feedback_verify_against_his_view              | 1     | 10-10                             |
| 27  | feedback_monday_covers_the_week               | 1     | 10-10                             |
| 28  | feedback_aura_text_names_the_thing            | 1     | 10-09                             |
| 29  | feedback_blocked_login_stays_blocked          | 1     | 10-09                             |
| 30  | feedback_ask_for_all_access_once              | 1     | 10-09                             |
| 31  | feedback_check_before_listing_his_todos       | 1     | 10-09                             |
| 32  | feedback_run_ported_classifiers_on_real_inbox | 1     | 10-09                             |
| 33  | feedback_no_local_hardening_asks              | 1     | 10-09                             |
| 34  | feedback_money_lead_with_real_cost            | 1     | 10-09                             |
| 35  | feedback_always_talk_like_him                 | 1     | 10-09                             |
| 36  | feedback_take_me_there                        | 1     | 10-09                             |
| 37  | feedback_automation_runs_on_server            | 1     | 10-09                             |
| 38  | feedback_clear_out_texts_means_reply          | 1     | 10-09                             |
| 39  | feedback_amber_is_stealth_publicly            | 1     | 10-09                             |
| 40  | feedback_apple_notes_dash_lists               | 1     | 10-08                             |
| 41  | feedback_todos_live_in_chewbacca              | 1     | 10-07                             |
| 42  | feedback_answer_it_before_asking_it           | 1     | 10-07                             |
| 43  | feedback_ask_the_material_questions           | 1     | 10-07                             |
| 44  | feedback_no_ai_slop_always                    | 1     | 10-06                             |
| 45  | feedback_silent_skill_mismatch                | 1     | 10-06                             |
| 46  | feedback_real_chrome_via_browser_harness      | 1     | 10-06                             |
| 47  | feedback_never_route_his_tabs                 | 1     | 10-05                             |
| 48  | feedback_no_rotation_lectures                 | 1     | 10-03                             |
| 49  | feedback_website_four_layers                  | 1     | 10-03                             |
| 50  | feedback_no_unintentional_animation           | 1     | 09-27                             |

The other 121 context-only lessons had no matching message in the window.

## The top 20 and what enforces each now

| #   | Lesson                         | Now enforced by                                                                                                                           | Kind                    |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | nothing_takes_this_long        | lesson-guard.sh refuses a foreground full suite, slow suite group, closeout or doctor                                                     | new hook                |
| 2   | clay_api_vs_ux                 | clay-native-guard.sh, landed 10-06, with no repeat after it; now cites the lesson                                                         | existing hook, relinked |
| 3   | slow_means_broken              | lib.sh times every hook with perl instead of two python3 starts (about 175 ms to 95 ms per hook at load 22); lesson-guard covers closeout | core fix, test          |
| 4   | never_read_only                | test_never_read_only.py fails on any read-only Google or Graph scope; chewbacca-office scopes widened to ReadWrite                        | core fix, test          |
| 5   | dont_report_what_you_can_fix   | handoff-check: u-forms, "needs you to", "it's on you", click-step lists, "say done when"                                                  | hook extended           |
| 6   | no_confirmation_prompts        | handoff-check: "want me to ...?", "shall I", "should I go ahead", "say the word"                                                          | hook extended           |
| 7   | always_land_on_main            | kit-autopush gates read `git archive HEAD`, not the working tree; 84 of 156 blocked pushes had failed only a disk-state gate              | core fix, test          |
| 8   | 3d_means_nalana                | lesson-guard refuses headless blender and a 3D subagent brief that never names Nalana                                                     | new hook                |
| 9   | find_the_existing_thing_first  | lesson-guard: the first git init, gh repo create or scaffolder per session lists the closest existing repos                               | new hook                |
| 10  | no_permission_prompts          | setup.sh writes one mcp\_\_server allow rule per configured server under bypass; test_no_permission_prompts.py                            | core fix, test          |
| 11  | no_unasked_study_nudges        | reply-lessons.sh, unless his last prompt was about school                                                                                 | new hook                |
| 12  | phone_is_never_lesser          | test_site_gate_flash_parity.py (site-gate parity) now cites the lesson                                                                    | existing test, relinked |
| 13  | no_walls_of_text               | site_gate_walls.py renders a wall, beats and an article through site-gate check                                                           | new test                |
| 14  | paper_draft_first_then_compare | reply-lessons.sh refuses asking for his paper draft                                                                                       | new hook                |
| 15  | too_many_tabs_one_goal         | machine-budget.sh, the load half only; now cites the lesson                                                                               | existing hook, partial  |
| 16  | catalogued_is_not_read         | ask-capture keeps every link from the whole prompt; the 1,200-character trim used to drop them                                            | core fix, test          |
| 17  | cli_not_app_windows            | test_integrations_no_app_windows.py: no bin/chewbacca-\* types into or raises an app                                                      | test                    |
| 18  | never_hand_him_a_command       | handoff-check: a sign-in handed over as a step needs a BLOCKED: line                                                                      | hook extended           |
| 19  | writing_as_caleb               | reply-lessons.sh refuses u'll, u'd, u've and u're                                                                                         | new hook                |
| 20  | aura_sites_dont_show_product   | nothing: whether a page shows the product is a taste call no rule reads off the DOM                                                       | not enforceable         |

handoff-check was measured on 2,479 final replies from the same 14 days. The
old patterns fired on 2 and the new set on 48. Read by hand, nearly all 48 are
a "want me to ...?", a "say the word" or work handed back. A "can u ...?"
pattern was tried and dropped, because it fired mostly on drafted texts to
teammates.

## Hook runtimes

Measured at load 15 to 40 on 2026-10-11, a busy afternoon on this Mac.

| Hook             | Event                  | Runtime           | When                                                            |
| ---------------- | ---------------------- | ----------------- | --------------------------------------------------------------- |
| lesson-guard.sh  | PreToolUse Bash, Agent | 42 ms             | a command naming none of its cases: one jq and a case match     |
| lesson-guard.sh  | same                   | 98 ms             | when it parses: run.sh, closeout, doctor, blender, init, create |
| reply-lessons.sh | Stop                   | 97 ms             | one perl, measured at load 40                                   |
| durable-guard.sh | Stop                   | 120 to 146 ms     | reads the transcript tail and the write-log backwards           |
| lib.sh timer     | every hook             | about 80 ms saved | python3 to perl                                                 |

Only the lesson-guard fast path is under 50 ms. The two Stop hooks run once
per turn, not once per tool call.

## The loop

durable-guard never fired in Claude Code before 2026-10-11. The Stop payload
carries no prompt, so the hook exited 0 on all 23 runs in that day's log. It
now reads the prompt from the transcript, and its detector catches 75 of the
141 mapped corrections, up from 14. A correction turn has to write code that
runs (a hook, a test, bin/ or tools/) or record why not with
`chewbacca lessons why "<lesson>: <reason>"`. Prose alone is refused once.
Every outcome lands in `~/.chewbacca/lessons/corrections.jsonl`;
`chewbacca lessons` prints the fortnight's count and `--loop` lists the turns.

## Still open

- aura_sites_dont_show_product is taste and stays context only.
- too_many_tabs_one_goal: only the load half is enforced.
- site-gate is tested, but no hook runs it before a site ships.
- Ranks 21 to 23 and the one-offs below them are still context only.
- A Stop refusal makes him see the reply twice
  (feedback_duplicate_replies_are_guard_rewrites). 48 in 2,479 replies is that cost for handoff-check.
