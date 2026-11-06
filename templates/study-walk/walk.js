// One-screen guided walkthrough shared by the animated lessons.
// Caleb, 2026-11-04 5:25am, on the first page of a walkthrough (cards under a drawing):
// "it doesnt even fit in 1 page and its too much to comprehend at once, rlly
// walk me through it plz". So: one drawing, one short sentence, one button.
// Every few beats a check question replaces Next, which is what replaces the
// flashcards. Progress is saved per page so a refresh resumes.
function Walk({ key, svg, beats, draw, quiz }) {
  const $ = (s) => document.querySelector(s);
  const say = $("#wSay"),
    opts = $("#wOpts"),
    fb = $("#wFb"),
    next = $("#wNext"),
    prev = $("#wPrev");
  const tag = $("#wTag"),
    step = $("#wStep"),
    bar = $("#wBar");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let i = 0,
    t = 0,
    target = 0,
    raf = 0,
    unlocked = true,
    inQuiz = false,
    q = null,
    score = 0,
    tries = 0,
    marks = [],
    missed = [],
    sinceMiss = 0,
    streak = 0;
  // Tap-the-part checks (Caleb, 5:41am: "I like mcq + clicking on the right
  // thing"): a beat with tap: {q, hit: [[x, y, r] or [x0, y0, x1, y1]], why}
  // is answered by tapping the drawing itself. Hits get 8 viewBox units of slack.
  const SLACK = 8;
  const inHit = (h, x, y) =>
    h.length === 3
      ? Math.hypot(x - h[0], y - h[1]) <= h[2] + SLACK
      : x >= h[0] - SLACK && x <= h[2] + SLACK && y >= h[1] - SLACK && y <= h[3] + SLACK;
  const isSvg = svg instanceof SVGElement;
  // Audit 7:23am: in most checks the right answer was the first option, which
  // gives it away. Options are shuffled every time a check is shown.
  const order = (n) => {
    const o = [...Array(n).keys()];
    for (let k = n - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [o[k], o[j]] = [o[j], o[k]]; }
    return o;
  };
  try {
    i = Math.min(
      beats.length - 1,
      Number(localStorage.getItem("walk:" + key)) || 0,
    );
  } catch (e) {}

  const store = () => {
    try {
      localStorage.setItem("walk:" + key, String(i));
    } catch (e) {}
  };
  const beatT = (k) => {
    for (let j = k; j >= 0; j--) if (beats[j].t != null) return beats[j].t;
    return 0;
  };
  const beatTag = (k) => {
    for (let j = k; j >= 0; j--) if (beats[j].tag) return beats[j].tag;
    return "";
  };

  function paint() {
    const resting = Math.abs(t - target) < 0.001;
    const b = inQuiz ? null : beats[i];
    // a beat can carry its own small drawing (art) for an idea the page's
    // main scene doesn't cover
    if (b && b.art && isSvg) { svg.innerHTML = b.art; return; }
    draw(
      svg,
      t,
      resting && b && b.label
        ? Array.isArray(b.label[0])
          ? b.label
          : [b.label]
        : [],
      inQuiz,
    );
    if (isSvg && b && b.tap && resting) {
      let extra = "";
      if (unlocked)
        b.tap.hit.forEach((h) => {
          extra +=
            h.length === 3
              ? `<circle cx="${h[0]}" cy="${h[1]}" r="${h[2] + 4}" fill="none" stroke="#7bd88f" stroke-width="3"/>`
              : `<rect x="${h[0] - 4}" y="${h[1] - 4}" width="${h[2] - h[0] + 8}" height="${h[3] - h[1] + 8}" rx="6" fill="none" stroke="#7bd88f" stroke-width="3"/>`;
        });
      marks.forEach(([x, y, ok]) => {
        extra += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${ok ? "#7bd88f" : "#ff7a66"}" stroke="#0e0d0c" stroke-width="2"/>`;
      });
      svg.insertAdjacentHTML("beforeend", extra);
    }
  }
  if (isSvg)
    svg.addEventListener("click", (e) => {
      const b = beats[i];
      if (inQuiz || !b.tap || unlocked) return;
      const m = svg.getScreenCTM();
      if (!m) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const ok = b.tap.hit.some((h) => inHit(h, pt.x, pt.y));
      marks.push([pt.x, pt.y, ok]);
      if (ok) {
        unlocked = true;
        next.disabled = false;
        fb.textContent = "Yes! " + (b.tap.why || "");
        fb.className = "fb good";
        svg.style.cursor = "";
        next.focus();
      } else {
        fb.textContent = "Not there. " + (b.tap.hint || "Try again.");
        fb.className = "fb bad";
      }
      paint();
    });
  function frame() {
    const d = target - t,
      speed = 0.024;
    if (Math.abs(d) <= speed) {
      t = target;
      raf = 0;
      paint();
      return;
    }
    t += Math.sign(d) * speed;
    paint();
    raf = requestAnimationFrame(frame);
  }
  function moveTo(x) {
    target = x;
    if (reduce || Math.abs(target - t) > 1.5) t = target;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function buttons(list, onPick) {
    opts.innerHTML = "";
    list.forEach((txt, k) => {
      const b = document.createElement("button");
      b.className = "opt";
      b.textContent = txt;
      b.onclick = () => onPick(k, b);
      opts.append(b);
    });
  }

  function show() {
    inQuiz = false;
    const b = beats[i];
    step.textContent = `${i + 1} / ${beats.length}`;
    bar.style.width = `${((i + 1) / beats.length) * 100}%`;
    tag.textContent = beatTag(i);
    say.innerHTML = b.check ? b.check.q : b.tap ? b.tap.q : b.say;
    marks = [];
    if (isSvg) svg.style.cursor = b.tap ? "crosshair" : "";
    fb.textContent = "";
    fb.className = "fb";
    opts.innerHTML = "";
    prev.disabled = i === 0;
    unlocked = !b.check && !b.tap;
    next.disabled = !unlocked;
    next.textContent =
      i === beats.length - 1 ? (quiz ? "Practice" : "Start over") : "Next";
    if (b.check) {
      say.classList.add("q");
      const ord = order(b.check.opts.length);
      buttons(ord.map((k) => b.check.opts[k]), (pos, el) => {
        const k = ord[pos];
        if (unlocked) return;
        if (k === b.check.a) {
          el.classList.add("right");
          fb.textContent = "Yes! " + (b.check.why || "");
          fb.className = "fb good";
          unlocked = true;
          next.disabled = false;
          next.focus();
        } else {
          el.classList.add("wrong");
          el.disabled = true;
          missCheck(i);
          fb.textContent = "Not quite. " + (b.check.why || "Try again.");
          fb.className = "fb bad";
        }
      });
    } else if (b.tap) say.classList.add("q");
    else say.classList.remove("q");
    store();
    if (i === beats.length - 1) { try { localStorage.setItem("walkdone:" + key, "1"); } catch (e) {} }
    moveTo(beatT(i));
  }

  // Practice is a round with a finish line. Caleb, 5:42am: "had me do the
  // matching in my head over and over until I got it", then 5:50am: "show me
  // how many there are left plz". Every picture has to be named right twice;
  // a miss puts it back 2 spots later, so it still needs its 2 right answers.
  let queue = [],
    finished = false;
  // Caleb, 6:03am: "save the ones I miss for at the end". A missed check
  // question joins the end of this page's practice round, and goes in a bank
  // (localStorage "missbank") that review.html drills across every page,
  // the way Anki puts an "Again" card back in the pile until it sticks.
  const missedBeats = new Set();
  function missCheck(k) {
    missedBeats.add(k);
    try {
      const bank = JSON.parse(localStorage.getItem("missbank") || "[]");
      if (!bank.some((m) => m.k === key && m.i === k)) {
        const c = beats[k].check;
        bank.push({ k: key, i: k, q: c.q, opts: c.opts, a: c.a, why: c.why || "", page: document.title });
        localStorage.setItem("missbank", JSON.stringify(bank));
      }
    } catch (e) {}
  }
  // Caleb, 6:03am, stuck on "Practice done": "Why can't I continue to next
  // section?" The finish screen's main button goes to the next walkthrough in
  // the Lock in order, and Back starts another round.
  // Where "next" goes after a section's practice is done. The site supplies it
  // as window.WALK_NEXT = { "<pageKey>": ["<href>", "<label>"] }; one BISC
  // course's chapter order used to be hardcoded here, which is site data and
  // not engine behaviour.
  const NEXT = (typeof window !== "undefined" && window.WALK_NEXT) || {};
  const fillQueue = () => {
    const pool = [...quiz.items, ...quiz.items];
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    for (let k = 1; k < pool.length; k++) if (pool[k] === pool[k - 1]) { const j = (k + 2) % pool.length; [pool[k], pool[j]] = [pool[j], pool[k]]; }
    queue = pool.concat([...missedBeats].map((k) => ({ beat: k })));
    score = 0; tries = 0; streak = 0;
  };
  function finishRound() {
    inQuiz = true;
    tag.textContent = "Practice done";
    step.textContent = `${score} / ${tries} right`;
    missedBeats.clear();
    say.innerHTML = `Done! U named every picture right twice. <b>${tries - score}</b> misses along the way.`;
    say.classList.remove("q");
    opts.innerHTML = "";
    fb.textContent = "";
    fb.className = "fb";
    next.disabled = false;
    finished = true;
    const nx = NEXT[key] || ["./", "Home"];
    next.textContent = `Next: ${nx[1]}`;
    prev.disabled = false;
    prev.textContent = "Go again";
    q = null;
    queue = [];
    try { localStorage.setItem("walkdone:" + key, "1"); } catch (e) {}
  }
  function newQ() {
    if (!queue.length) {
      if (q === null && tries > 0) fillQueue();
      else if (!tries) fillQueue();
      else return finishRound();
    }
    inQuiz = true;
    q = queue.shift();
    const left = queue.length + 1;
    tag.textContent = `Practice · ${left} left`;
    step.textContent = `${score} / ${tries} right`;
    bar.style.width = `${Math.max(0, 1 - left / (quiz.items.length * 2 + missedBeats.size)) * 100}%`;
    say.innerHTML = quiz.prompt;
    say.classList.add("q");
    fb.textContent = "";
    fb.className = "fb";
    next.disabled = true;
    next.textContent = left === 1 ? "Finish" : "Next one";
    prev.disabled = false;
    let done = false;
    if (q.beat != null) {
      // a check question he missed during the walkthrough, asked again here
      const c = beats[q.beat].check, item = q;
      say.innerHTML = c.q;
      tag.textContent = `Missed earlier · ${left} left`;
      const ord = order(c.opts.length);
      buttons(ord.map((k) => c.opts[k]), (pos, el) => {
        if (done) return;
        done = true;
        tries++;
        const ok = ord[pos] === c.a;
        if (ok) {
          score++;
          try {
            const bank = JSON.parse(localStorage.getItem("missbank") || "[]").filter((m) => !(m.k === key && m.i === item.beat));
            localStorage.setItem("missbank", JSON.stringify(bank));
          } catch (e) {}
        } else queue.push(item);
        el.classList.add(ok ? "right" : "wrong");
        if (!ok) opts.children[ord.indexOf(c.a)].classList.add("right");
        fb.textContent = (ok ? "Yes! " : "Not quite. ") + (c.why || "");
        fb.className = "fb " + (ok ? "good" : "bad");
        step.textContent = `${score} / ${tries} right`;
        tag.textContent = `Practice · ${queue.length} left`;
        next.textContent = queue.length ? "Next one" : "Finish";
        next.disabled = false;
        next.focus();
      });
      t = target = beatT(q.beat);
      paint();
      return;
    }
    buttons(
      quiz.items.map((x) => x[1]),
      (k, el) => {
        if (done) return;
        const ok = quiz.items[k] === q;
        tries++;
        if (ok) score++;
        streak = ok ? streak + 1 : 0;
        if (!ok) {
          queue.push(q);
        }
        done = true;
        el.classList.add(ok ? "right" : "wrong");
        if (!ok) opts.children[quiz.items.indexOf(q)].classList.add("right");
        fb.textContent = (ok ? "Yes! " : `It's ${q[1]}. `) + q[2];
        fb.className = "fb " + (ok ? "good" : "bad");
        step.textContent = `${score} / ${tries} right`;
        tag.textContent = `Practice · ${queue.length} left`;
        next.textContent = queue.length ? "Next one" : "Finish";
        next.disabled = false;
        next.focus();
      },
    );
    t = target = q[0];
    paint();
  }

  next.onclick = () => {
    if (next.disabled) return;
    if (finished) { location.href = (NEXT[key] || ["./"])[0]; return; }
    if (inQuiz) return newQ();
    if (i < beats.length - 1) {
      i++;
      show();
    } else if (quiz) newQ();
    else {
      i = 0;
      show();
    }
  };
  prev.onclick = () => {
    if (finished) { finished = false; prev.textContent = "Back"; queue = []; q = null; tries = 0; newQ(); return; }
    if (inQuiz) {
      queue = []; q = null; tries = 0;
      show();
      return;
    }
    if (i > 0) {
      i--;
      show();
    }
  };
  addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      next.click();
    }
    if (e.key === "ArrowLeft") prev.click();
  });
  t = target = beatT(i);
  show();
  // read-only handle for the headless audit
  window.__walk = { beats, key, quiz, get q() { return q; } };
}
