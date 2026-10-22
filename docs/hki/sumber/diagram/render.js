const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1140, height: 400 } });
 for (const n of ['arsitektur', 'alur']) { await p.goto('file://' + process.argv[2] + '/' + n + '.html');
   const el = await p.$('body'); await el.screenshot({ path: process.argv[2] + '/' + n + '.png' }); }
 await b.close(); })();
