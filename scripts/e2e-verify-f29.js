// F29: the staged queue must be usable at scale.
//
// This suite exists because a person typed a raw thought into the Crafting
// Table, staged it, and then could not get back to it. With 476 items already
// queued the newest one sat 475 rows from the top, with no paging, no filter,
// and nothing on screen saying so. Vault search does index the queue but caps
// at 30 results, so 446 of 476 were unreachable by searching either.
//
// The bug was not a sort comparator — it was that the queue had no defined
// order and no way to narrow it. So these checks are about a person getting
// back to one specific thought, by content, and loading it.
//
// Deliberately a browser test. A unit test on the sort would have passed while
// the item sat at the bottom of the page.
// One definition of the environment, shared by every suite. F27 fails the
// build if a suite re-derives any of it — and it caught all three of the ways
// this file got it wrong the first time.
const { launch } = require('./lib/cdp.js');
const fs = require('node:fs');
const path = require('node:path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const env = require('./lib/env.js');
const { ROOT, FRONT, API } = env;
const { seedCorpus, cleanCorpus } = require('./lib/seed-queue.js');
const Q = path.join(ROOT, 'prism', 'vault', 'ingestion', 'unprocessed');

// The suite's own corpus. The queue directory is gitignored and ships EMPTY on a
// fresh clone, so every assertion below is stated against SEEDED files rather
// than whatever backlog happens to exist on the box. See scripts/lib/seed-queue.js.
let SEED = null;
const SEEDED_TOTAL = 45;      // must match SEED_COUNT in seed-queue.js

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { console.log('  PASS ' + n); pass++; }
  else { console.log('  FAIL ' + n + (d ? '  — ' + d : '')); fail++; }
};
const section = (s) => console.log('\n' + s);

// The item this run stages gets a token that is NOT a substring of the probe,
// so "the probe matches exactly the seeded corpus" is a closed set. They
// originally shared a stem, the staged item matched the probe as well, and the
// header correctly reported 46 while the assertion expected 45 — a real
// inconsistency in the test's own premise, not a product fault.
let SINGLE = null;

async function typeFilter(page, text) {
  // A BUBBLING InputEvent. A bare `new Event('input')` does not bubble, so the
  // inline oninput handler never fires — an earlier version of this suite
  // dispatched that and every filter assertion was silently measuring an
  // unfiltered list.
  await page.eval(`(() => {
    const f = document.getElementById('desk-queue-filter');
    f.value = ${JSON.stringify(text)};
    f.dispatchEvent(new InputEvent('input', { bubbles: true }));
  })()`);
  // Wait for the CONTENT SCAN to finish rather than sleeping a guess. The scan
  // reads hundreds of files; a fixed sleep read the header mid-scan and saw
  // the stale unfiltered count, which looked exactly like the filter having
  // failed to apply.
  if (text) {
    await page.waitFor(
      `(() => { const h = document.querySelector('[data-queue-count]');
         return h && /\\d+ of \\d+ match|Nothing staged matches/.test(h.textContent); })()`,
      30000, 'the queue filter to report a match count');
  }
  await sleep(600);   // let the DOM settle after the count appears
}

const rows = (page) => page.eval(
  'document.querySelectorAll(".desk-queue-list .desk-continue-row").length');
const header = (page) => page.eval(
  `((document.querySelector('[data-queue-count]')||{}).textContent || '').trim()`);

(async () => {
  const b = await launch();
  const page = await b.newPage();
  await page.ready();
  let stagedName = null;
  try {
    // Seed BEFORE the page loads, so the first render already sees a populated
    // queue. seedCorpus creates the directory too: it is gitignored, and git
    // does not track empty directories, so on a fresh clone it does not exist
    // and a bare readdirSync below would throw ENOENT.
    SEED = seedCorpus(SEEDED_TOTAL, 'f29');
    // Not a substring of SEED.probe — see the note on SINGLE.
    SINGLE = `zzsolo${Date.now().toString(36)}${process.pid}`;

    await page.goto(FRONT + '/prism/');
    await page.waitFor("document.getElementById('desk-content')", 15000, 'desk');
    await sleep(2000);

    const corpus = await page.eval('_deskQueue.all.length');
    const seededPresent = await page.eval(
      `_deskQueue.all.filter(f => f.name.includes(${JSON.stringify(SEED.probe)})).length`);
    console.log(`\n  seeded ${SEED.files.length} files, probe ${SEED.probe}`);
    console.log(`  queue holds ${corpus} items (${seededPresent} from this run)`);
    check('the seeded corpus is present in the queue',
          seededPresent === SEEDED_TOTAL, `${seededPresent} of ${SEEDED_TOTAL}`);

    // ── 1. Stage a thought, exactly as the user did ────────────────────
    section('Staging');
    const before = fs.readdirSync(Q).length;
    await page.eval(`(() => {
      const t = document.getElementById('desk-content');
      t.value = ${JSON.stringify(SINGLE)};
      t.dispatchEvent(new InputEvent('input', { bubbles: true }));
    })()`);
    await page.eval('deskStageOnly()');
    await sleep(2500);

    const files = fs.readdirSync(Q);
    const staged = files.filter(f => {
      try { return fs.readFileSync(path.join(Q, f), 'utf8').includes(SINGLE); }
      catch (e) { return false; }
    });
    check('the thought was staged', staged.length === 1, `${staged.length} found`);
    stagedName = staged[0];
    console.log(`    staged as ${stagedName}`);
    console.log(`    queue ${before} -> ${files.length}`);

    // ── 2. Come back later ─────────────────────────────────────────────
    section('Returning to the queue');
    await page.goto(FRONT + '/prism/');
    await page.waitFor("document.getElementById('desk-content')", 15000, 'desk');
    await sleep(2000);

    const shown = await rows(page);
    const hdr = await header(page);
    console.log(`    ${shown} rows rendered · ${hdr.trim().slice(0, 60)}`);

    // F29b replaced the collapse model with real pagination, so the property
    // is now "exactly one page" rather than "fewer than 40".
    check('the queue shows exactly one page, not all of it',
          shown > 0 && shown <= 20, `${shown} rows`);
    check('the header says the total, not just what is shown',
          new RegExp(`\\b${files.length}\\b`).test(hdr), hdr.slice(0, 60));
    // 45 seeded + the one this run staged = 46 total, so page 1 is exactly full.
    check('page 1 is full — 20 of the seeded corpus',
          shown === Math.min(20, files.length), `${shown} rows, ${files.length} total`);

    // ── 3. THE BUG: newest first ──────────────────────────────────────
    // The staged item is compared against the newest SEEDED item, not "row 1":
    // seedCorpus writes 45 files within the same second, so "newest first"
    // among them is decided by mtime at sub-second resolution and the staged
    // file — written later — must be the single newest of all 46.
    const first = await page.eval(`(() => {
      const r = document.querySelector('.desk-queue-list .desk-continue-row');
      return r ? r.dataset.queueName : null; })()`);
    check('the item just staged is FIRST — this is the bug that was reported',
          first === stagedName, `first=${first} expected=${stagedName}`);

    // ── 4. Find it by CONTENT, which is how a person remembers it ─────
    section('Filtering');
    await typeFilter(page, SINGLE);
    const hits = await rows(page);
    const hitNames = await page.eval(`(() => {
      const r = [...document.querySelectorAll('.desk-queue-list .desk-continue-row')];
      return JSON.stringify(r.map(x => x.dataset.queueName)); })()`);
    check('a content filter finds the thought',
          JSON.parse(hitNames).includes(stagedName), hitNames.slice(0, 90));
    // Under pagination the DOM holds one PAGE, so the row count is not the
    // match count. The header is the authority on how many matched — and this
    // suite stages a marker unique to its own run, so that number must be 1.
    const onlyHdr = await header(page);
    const matched = Number((onlyHdr.match(/^(\d+) of/) || [])[1] || -1);
    check('and matches ONLY it — one hit in the whole queue',
          matched === 1, `header says ${matched}: "${onlyHdr.slice(0, 60)}"`);

    // ── 5. A miss is stated in words ───────────────────────────────────
    await typeFilter(page, 'nothingmatchesthisatall');
    const empty = await page.eval(
      `(() => { const e = document.querySelector('.desk-queue-empty');
         return e ? e.textContent.trim() : '(blank)'; })()`);
    check('an empty result is stated in words, not shown as a blank list',
          /Nothing staged matches/.test(empty), empty.slice(0, 70));

    // ── 6. A filter is UNCAPPED — vault search caps at 30 ─────────────
    section('A filter is not capped');
    // The seeded probe word, NOT "epiphany". "epiphany" only existed on the box
    // where a leak had accumulated hundreds of files; on a clean checkout it
    // matches nothing, which is precisely why this suite needed seeding. The
    // probe is unique to THIS run, so the match count is knowable exactly.
    const broadCount = await page.eval(
      `_deskQueue.all.filter(f => f.name.includes(${JSON.stringify(SEED.probe)})).length`);
    await typeFilter(page, SEED.probe);
    const broadRows = await rows(page);
    const broadHdr = await header(page);
    // The header reports how many MATCHED; the page shows one page of them.
    // Both matter: "uncapped" means the match set is complete, not that every
    // row is dumped on screen at once.
    const reported = Number((broadHdr.match(/(\d+) of/) || [])[1] || -1);
    console.log(`    probe -> ${broadRows} rows on page 1, `
              + `${reported} matched (vault search caps at 30)`);
    check('the probe matches exactly the seeded corpus',
          broadCount === SEEDED_TOTAL, `${broadCount} vs ${SEEDED_TOTAL}`);
    check('the MATCH set is uncapped — every hit is counted',
          reported === broadCount, `header ${reported} vs ${broadCount} queued`);
    check('and it beats the 30-result vault search cap',
          reported > 30, String(reported));
    check('while still showing only one page of them',
          broadRows <= 20, `${broadRows} rows`);

    // ── 7. Clearing returns to the newest page ─────────────────────────
    await typeFilter(page, '');
    check('clearing the filter returns to page 1 of the whole queue',
          (await page.eval('_deskQueue.page')) === 1 && (await rows(page)) === shown,
          `page ${await page.eval('_deskQueue.page')}, ${await rows(page)} rows`);

    // ── 8. And it actually LOADS — the point of all of it ─────────────
    section('Loading it back');
    await typeFilter(page, SINGLE);
    const target = await page.eval(`(() => {
      const r = [...document.querySelectorAll('.desk-queue-list .desk-continue-row')]
        .find(x => x.dataset.queueName === ${JSON.stringify(stagedName)});
      return r ? r.dataset.queuePath : null; })()`);
    check('the filtered row is the staged item', target !== null, String(target));
    await page.eval(`_deskLoadQueued(${JSON.stringify(target)})`);
    await sleep(2500);
    const loaded = await page.eval(`document.getElementById('desk-content').value`);
    check('the thought loads back into the desk',
          loaded.includes(SINGLE), loaded.slice(0, 70));

    // ── 9. No filter left behind ──────────────────────────────────────
    check('the desk is ready for the next thought',
          await page.eval(`!!document.getElementById('desk-content')`));
    const errs = page.consoleMsgs.filter(m => m.type === 'error');
    check('no console errors', errs.length === 0,
          errs.map(e => e.text).join(' | ').slice(0, 140));
  } finally {
    await b.close();
    // Remove the staged item, then the seeded corpus — ONLY files this run
    // created. A developer's own staged thoughts are never touched, and the
    // queue directory is removed too if this run created it, so the vault is
    // left exactly as it was found. That is what makes a second run on the same
    // clone meaningful.
    // Staging writes TWO files: the queue item and an immutable SOURCE mirror
    // under source/unordereds/. Cleaning only the queue left the mirror behind,
    // so every F29 run left residue in the vault even when the queue was empty
    // — which is what the gate's "run twice, prove no residue" caught.
    if (stagedName) {
      const stem = stagedName.replace(/\.md$/, '');
      for (const dir of ['ingestion/unprocessed', 'source/unordereds']) {
        for (const n of [stagedName, `${stem}.md`]) {
          try { fs.unlinkSync(path.join(ROOT, 'prism', 'vault', dir, n)); }
          catch (e) { /* not there */ }
        }
      }
    }
    cleanCorpus(SEED);
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });