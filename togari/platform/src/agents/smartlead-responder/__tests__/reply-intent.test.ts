import { describe, expect, it } from "vitest";
import { replyIntent, AUTO_HANDLED } from "../reply-intent";

it.each([
  "onepager",
  "one pager",
  "one-pager",
  "deck",
  "memo",
  "file",
  "materials",
  "teaser",
  "presentation",
])("classifies a request to see a %s as material work", (material) => {
  expect(replyIntent(`Could I see your ${material}?`).kind).toBe("deck");
});

it("keeps an eligibility questionnaire open despite restrictions in its criteria", () => {
  const intent = replyIntent(
    "We can consider investments alongside an institutional VC. Please answer yes to each of the questions below: Is the company private? We only consider qualified companies.",
  );
  expect(intent.kind).toBe("form");
  expect(intent.label).toBe("Eligibility questions");
});
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { getReplybotClient } from "../../replybot/client-config";

const ZEUTARA = getReplybotClient("zeutara")!.replyCopy;

// The sixteen Zeutara investor replies that reached #zeutara-cold-replies
// between 2026-10-06 and 2026-10-08, verbatim, with the move Jonah named for
// each kind on the 2026-10-08 call.
const CASES: {
  from: string;
  body: string;
  kind: string;
  step: string | null;
}[] = [
  {
    from: "robert@mavenventures.com",
    body: "Hi Jonah, thanks for reaching out. I don't think a call makes sense for us right now, but I appreciate you sharing the opportunity.\n\nRobert Ravanshenas\n\nPartner, Maven Ventures\nCell: (310) 801-5936",
    kind: "pass",
    step: null,
  },
  {
    from: "jack@afore.vc",
    body: "thanks for reaching out - i've left afore to join the founding team of one of\nour portfolio companies, and i no longer monitor this inbox\n\n\n\n\n\nfor anything afore-related, nathan yu (nathan@afore.vc [nathan@afore.vc]) is the\nbest person to reach\n\n\n\n\n\nfor anything else, feel free to text me or reach out on linkedin\n[https://www.linkedin.com/in/jackmcclelland/] and would love to pick things up\nfrom there\n\n\n\njack",
    kind: "referral",
    step: "nathan@afore.vc",
  },
  {
    from: "s.barrett@cwafamilyoffice.com",
    body: "Please send all correspondence to my new email address below.\nThank You\n\n\nSean Barrett\n\n\n\nbusinessexitnavigators@gmail.com [businessexitnavigators@gmail.com]",
    kind: "new_address",
    step: "businessexitnavigators@gmail.com",
  },
  {
    from: "hunter@homebrew.co",
    body: "Thanks for the note. Not a fit for us right now but best of luck!\n\nFeel free to stay in touch,\n\nhunter",
    kind: "pass",
    step: null,
  },
  {
    from: "clive@nabu-llc.com",
    body: "Jonah - I'll take a look at what the company does. May be interested in becoming a client. However,  I am traveling internationally for next 3 weeks.  Ball in my court.\n\nRegards\n\nClive Fleissig\n\nSent via the Samsung Galaxy S22 5G, an AT&T 5G smartphone\nGet Outlook for Android<https://aka.ms/AAb9ysg>",
    kind: "later",
    step: "3 weeks",
  },
  {
    from: "jlund@uventurefund.com",
    body: "Chance Murray has now taken over as Managing Director for University Venture\nFund II.  Please feel free to reach out to him or anyone else on our team.\n\n\nChance Murray chance.murray@sorensonimpact.com\n[chance.murray@sorensonimpact.com])\nCarl Adams carl.adams@sorensonimpact.com [carl.adams@sorensonimpact.com]\nCharlote Magee charlotte.magee@sorensonimpact.com\n[charlotte.magee@sorensonimpact.com]\nJose Moreno jose.moreno@sorensonimpact.com [jose.moreno@sorensonimpact.com]",
    kind: "referral",
    step: "jose.moreno@sorensonimpact.com",
  },
  {
    from: "jeremy@infinityvc.capital",
    body: "Hello Jonah. Is it possible to share the pitch deck before I commit to taking a call with the Founder? Thanks.\n\n*Jeremy Jonker*\nManaging Partner\n*Infinity Ventures ( http://infinityvc.capital )*\n\n214-629-418 3 infinityvc.capital ( https://infinityvc.capital/ )\n\n101 Montgomery Street, Suite 200, San Francisco, CA 94129 ( https://www.google.com/maps/place/101+Montgomery+St,+San+Francisco,+CA+94129 )\n\nlinkedin.com/in/ ( https://www.linkedin.com/in/jeremyjonker/ ) jeremyjonker",
    kind: "deck",
    step: null,
  },
  {
    from: "john@amokconsumer.com",
    body: "We don't do Safes. Sorry.\n\n\n*John Lowe - Managing Director*\njohn@amokconsumer.com\n614-483-9949\n[image: amokconsumer.com] <http://amokconsumer.com>\nCONFIDENTIALITY NOTICE: This email and any attachments may contain\nconfidential information. If you have received this email in error, please\nnotify us immediately by returning it to the sender and delete this copy\nfrom your system.",
    kind: "pass",
    step: null,
  },
  {
    from: "lfeinzaig@grahamwalker.com",
    body: "Hello,\n\nThank you for sharing this opportunity with us. We ask that all\nentrepreneurs review our investment criteria and submit their deck and\ninformation through our website\n<https://df1a7d4a.streak-link.com/DEUdmEczM8FvLBJLWwtrDStU/https%3A%2F%2Fgrahamwalker.com%2Fpitch>,\nfrom where our team reviews and responds to every submission.\n\nBest,\n\nLeslie and the Graham & Walker team\nᐧ",
    kind: "form",
    step: "streak-link",
  },
  {
    from: "jill@costellakirsch.com",
    body: "Hi Jonah,\n\nThanks for reaching out. Please see attached one-pager for what we look for in companies we fund as a lender. If this company looks like it hits our thresholds, I’d welcome an intro call.\n\nCheers,\nJill\n\n￼",
    kind: "pass",
    step: "isn't raising debt",
  },
  {
    from: "b@dvrgntventures.com",
    body: "Hi Jonah, thanks for writing. Best next step is our founder intake form —\nplease submit here and the team will take it from there:\nhttps://dvrgntventures.com/contact?intent=founder\n<https://www.google.com/url?q=https://dvrgntventures.com/contact?intent%3Dfounder&source=gmail&ust=1791485566900000&sa=E>\n\nB. | b@dvrgntventures.com | +1 (773) 368-7971",
    kind: "form",
    step: "https://dvrgntventures.com/contact?intent=founder",
  },
  {
    from: "sudhir.kadam@fyda.net",
    body: "Are they revenue generating? What is their LTM and NTM revenue? Collected net revenue, not ARR or GMV/GTV.",
    kind: "question",
    step: null,
  },
  {
    from: "darrel@tgnventures.vc",
    body: "Hi Jonah,\n\nThanks for reaching out.\n\nAt TGN Ventures, we use Vettable to review all opportunities. Please feel\nfree to have the founder submit here:\nhttps://www.getvettable.com/tgn-ventures/invest/6SPJMW\n\nAdditionally, please feel free to have them join our free founder community\nfor access to investors, other founders, and resources to grow as an\nentrepreneur: The Good News LOOP\n<https://loopis.live/inbox?section=groups&group=rd7729nz7qzwbkv3g9v7xvg33x8ftvcz&invite=980b1535-6bc8-462a-b135-f25246eaaaf9dcb06c8f-282d-42ce-a29c-df708726a409>\n\nBest,\nDarrel Frater\nManaging Partner\nTGN Ventures\nhttps://tgnventures.vc\n\nDarrel Frater, MBA\nFounder & Managing Partner, TGN Ventures\n\n*Set Apart. With Purpose.*\n\nEmaildarrel@tgnventures.vc\nPhone609-331-3928 <6093313928>\nLocationTulsa, Oklahoma\n\n𝕏 <https://twitter.com/DarrelFrater> @DarrelFrater\n<https://twitter.com/DarrelFrater>\nin <https://linkedin.c",
    kind: "form",
    step: "getvettable.com/tgn-ventures",
  },
  {
    from: "gary@perceptivevc.com",
    body: "Nick (CC'd) is more on the business side for considering this kind of\napplication: Data with physical meet venues.",
    kind: "referral",
    step: null,
  },
  {
    from: "adryenn@slayventures.io",
    body: "Thanks for letting me know another feature of my original dating app has\nnow spun off into its own thing. :) This is already a part of the the app I\nbuilt a decade ago that is in our venture studio. I wish them the best.\nLive and in person is totally the right play.\n[image: Regards,]\nAdryenn Ashley\nManaging Partner / Founder, Slay Ventures\n<http://facebook.com/adryenn> <http://us.linkedin.com/in/adryenn>\n<http://twitter.com/adryenn> <http://instagram.com/adryenn>\nAddress  450 Sinclair St., Reno, NV 89501\nPhone 415-887-8555\nEmail adryenn@slayventures.io\nWebsite https://slayventures.io\nThis e-mail and any attachments to it are confidential and may contain\nproprietary information. The information in this e-mail is intended solely\nfor the use of the individual(s) to whom it is addressed. Unless you are\none of the named addressee(s) (or authorized to receive it for one of the\naddressee(s), yo",
    kind: "unclear",
    step: null,
  },
  {
    from: "kellieo@reciprocityroi.com",
    body: "Hello Jonah\nIm always fully transparent so there is no confusion and informed decisions are made from the get-go.\n\nDigerati Investments VC fund only considers (not guaranteed) backing founders they have first worked with in some capacity through Reciprocity ROI Capital Management studio.\n\nWhy?\n\nReciprocity ROI capital management, diligence & syndications studio is to determine issuer and allocator alignment and responsible capital deployment through appropriate compliance and diligence which the startup must participate in.\nWe can’t determine that through phone calls and bit of paperwork\n\nAdditionally, any investor worth being on your cap table should also be bringing coinvestors with them.\nWe 100% own vouching for you to our coinvestors.\nWe cannot authentically do that if we have not personally had a front seat to how you operate & execute.\nAt this stage it is not about the product, it ",
    kind: "pass",
    step: null,
  },
];

// The eleven Qube Finance replies that never reached the channel (out of
// office, retired, moved, a flat no), read from Clay's inbox on 2026-10-09.
const QUBE_INBOX: typeof CASES = [
  {
    from: "e@laurentpartners.com",
    body: "Dear Sender, please kindly address future communication to el@pereim.com. This email will soon cease to function.",
    kind: "new_address",
    step: "el@pereim.com",
  },
  {
    from: "afilpo@fortunepartnersgroup.com",
    body: "I hope this message finds you well.\n\r\n\n\r\nWe would like to inform you that Antonio Filpo is no longer with Aliya Capital Partners. Please direct all messages and requests to familyofficeops@aliyacapitalpartners.com\n\r\n\n\r\nThank you for your understanding and cooperation.",
    kind: "referral",
    step: "familyofficeops@aliyacapitalpartners.com",
  },
  {
    from: "frederic.vanhalteren@waterloo-am.com",
    body: "Madame,\n\r\nMonsieur,\n\r\n \n\r\nJe suis absent du 03/10 au 10/10 et sans accès réguliers à ma mes supports de messageries. Les e-mails qui me seront adressés durant cette période ne seront pas\r\n automatiquement retransférés vers mon équipe.\n\r\n \n\r\nPour tout service, requête urgente ou prise de rdv, n'hésitez-pas à contacter mon assistante :\n\r\n \n\r\n02/ 357 03 40\n\r\nmaud.dudekem@waterloo-am.com\n\r\n \n\r\nBien cordialement,\n\r\n \n\r\nFrédéric Van Halteren",
    kind: "later",
    step: null,
  },
  {
    from: "wolfram.kuoni@kuonilaw.ch",
    body: "No, txs\r\n\r\nMit freundlichen Grüssen\r\nWolfram Kuoni\r\nKUONI Rechtsanwälte / Attorneys at Law \r\n\r\nDr.iur. Wolfram Kuoni\r\nRechtsanwalt / Attorney at Law \r\nMBA INSEAD \r\nKuoni Rechtsanwälte AG\r\nLöwenstrasse 66\r\nP.O. Box 251\r\nCH-8021 Zurich\r\n\r\nTel +41 43 466 60 60\r\nMobile: +41 79 352 65 76                     \r\nFax +41 43 466 60 61\r\nwww.kuonilaw.ch                                                                        \r\n\r\nThis e-mail has been sent by a law firm. It is confidential and may be privileged. Only the intended recipient may read, copy and use. If you have received it in error, please contact us immediately. Thank you.",
    kind: "pass",
    step: null,
  },
  {
    from: "erling.lein@sonnenberg-ag.com",
    body: "Thank you for your message.\n\r\nI am currently out of the office and will have limited access to email until the close of business on October 7.\n\r\nPlease note that your message will not be automatically forwarded. I will respond as soon as possible upon my return.\n\r\n \n\r\nKind regards,\n\r\n \n\r\nErling Lein",
    kind: "later",
    step: null,
  },
  {
    from: "ulrich.guggisberg@fio-partners.ch",
    body: "Danke für Ihre Nachricht. \n\r\nDas Postfach ist nicht\n\r\nmehr aktiv. Bei Rückfragen können Sie sich an\n\r\nHerrn Harald Hoffmann unter der Telefonnummer\n\r\n044 515 41 16 wenden. Danke für Ihre\n\r\nKenntnisnahme. \n\r\nMit freundlichen Grüssen FIO\n\r\nPartners AG\r\nBasierend auf frueherer E-Mail Korrespondenz mit Ihnen und/oder auf die mit Ihnen getroffene Absprache, betrachtet sich die FIO Partners AG als ermaechtigt, Sie via ungesicherte E-Mail\r\n Netze zu kontaktieren. Warnung: E-Mails koennen bedeutende Risiken aufweisen, wie beispielsweise Vertrauensmaengel, moegliche Verfaelschungen von Inhalten und/oder Senderadressen, unrichtige Empfaengeradressen (Fehlzustellungen), Viren etc. FIO Partners AG\r\n uebernimmt keine Verantwortung fuer einen Verlust oder einen aus dem E-Mail Verkehr entstandenen Schaden. FIO Partners AG empfiehlt, dass insbesondere sensitive Informationen nicht via E-Mail versendet werden, Details aus vorherigen E-Mails nicht in den Rueckantworten\r\n enthalten sind und dass die E-Mail Adresse(n) bei jeder E-Mail erneut manuell eingegeben wird/werden. Informationen in dieser Nachricht sind vertraulich und koennen rechtlich geschuetzt sein. Diese Nachricht ist ausschliesslich fuer",
    kind: "referral",
    step: null,
  },
  {
    from: "maria.lui@mutualtrust.com.au",
    body: "Thank you for your email. Please be advised that Maria Lui has retired from Mutual Trust. Please contact Simone James on (03) 9605 9528 or simone.james@mutualtrust.com.au who will be able to assist with your query.\r\n\r\n\r\n\n Mutual Trust Pty Ltd ACN 004 285 330, AFSL 234590. Liability Limited by a scheme approved under Professional Standards Legislation. For participating members (other than for the acts or omissions of Australian Financial Services Licensees).   \r\nThis email is intended for the named recipient only. The information contained in this message may be confidential, privileged or commercially sensitive. If you are not the intended recipient, confidentiality and any privilege are not waived and you must not reproduce or distribute any part of the email, disclose its contents to any other party, or take action in reliance on it. If you have received this email in error, please contact Mutual Trust immediately on +61 3 9605 9500. Please also destroy and delete this email from your computer. Any views expressed in this email are those of the individual sender, except where the sender expressly states them to be otherwise. Mutual Trust Pty Ltd does not represent, warrant or gu",
    kind: "referral",
    step: "simone.james@mutualtrust.com.au",
  },
  {
    from: "denise@sagegrowthcapital.com",
    body: "I am traveling Oct 5-7 with limited access to email. For immediate\r\nassistance please contact admin@sagegrowthcapital.com. Thanks!\r\n\r\n\r\n-- \r\nDenise Dunlap\r\nManaging Partner\r\n\r\n[image: www.sagegrowthcapital.com] \r\n\r\n\r\n*We invest in companies with:*\r\n* - Growing Recurring Revenue*\r\n\r\n* - Annual revenue over $300k *\r\n* - Stable gross margins 40% +*",
    kind: "later",
    step: null,
  },
  {
    from: "akbar.poonawala@pivotinvestment.com",
    body: "I am traveling and checking e-mails infrequently. \n\nIn case of an urgent need, you can text me at +1-917-940-4140.  \n\nThanks,\nAkbar\n\n-- \nAkbar A. Poonawala, CFA\nPivot Investment Partners LLC\nakbar.poonawala@pivotinvestment.com\nMobile:  +1-917-940-4140",
    kind: "later",
    step: null,
  },
  {
    from: "dskok@matrix.vc",
    body: "I have retired from making new investments. But I wish you the best of luck with the venture.",
    kind: "pass",
    step: null,
  },
  {
    from: "michelle@nrrcap.com",
    body: "Jonah,\n\nI invest in companies with minimum annual go-to-market spend of $20M. Based on what you described, this doesn't like a fit. Thanks.\n\nMichelle Moon\ncal.com/mmoon\nmichelle@nrrcap.com\n\nSent via Superhuman",
    kind: "pass",
    step: null,
  },
];

describe("replyIntent on real Zeutara replies", () => {
  for (const c of [...CASES, ...QUBE_INBOX]) {
    it(`${c.from} -> ${c.kind}`, () => {
      const intent = replyIntent(c.body, {
        leadEmail: c.from,
        companyName: "Qube Finance",
        client: ZEUTARA,
      });
      expect(intent.kind).toBe(c.kind);
      if (c.step) expect(intent.nextStep).toContain(c.step);
    });
  }

  it("sends a referral to every colleague named, not the person who replied", () => {
    const jlund = CASES.find((c) => c.from === "jlund@uventurefund.com")!;
    const step = replyIntent(jlund.body, { leadEmail: jlund.from }).nextStep;
    for (const e of [
      "chance.murray@",
      "carl.adams@",
      "charlotte.magee@",
      "jose.moreno@",
    ]) {
      expect(step).toContain(e);
    }
    expect(step).not.toContain("jlund@");
  });

  it("ignores our own quoted email below their reply", () => {
    const body =
      "Thanks, not a fit for us.\n\nOn Tue, Oct 6, 2026 at 9:00 AM Jonah Graham <jonahg@zeutaramedia.info> wrote:\n> Happy to send the deck and set up a call.";
    expect(replyIntent(body).kind).toBe("pass");
  });

  it("stays fast and short on a hostile reply", () => {
    const many = Array.from({ length: 40 }, (_, i) => `p${i}@fund.com`).join(
      " ",
    );
    const start = Date.now();
    const intent = replyIntent(
      `Please reach out to them: ${many} ${"a.".repeat(50_000)}`,
    );
    expect(Date.now() - start).toBeLessThan(200);
    expect(intent.nextStep.length).toBeLessThan(300);
  });

  it("retains repair ownership for a failed delivery without answering the server", () => {
    const gmail =
      "** Address not found **\n\nYour message wasn't delivered to pat@fund.com because the address couldn't be found, or is unable to receive mail.\n\nLearn more here: https://support.google.com/mail/?p=NoSuchUser";
    const blocked =
      "** Message blocked **\n\nYour message to lee@fund.vc has been blocked. See technical details below for more information.";
    for (const body of [gmail, blocked]) {
      const intent = replyIntent(body);
      expect(intent.kind).toBe("ignore");
      expect(intent.isDeliveryFailure).toBe(true);
      expect(AUTO_HANDLED.has(intent.kind)).toBe(true);
    }
  });

  it("blocklists an opt-out even when it reads like a bounce", () => {
    expect(replyIntent("Remove me. My mailbox is full of these.").kind).toBe(
      "unsubscribe",
    );
    expect(
      replyIntent("Unsubscribe. This was undeliverable to my team anyway.")
        .kind,
    ).toBe("unsubscribe");
  });

  it("falls through to a read when nothing matches", () => {
    expect(replyIntent("Cool.").kind).toBe("unclear");
  });
});

// Shapes that came out "unclear" or reached the client as a card on
// 2026-10-10 and 2026-10-11. Paraphrased, not the real replies.
describe("replies the rules missed in October", () => {
  const k = (body: string) =>
    replyIntent(body, { leadEmail: "a@fund.example" }).kind;
  it("a pass that leaves the door open is later, never a card", () => {
    expect(
      k(
        "Happy to chat once they identify a lead for the round, but until then, I have to pass. Best, A",
      ),
    ).toBe("later");
  });
  it("a plain pass in the first person", () => {
    expect(k("Thanks for thinking of us. I have to pass on this one.")).toBe(
      "pass",
    );
  });
  it("a bare no, no interest, and a conflict of interest are passes", () => {
    expect(k("no")).toBe("pass");
    expect(k("No interest, thanks.")).toBe("pass");
    expect(
      k(
        "It would be a conflict of interest since we have our own fund in this space.",
      ),
    ).toBe("pass");
  });
  it("asking to come off a list is an unsubscribe", () => {
    expect(k("Please take us off your distribution list.")).toBe("unsubscribe");
    expect(k("Remove Daniel")).toBe("unsubscribe");
  });
  it("removing something that is not a person is not an unsubscribe", () => {
    expect(
      k(
        "We'd remove the cap next round if the numbers hold. Can you send the deck?",
      ),
    ).not.toBe("unsubscribe");
  });
  it("an automated message is out of office", () => {
    expect(
      k(
        "Hey! This is an automated message. I get a high volume of email and will reply when I can.",
      ),
    ).toBe("later");
  });
  it("a line break inside nicht mehr aktiv still reads as moved on", () => {
    expect(
      k(
        "Diese Adresse ist nicht\nmehr aktiv. Bitte wenden Sie sich an info@fund.example",
      ),
    ).not.toBe("unclear");
  });
});

// Move 4 of the one-engine plan (2026-10-13): the next steps used to say
// "as Jonah" and "Zeutara isn't raising debt" for every client. They now read
// the client's registry facts, and the cases below are shared byte for byte
// with Chewbacca's Python port, which pins the same hash.
describe("the reply-kind corpus Chewbacca also pins", () => {
  const raw = readFileSync(join(__dirname, "reply-kind-cases.json"));
  const { cases } = JSON.parse(raw.toString("utf8"));
  it("is byte-identical to Chewbacca's copy", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "db99d32da6cde9e5241e6440f5efa1890e1cd5bf472a8077172bdf9fc4aa5127",
    );
  });
  for (const c of cases as { id: string; kind: string; body: string }[]) {
    it(`${c.id} -> ${c.kind}`, () => {
      expect(replyIntent(c.body, { leadEmail: "a@fund.example" }).kind).toBe(
        c.kind,
      );
    });
  }
});

describe("next steps name the client in the registry, not Jonah", () => {
  const file = join(__dirname, "reply-copy-cases.json");
  const raw = readFileSync(file);
  const cases = JSON.parse(raw.toString("utf8"));

  it("is the same corpus Chewbacca pins", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "cf3d9f40ffb8429fe95e1439947b6698c418a7df1b1c648caa2cf246de443ac4",
    );
  });

  for (const [name, facts] of Object.entries(cases.clients)) {
    for (const input of cases.inputs) {
      it(`${name}: ${input.id}`, () => {
        const got = replyIntent(input.body, {
          leadEmail: "a@fund.example",
          companyName: input.company,
          client: facts as any,
        });
        expect({ kind: got.kind, nextStep: got.nextStep }).toEqual(
          cases.expected[name][input.id],
        );
      });
    }
  }

  it("Zeutara's registry entry carries the facts its cards always said", () => {
    expect(getReplybotClient("zeutara")?.replyCopy).toEqual(
      cases.clients.zeutara,
    );
    expect(getReplybotClient("zeutara_test")?.replyCopy).toEqual(
      cases.clients.zeutara,
    );
  });

  it("a client with no facts gets no one else's name on any real reply", () => {
    for (const c of [...CASES, ...QUBE_INBOX]) {
      const step = replyIntent(c.body, {
        leadEmail: c.from,
        companyName: "Qube Finance",
      }).nextStep;
      expect(step).not.toMatch(/Jonah|Zeutara/);
    }
  });
});
