# reddit-console-scrub

Overwrites your own Reddit comments with random gibberish, oldest first. Runs entirely as a browser console script in a tab where you're already logged into Reddit normally — no API keys, no app registration, no separate automated browser, no password or session token ever leaves your browser.

Reddit's official API now requires manual approval for new apps (small/personal projects are commonly rejected), and a standalone automated browser (e.g. Selenium) gets blocked by Reddit's bot detection. This script sidesteps both: it makes the exact same authenticated requests old.reddit.com's own "edit" button makes, from inside your real session.

## Usage

1. Go to [old.reddit.com](https://old.reddit.com) and make sure you're logged in normally.
2. Open DevTools (`F12`) → **Console** tab.
3. Open [`reddit-console-scrub.js`](reddit-console-scrub.js), copy the whole file.
4. Edit the constants at the top:
   - `USERNAME` — your Reddit username
   - `DRY_RUN` — leave as `true` for the first run (logs what it *would* do, changes nothing)
   - `LIMIT` — max number of comments to process this run (set to `Infinity` for a full run)
   - `DELETE` — leave as `false` at first; see **Edit then delete** below before turning this on
5. Paste into the console and press Enter.
6. Check the log output — each line links to the comment. Once you're happy with the dry run, set `DRY_RUN = false` and paste again to actually make changes.

## Edit then delete

Don't set `DELETE = true` on your first run. Bots that scrape and archive Reddit (search engines, mirrors, Pushshift-likes) capture comment content on their own schedule, and a deleted comment is often still reconstructable from whatever the last scrape saw before the delete. If you edit and delete in the same run, a bot that scraped the original text moments earlier still has it.

The recommended sequence:

1. Run with `DELETE = false` to overwrite your comments with gibberish.
2. Leave them up for a few months so scrapers have time to (re-)crawl and pick up the overwritten version.
3. Run again with `DELETE = true` to actually remove them (it edits again immediately before deleting, as a last safety overwrite).

## Notes

- Comments are processed **oldest first**.
- Comments in archived threads (usually >6 months old) can't be edited by anyone, including you — these are skipped automatically (and never deleted either, since they can't be overwritten first).
- Edits/deletes are rate-limited with a randomized delay (`MIN_DELAY_MS`/`MAX_DELAY_MS`) to avoid tripping abuse detection. Don't set these too low.
