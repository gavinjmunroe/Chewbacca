# Lab day prep: two files, always

When a student has a hand-written pre-lab due at the start of a lab, ship two
files to ~/Downloads, never just a long study sheet:

1. `Lab N manual pages PRINT.pdf`: only the lab's pages cut from the course
   lab manual, including the blank pre-lab and post-lab pages they write on.
   poppler is installed and qpdf/pypdf are not, so cut with
   `pdfseparate -f A -l B manual.pdf p%d.pdf` then `pdfunite`. Find the page
   range by grepping each page's text for the lab title.
2. `Lab N PRE-LAB write this down.pdf` (write the .md, then `chewbacca pdf` it, one page): exactly the words to copy by hand
   (title, objective, materials, numbered methods, 1-2 if/then hypotheses),
   then short post-lab answers below a rule, then one line of what to bring
   (PPE, specimens) taken from the instructor's Friday announcement.

Teach-first cheat sheets are for the night before. On lab morning the
deliverable is the print file plus the copy file.

Also read the lab's Brightspace announcements (api-anything brightspace
announcements on the LAB orgUnitId) before writing: BISC 101's Lab 6 PPE rule
and "bring a strawberry-sized fruit" were only there, not in the manual.

Why: 2026-10-23, 9:25am, 35 min before BISC Lab 6, with only a 200-line cheat
sheet ready, Caleb wrote "IHAVENT DONE THE PRELAB YET AND IDK JACK I HV 20 MIN
... SAVE THE FILE TO MY DOWNLOADS TO PRINT AND MAKE A SEPERATE FILE WITH
EVERYTHING TO WRITE DOWN".

Both files are PDFs, because both get printed. 2026-10-23, 9:28am, after the copy file shipped as .md: "MAKE THE 2nd ONE A PDF TOO".
