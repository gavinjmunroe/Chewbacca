# Character rigs

Lessons that hold for any drawn-in-code character, whatever the style. They come from building a
flat 2D vector puppet with IK, a turn parameter for three-quarter views, automatic blinks and a
VO-driven mouth; that puppet's proportions and shapes were one film's choices.

## Principles
- **One rig per character, used in every shot.** Consistency then comes from the code instead
  of from effort: the same code draws the hero everywhere, so a shot can't drift off-model.
  Characters differ only by parameters (a Look).
- **Document the conventions in the rig file's header:** angle signs, local units and origin,
  how props attach, which arm is which. Parallel animators read only that header.
- **Provide IK** (solve a limb for a hand target) instead of making animators guess joint
  angles. Guessed angles were the most common source of broken poses.
- **Build the likeness in order:** silhouette first (hair, head shape, glasses or other
  signature features), then clothes, then limbs. Pull 6-8 frames of the real person with ffmpeg
  and compare side by side.
- **A model sheet before any shot:** 6-9 poses and expressions rendered on one image. Most rig
  bugs are visible there in one look.
- **Plan for every scale the story needs.** Detail that reads in a wide shot looks crude at
  3-4x. Decide early whether close-ups need extra detail or a separate head.
- **Scale constants for recurring entities** (for example "the giant is 50x the hero"), defined
  once in the kit and used by every act.
- **Keep automatic life:** blinks with a per-character seed, a breathing bob, and a mouth
  driven by VO loudness when a character speaks to camera. Keep the mouth closed during
  narration.

## Failure patterns (check these on any rig)
- **Joint signs:** limbs flip outward instead of bending in front of the body.
- **Layering gaps:** skin showing between layered shapes (for example hair and fringe), and
  features hidden under other layers (brows under hair). Draw the expression features last.
- **Same-colour occlusion:** a limb crossing the torso disappears. Add an edge or shade stroke.
- **Grounding:** seated or crouched poses float above the contact shadow.
- **Cropping:** a wide rig cropped into a close-up loses its legs or grows floating feet. Frame
  deliberately or draw the full body.
- **Fades:** opacity crossfades on characters read as ghosts. Cut, or move the character.
- **Reach:** limb length limits hero poses. Special-case a limb when a key pose needs it.
- **Likeness drift:** a stylised feature can turn into a different hairstyle or face, so check
  against the reference again at thumbnail size.
