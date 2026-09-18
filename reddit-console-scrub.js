// Reddit comment scrubber — run this in your browser's DevTools Console
// while logged into old.reddit.com. Overwrites your own comments with
// random gibberish (edits only, does not delete anything).
//
// HOW TO USE:
//   1. Go to https://old.reddit.com and make sure you're logged in normally.
//   2. Open DevTools (F12) -> Console tab.
//   3. Paste this whole file, edit the constants at the top and press Enter.
//   4. Review the DRY_RUN log output first (nothing is changed yet).
//   5. When ready, set DRY_RUN = false below, paste again, press Enter.
//
// This makes the exact same authenticated requests old.reddit.com's own
// "edit" button makes — it runs in your real, already-logged-in tab, so
// there's no separate token, password, or automated browser involved.
//
// Processes your OLDEST comments first. LIMIT caps how many get edited in
// a single run (raise it once you're happy with the results on a few).
//
// GOOD PRACTICE: don't set DELETE = true on the same run as your first edit.
// Bots that scrape and archive Reddit (Pushshift-likes, search engines,
// random mirrors) capture comment content on their own schedule, and a
// deleted comment is often still reconstructable from whatever the last
// scrape saw. If you edit and delete in the same breath, a bot that scraped
// the ORIGINAL text moments earlier still has it. Overwrite first with
// DELETE = false, leave the gibberish up for a few months so scrapers have
// time to (re-)crawl and capture the overwritten version, THEN come back
// and run again with DELETE = true to remove them for good.

(async function scrubComments() {
  const USERNAME = "your-username-here";
  const DRY_RUN = true; // set to false to actually make changes
  const DELETE = false; // set to true to delete comments after editing them -- see the note above first
  const LIMIT = 5; // max number of comments to process this run; set to 'Infinity' for a full run
  const MIN_DELAY_MS = 2500; // don't edit this too low otherwise reddit might block you for being a bot.
  const MAX_DELAY_MS = 5000;

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

  async function deleteComment(fullname) {
    const res = await fetch("https://old.reddit.com/api/del", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id: fullname, uh: modhash }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  while (true) {
    const url = `https://old.reddit.com/user/${USERNAME}/comments.json?limit=100&sort=new${after ? `&after=${after}` : ""}`;
    const res = await fetch(url, { credentials: "same-origin" });
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

  allComments.reverse(); // oldest first
  console.log(`Collected ${allComments.length} comments total. Processing oldest first, up to LIMIT=${LIMIT}.`);

  let edited = 0;
  let deleted = 0;
  let skipped = 0;
  let errors = 0;

  for (const c of allComments) {
    if (edited >= LIMIT) break;

    const preview = (c.body || "").slice(0, 60).replace(/\n/g, " ");
    const link = `https://old.reddit.com${c.permalink}`;

    if (c.archived) {
      console.log(`SKIP (archived): "${preview}..." ${link}`);
      skipped++;
      continue;
    }

    const newBody = gibberish();

    if (DRY_RUN) {
      console.log(`WOULD ${DELETE ? "EDIT + DELETE" : "EDIT"}: "${preview}..." -> "${newBody}" ${link}`);
      edited++;
      continue;
    }

    try {
      const editRes = await fetch("https://old.reddit.com/api/editusertext", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          thing_id: c.name,
          text: newBody,
          api_type: "json",
          uh: modhash,
        }),
      });
      const editJson = await editRes.json();
      const apiErrors = editJson?.json?.errors;
      if (apiErrors && apiErrors.length > 0) {
        console.warn(`ERROR editing ${c.name}: ${JSON.stringify(apiErrors)} ${link}`);
        errors++;
        await randomDelay();
        continue;
      }

      console.log(`EDITED: "${preview}..." -> "${newBody}" ${link}`);
      edited++;

      if (DELETE) {
        await randomDelay();
        try {
          await deleteComment(c.name);
          console.log(`DELETED: ${c.name} ${link}`);
          deleted++;
        } catch (e) {
          console.warn(`ERROR deleting ${c.name}: ${e} ${link}`);
          errors++;
        }
      }
    } catch (e) {
      console.warn(`ERROR editing ${c.name}: ${e} ${link}`);
      errors++;
    }

    await randomDelay();
  }

  console.log(`\nDone. Edited: ${edited}  Deleted: ${deleted}  Skipped (archived): ${skipped}  Errors: ${errors}`);
  if (DRY_RUN) console.log("This was a DRY RUN -- nothing was changed. Set DRY_RUN = false to actually make changes.");
})();
