---
name: whoop
description: "Read the user's real sleep, recovery, HRV, strain and workouts from WHOOP before advising on sleep, naps, caffeine or training. Use for how'd I sleep, should I nap, another coffee, am I recovered."
triggers: >-
  Read WHOOP data with chewbacca whoop. Use when the user asks how they slept, what their recovery or HRV is, what their strain is, whether to nap, take caffeine, train hard or go to bed early, or says they're tired, fried or running on no sleep.
requires: [chewbacca]
---

# WHOOP

Look before advising. A number from the band beats a guess from how the chat sounds.

```bash
chewbacca whoop today --json      # current cycle: recovery, last sleep, naps, strain, workouts
chewbacca whoop sleep --days 7    # trend, including naps
chewbacca whoop recovery --days 7
chewbacca whoop strain --days 7
chewbacca whoop workouts --days 7
chewbacca whoop status            # exit 3: never connected. exit 4: signed out
```

On exit 3 or 4, run `chewbacca whoop auth` in the background. It opens one local page that walks through creating the WHOOP app and signing in, and it waits up to 15 minutes. The redirect URL on that page has to match the app exactly. If WHOOP's dashboard rejects it, register an https URL, run `auth --redirect-uri <it>`, and finish with `auth --callback-url '<where the browser landed>'`.

## Reading it honestly

- `null` means WHOOP hasn't scored it, so say exactly that and leave the number out.
- `today` takes recovery from the current cycle on purpose. "No recovery yet" is an answer, and a bad night or a band that hasn't synced can both cause it.
- Check `minutes_since_sync`. A band that hasn't synced in hours makes `today` describe the past.
- `asleep_hours` is sleep stages. `in_bed_hours` includes time awake. Use the first when saying how much they slept.
- If what the user says conflicts with the band, they're right about their own life. Worn wrong or off the wrist, the band simply misses sleep.
- Give the number and what it changes today. This isn't medical advice, and symptoms that worry them go to a doctor.

## Privacy

Health data is personal. Never write these numbers into the repo, team memory, a commit, or anything that leaves the machine, unless the user asks. The tool itself stores only its keychain sign-in. The scheduled brief appends its output to `~/.chewie/brief.log`, so that local log can hold these numbers.
