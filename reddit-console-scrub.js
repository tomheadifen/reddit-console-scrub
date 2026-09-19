// Reddit comment scrubber — browser DevTools Console script.
//
// HOW TO USE:
//   1. Log into https://old.reddit.com normally.
//   2. Open DevTools (F12) -> Console tab.
//   3. Paste this whole file, edit the constants below, press Enter.
//   4. Check the DRY_RUN log output (nothing changed yet).
//   5. Set DRY_RUN = false and paste again to actually run it.
//
// To stop a run early: type `window.STOP_SCRUB = true` and press Enter.
// To resume after a stop/crash/rate limit: just paste and run again —
// already-done comments are skipped automatically.
// See README.md for details on all of the above.

(async function scrubComments() {
  const USERNAME = "your-username-here";
  const DRY_RUN = true; // set to false to actually make changes
  const DELETE = false; // set to true to delete comments after editing them -- see the note above first
  const LIMIT = 5; // max number of comments to process this run; set to 'Infinity' for a full run
  const OFFSET = 0; // manually skip this many oldest comments before starting (see RESUMING note above)
  const RESET_PROGRESS = false; // set to true for one run to forget saved progress and reprocess everything
  const MIN_DELAY_MS = 5000; // don't edit this too low otherwise reddit might block you for being a bot.
  const MAX_DELAY_MS = 10000;

  window.STOP_SCRUB = false; // flip to true from the console at any time to halt after the in-flight request finishes

  const WORDS = `purple gravel wandering fence hollow lantern cobalt mumble thicket
    drizzle rusted whisper orbit tangent velvet crumble echo lattice
    moth static gully anchor plume ember cinder husk quiver bramble
    nettle sludge glimmer knot rift spool tinder wrought yonder zephyr
    crag dusk fjord glade ivy jolt kiln loam murk nook opal`.split(/\s+/).filter(Boolean);

  function gibberish(minWords = 6, maxWords = 18) {
    const n = minWords + Math.floor(Math.random() * (maxWords - minWords + 1));
    const words = [];
    for (let i = 0; i < n; i++) words.push(WORDS[Math.floor(Math.random() * WORDS.length)]);
    return words.join(" ") + ".";
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay() {
    return sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
  }

  function getModhash() {
    if (window.r && window.r.config && window.r.config.modhash) {
      return window.r.config.modhash;
    }
    const input = document.querySelector('input[name="uh"]');
    if (input) return input.value;
    return null;
  }

  // Base class for anything that should stop the whole run cleanly (as opposed to
  // a per-comment error, which just gets logged and skipped). Progress already
  // saved stays saved either way.
  class Halt extends Error {}
  class StopRequested extends Halt {
    constructor() {
      super("Halted by user request (STOP_SCRUB).");
    }
  }
  class RateLimited extends Halt {}

  function checkStop() {
    if (window.STOP_SCRUB) throw new StopRequested();
  }

  // Logs Reddit's rate-limit headers (when present) so you can see how close
  // to being throttled you are, without the script acting on them itself.
  function logRateLimitHeaders(res, label) {
    const used = res.headers.get("x-ratelimit-used");
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (used === null && remaining === null && reset === null) return;
    console.log(`  [ratelimit] used=${used} remaining=${remaining} reset=${reset}s (${label})`);
  }

  // Fetches and stops the whole run immediately on 429 -- no retrying, Reddit is
  // telling us to back off, so we bail out and let you decide what to do next.
  async function fetchChecked(url, options, label) {
    checkStop();
    const res = await fetch(url, options);
    logRateLimitHeaders(res, label);
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new RateLimited(
        `Rate limited (429) on ${label}.${retryAfter ? ` Reddit says retry-after ${retryAfter}s.` : ""} ` +
          `Stopping the run -- raise MIN_DELAY_MS/MAX_DELAY_MS and try again later; ` +
          `already-done comments will be skipped automatically.`
      );
    }
    return res;
  }

  async function deleteComment(fullname) {
    const res = await fetchChecked(
      "https://old.reddit.com/api/del",
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id: fullname, uh: modhash }),
      },
      `delete ${fullname}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // --- Resumable progress (localStorage), keyed per-username + DELETE mode ---
  const PROGRESS_KEY = `reddit-scrub-progress:${USERNAME}:${DELETE ? "delete" : "edit"}`;

  function loadProgress() {
    if (RESET_PROGRESS) {
      localStorage.removeItem(PROGRESS_KEY);
      return new Set();
    }
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) {
      console.warn("Couldn't read saved progress, starting fresh:", e);
      return new Set();
    }
  }

  function saveProgress(doneSet) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify([...doneSet]));
    } catch (e) {
      console.warn("Couldn't persist progress to localStorage:", e);
    }
  }

  const modhash = getModhash();
  if (!modhash) {
    console.error("Couldn't find your modhash (anti-CSRF token). Make sure you're logged in and on old.reddit.com.");
    return;
  }

  // Reddit's listing only exposes newest-first pagination, so we collect
  // everything first, then walk it in reverse to process oldest-first.
  console.log("Collecting your full comment history (this only reads, doesn't change anything)...");
  const allComments = [];
  let after = null;
  let page = 1;
  let halted = false;

  try {
    while (true) {
      checkStop();
      const url = `https://old.reddit.com/user/${USERNAME}/comments.json?limit=100&sort=new${after ? `&after=${after}` : ""}`;
      const res = await fetchChecked(url, { credentials: "same-origin" }, `listing page ${page}`);
      if (!res.ok) {
        console.error(`Failed to fetch comment listing (page ${page}): HTTP ${res.status}`);
        break;
      }
      const json = await res.json();
      const items = json.data.children;
      console.log(`  fetched page ${page}: ${items.length} comments`);
      if (items.length === 0) break;

      allComments.push(...items.map((item) => item.data));

      after = json.data.after;
      if (!after) break;
      page++;
      await sleep(500 + Math.random() * 500);
    }
  } catch (e) {
    if (e instanceof Halt) {
      console.log(`${e.message} Nothing was changed yet.`);
      return;
    }
    throw e;
  }

  allComments.reverse(); // oldest first

  const done = loadProgress();
  console.log(
    `Collected ${allComments.length} comments total (${done.size} already done in a previous run). ` +
      `Processing oldest first, skipping the first OFFSET=${OFFSET}, up to LIMIT=${LIMIT}.`
  );

  let edited = 0;
  let deleted = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < allComments.length; i++) {
    if (edited >= LIMIT) break;
    if (i < OFFSET) continue;

    const c = allComments[i];
    const preview = (c.body || "").slice(0, 60).replace(/\n/g, " ");
    const link = `https://old.reddit.com${c.permalink}`;
    const position = i + 1; // 1-based, handy to note down as a future OFFSET

    try {
      checkStop();
    } catch (e) {
      console.log(`${e.message} (position ${position}). Progress saved -- just re-run to resume.`);
      halted = true;
      break;
    }

    if (done.has(c.name)) {
      skipped++;
      continue;
    }

    if (c.archived) {
      console.log(`SKIP (archived) [#${position}]: "${preview}..." ${link}`);
      skipped++;
      continue;
    }

    const newBody = gibberish();

    if (DRY_RUN) {
      console.log(`WOULD ${DELETE ? "EDIT + DELETE" : "EDIT"} [#${position}]: "${preview}..." -> "${newBody}" ${link}`);
      edited++;
      continue;
    }

    try {
      const editRes = await fetchChecked(
        "https://old.reddit.com/api/editusertext",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            thing_id: c.name,
            text: newBody,
            api_type: "json",
            uh: modhash,
          }),
        },
        `edit ${c.name}`
      );
      const editJson = await editRes.json();
      const apiErrors = editJson?.json?.errors;
      if (apiErrors && apiErrors.length > 0) {
        console.warn(`ERROR editing ${c.name}: ${JSON.stringify(apiErrors)} ${link}`);
        errors++;
        await randomDelay();
        continue;
      }

      console.log(`EDITED [#${position}]: "${preview}..." -> "${newBody}" ${link}`);
      edited++;

      if (DELETE) {
        await randomDelay();
        try {
          await deleteComment(c.name);
          console.log(`DELETED: ${c.name} ${link}`);
          deleted++;
        } catch (e) {
          if (e instanceof Halt) throw e;
          console.warn(`ERROR deleting ${c.name}: ${e} ${link}`);
          errors++;
          await randomDelay();
          continue;
        }
      }

      // Only mark as done once it's fully in the state this run intends (edited, or edited+deleted).
      done.add(c.name);
      saveProgress(done);
    } catch (e) {
      if (e instanceof Halt) {
        console.log(`${e.message} (position ${position}). Progress saved -- just re-run to resume.`);
        halted = true;
        break;
      }
      console.warn(`ERROR editing ${c.name}: ${e} ${link}`);
      errors++;
    }

    await randomDelay();
  }

  console.log(
    `\n${halted ? "Halted early. " : "Done. "}Edited: ${edited}  Deleted: ${deleted}  Skipped: ${skipped}  Errors: ${errors}`
  );
  if (DRY_RUN) console.log("This was a DRY RUN -- nothing was changed. Set DRY_RUN = false to actually make changes.");
})();
