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
const Q = path.join(ROOT, 'prism', 'vault', 'ingestion', 'unprocessed');

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
    await page.goto(FRONT + '/prism/');
    await page.waitFor("document.getElementById('desk-content')", 15000, 'desk');
    await sleep(2500);

    const total = await page.eval('_deskQueue.all.length');
    const per = await page.eval('_deskQueue.per');
    console.log(`\n  queue: ${total} items, page size ${per}`);

    section('A page is a page');
    check('the default page shows 20 rows', (await rows(page)) === 20, String(await rows(page)));
    check('and never more than the page size',
          (await rows(page)) <= per, `${await rows(page)} > ${per}`);

    section('Navigating');
    const firstPage = await page.eval(
      `document.querySelector('.desk-queue-list .desk-continue-row').dataset.queueName`);
    await page.eval(`_deskQueuePage(2)`);
    await sleep(1200);
    check('page 2 shows another 20', (await rows(page)) === 20, String(await rows(page)));
    const secondPage = await page.eval(
      `document.querySelector('.desk-queue-list .desk-continue-row').dataset.queueName`);
    check('page 2 has DIFFERENT items from page 1', secondPage !== firstPage,
          `${firstPage} vs ${secondPage}`);
    const range = await page.eval(
      `(() => { const e = document.querySelector('.desk-queue-range');
         return e ? e.textContent.trim() : ''; })()`);
    check('the range says where we are', /21\s*[–-]\s*40 of/.test(range), range);
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
      if (size <= 40) check(`page size ${size} actually shows ${size}`, n === size, `${n}`);
    }
    await page.eval(`_deskQueueSetPer(20)`);
    await sleep(400);

    section('Last page');
    const pages = Math.ceil(total / 20);
    await page.eval(`_deskQueuePage(${pages})`);
    await sleep(800);
    const lastRows = await rows(page);
    const expect = total - (pages - 1) * 20;
    check(`the last page holds the remainder (${expect})`, lastRows === expect,
          `${lastRows} rows, expected ${expect}`);
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
      f.value = 'epiphany';
      f.dispatchEvent(new InputEvent('input', { bubbles: true }));
    })()`);
    // Wait for the scan to report rather than sleeping a guess.
    await page.waitFor(
      `(() => { const h = document.querySelector('[data-queue-count]');
         return h && /\\d+ of \\d+ match/.test(h.textContent); })()`,
      30000, 'the queue filter to report a match count');
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
  } finally { await b.close(); }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });