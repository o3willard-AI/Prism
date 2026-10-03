// F29b: real pagination, and a Load that leads somewhere.
//
// The first fix had a single "Show N older more" button that rendered every
// remaining row at once. A person hit it once and 500 rows became scrollable —
// correctly called out as not being pagination. These checks assert the
// opposite of that: a page NEVER exceeds its size, whatever you click.
// One definition of the environment, shared by every suite. F27 fails the
// build if a suite re-derives any of it — and caught both of the ways this
// file got it wrong the first time.
const { launch } = require('./lib/cdp.js');
const fs = require('node:fs');
const path = require('node:path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const env = require('./lib/env.js');
const { ROOT, FRONT } = env;
const { seedCorpus, cleanCorpus } = require('./lib/seed-queue.js');
const Q = path.join(ROOT, 'prism', 'vault', 'ingestion', 'unprocessed');

// This suite's own corpus. The queue directory is gitignored and ships empty,
// so every size below is a property of WHAT WAS SEEDED rather than of
// whatever a developer happened to accumulate. See scripts/lib/seed-queue.js.
let SEED = null;
const SEEDED_TOTAL = 45;      // must match SEED_COUNT in seed-queue.js
const PER_DEFAULT = 20;

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { console.log('  PASS ' + n); pass++; }
  else { console.log('  FAIL ' + n + (d ? '  — ' + d : '')); fail++; }
};
const section = (s) => console.log('\n' + s);
const rows = (page) => page.eval(
  'document.querySelectorAll(".desk-queue-list .desk-continue-row").length');

(async () => {
  const b = await launch();
  const page = await b.newPage();
  await page.ready();
  try {
    // Seed BEFORE the page loads. seedCorpus creates the directory too: it is
    // gitignored, and git does not track empty directories, so on a fresh clone
    // it does not exist and a bare readdirSync would throw ENOENT.
    SEED = seedCorpus(SEEDED_TOTAL, 'f29b');

    await page.goto(FRONT + '/prism/');
    await page.waitFor("document.getElementById('desk-content')", 15000, 'desk');
    await sleep(2500);

    const total = await page.eval('_deskQueue.all.length');
    const per = await page.eval('_deskQueue.per');
    const seededPresent = await page.eval(
      `_deskQueue.all.filter(f => f.name.includes(${JSON.stringify(SEED.probe)})).length`);
    console.log(`\n  seeded ${SEED.files.length} files, probe ${SEED.probe}`);
    console.log(`  queue: ${total} items, page size ${per}`);
    check('the seeded corpus is what the suite is measuring',
          seededPresent === SEEDED_TOTAL && total >= SEEDED_TOTAL,
          `${seededPresent} seeded, ${total} total`);
    check('the page size starts at the documented default',
          per === PER_DEFAULT, String(per));

    section('A page is a page');
    // min(20, total): with 45 seeded on a clean clone this is 20, but written so
    // the assertion describes the rule rather than the number that happens to
    // be there. A developer's own backlog counts too — the pager pages
    // whatever is in the queue.
    check('the default page shows min(20, total) rows',
          (await rows(page)) === Math.min(20, total),
          `${await rows(page)} rows, ${total} total`);
    check('and never more than the page size',
          (await rows(page)) <= per, `${await rows(page)} > ${per}`);

    section('Navigating');
    const firstPage = await page.eval(
      `document.querySelector('.desk-queue-list .desk-continue-row').dataset.queueName`);
    await page.eval(`_deskQueuePage(2)`);
    await sleep(1200);
    check('page 2 shows another min(20, total - 20) rows',
          (await rows(page)) === Math.min(20, Math.max(0, total - 20)),
          `${await rows(page)} rows, ${total} total`);
    const secondPage = await page.eval(
      `document.querySelector('.desk-queue-list .desk-continue-row').dataset.queueName`);
    check('page 2 has DIFFERENT items from page 1', secondPage !== firstPage,
          `${firstPage} vs ${secondPage}`);
    const range = await page.eval(
      `(() => { const e = document.querySelector('.desk-queue-range');
         return e ? e.textContent.trim() : ''; })()`);
    // seededPer+1 .. seededPer*2 of seededTotal — 21–40 of 45, in words rather
    // than as literals, so a different seed size still passes.
    // The pager describes the WHOLE queue, not the seeded subset. A developer
    // with a real backlog beside the seed is a legitimate environment, and the
    // range must therefore be derived from `total` — which includes both. On a
    // clean clone total IS the seed, so the two agree.
    const wantRange = new RegExp(
      `\\b${20 + 1}\\s*[–-]\\s*${40}\\s+of\\s+${total}\\b`);
    check('the range says where we are', wantRange.test(range),
          `${range} (want 21–40 of ${total})`);
    check('and the page counter agrees', /Page 2 of/.test(await page.eval(
      `document.querySelector('.desk-queue-pageno').textContent`)),
      await page.eval(`document.querySelector('.desk-queue-pageno').textContent`));

    section('The button that broke it');
    // THE regression: clicking through many pages must never accumulate rows.
    for (const p of [3, 5, 8, 2, 1]) {
      await page.eval(`_deskQueuePage(${p})`);
      await sleep(250);
    }
    await sleep(800);
    check('after paging around, the list is STILL one page',
          (await rows(page)) === 20, `${await rows(page)} rows`);
    check('and it did not grow to the whole queue',
          (await rows(page)) < 40, `${await rows(page)} rows`);

    section('Page size');
    for (const size of [40, 100, 20]) {
      await page.eval(`_deskQueueSetPer(${size})`);
      await sleep(600);
      const n = await rows(page);
      check(`page size ${size} shows at most ${size}`, n <= size, `${n} rows`);
      // Only assert an exact fill when the QUEUE is bigger than the page; otherwise
      // the page shows the remainder, which is correct. `total` rather than the
      // seeded count, for the same reason as the range and last-page checks.
      if (size < total) {
        check(`page size ${size} actually shows ${size}`, n === size, `${n} of ${total} total`);
      }
    }
    await page.eval(`_deskQueueSetPer(20)`);
    await sleep(400);

    section('Last page');
    // Page count and remainder computed from the WHOLE queue, which is what the
    // pager actually pages. Using the seeded count was right on a clean clone
    // and wrong beside a developer's real backlog — the pager would still be
    // correct while the assertion failed.
    const lastPage = Math.ceil(total / 20);
    const expect = total - (lastPage - 1) * 20;
    await page.eval(`_deskQueuePage(${lastPage})`);
    await sleep(800);
    const lastRows = await rows(page);
    check(`the last page holds the remainder (${expect})`, lastRows === expect,
          `${lastRows} rows, expected ${expect} of ${total}`);
    check('and the remainder is non-zero, so the assertion has teeth',
          expect > 0, String(expect));
    check('Next is disabled on the last page', await page.eval(
      `[...document.querySelectorAll('.desk-queue-pager button')]
        .some(b => /Next/.test(b.textContent) && b.disabled)`));
    check('and Prev is enabled', await page.eval(
      `[...document.querySelectorAll('.desk-queue-pager button')]
        .some(b => /Prev/.test(b.textContent) && !b.disabled)`));

    section('Paging survives a filter');
    await page.eval(`_deskQueuePage(4)`);
    await sleep(400);
    await page.eval(`(() => {
      const f = document.getElementById('desk-queue-filter');
      f.value = ${JSON.stringify(SEED.probe)};
      f.dispatchEvent(new InputEvent('input', { bubbles: true }));
    })()`);
    // Wait for the scan to report rather than sleeping a guess.
    await page.waitFor(
      `(() => { const h = document.querySelector('[data-queue-count]');
         return h && /\\d+ of \\d+ match/.test(h.textContent); })()`,
      30000, 'the queue filter to report a match count');
    void seededPresent;
    await sleep(600);
    check('a new filter resets to page 1', (await page.eval('_deskQueue.page')) === 1,
          String(await page.eval('_deskQueue.page')));
    check('and that page respects the page size',
          (await rows(page)) <= 20, `${await rows(page)} rows`);
    await page.eval(`(() => {
      const f = document.getElementById('desk-queue-filter');
      f.value = '';
      f.dispatchEvent(new InputEvent('input', { bubbles: true }));
    })()`);
    await page.waitFor(
      `(() => { const h = document.querySelector('[data-queue-count]');
         return h && /staged · newest first/.test(h.textContent); })()`,
      15000, 'the filter to clear');

    section('Load leads somewhere');
    const target = await page.eval(`_deskQueue.all[0].path`);
    await page.eval(`_deskLoadQueued(${JSON.stringify(target)})`);
    await sleep(2500);
    const after = await page.eval(`JSON.stringify({
      content: (document.getElementById('desk-content').value||'').length,
      focused: document.activeElement && document.activeElement.id,
      title: document.getElementById('topbar-title').textContent,
      stillOnDesk: !!document.getElementById('desk-content'),
    })`);
    const a = JSON.parse(after);
    check('the thought lands in the input', a.content > 0, String(a.content));
    check('the input takes focus', a.focused === 'desk-content', String(a.focused));
    check('and you stay on the Crafting Table', a.stillOnDesk && /Crafting/i.test(a.title),
          a.title);

    const errs = page.consoleMsgs.filter(m => m.type === 'error');
    check('no console errors', errs.length === 0,
          errs.map(e => e.text).join(' | ').slice(0, 140));
  } finally {
    await b.close();
    // Remove ONLY what this run created, and the directory too if this run
    // created it — so the vault is exactly as found and a second run on the
    // same clone proves the seed/cleanup round-trips.
    cleanCorpus(SEED);
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });