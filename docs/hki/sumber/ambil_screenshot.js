const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const OUT = process.argv[2];
const API = 'http://localhost:8000';
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  // ---------- sisi pengunjung (mobile) ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  const m = await mctx.newPage();
  m.on('pageerror', e => errs.push(e.message));
  await m.goto('http://localhost:8080/program/barista.html', { referer: 'https://www.google.com/' });
  await m.waitForSelector('#ysii-consent');
  await m.screenshot({ path: OUT + '/11-banner-persetujuan.png' });
  await m.click('#ysii-consent .y');
  await m.waitForTimeout(600);
  await m.mouse.move(5, 5);
  await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await m.waitForSelector('.ysii-reco');
  await m.waitForTimeout(1200);
  // tampilkan isi tautan WA yang sudah ditambahi kode
  await m.evaluate(() => {
    const a = document.querySelector('#wa');
    const box = document.createElement('div');
    box.id = 'wa-preview';
    box.style.cssText = 'margin:10px 0 0;padding:10px;border:2px dashed #0b7a4b;border-radius:8px;font:13px/1.4 monospace;background:#f2fbf6;white-space:pre-wrap;overflow-wrap:break-word';
    box.textContent = 'Pesan WhatsApp yang terkirim:\n' + new URL(a.href).searchParams.get('text');
    a.parentElement.appendChild(box);
    a.addEventListener('click', e => e.preventDefault());
  });
  await m.locator('#harga').screenshot({ path: OUT + '/12-kode-whatsapp.png' });
  await m.click('#wa');
  await m.locator('.ysii-reco').screenshot({ path: OUT + '/13-widget-rekomendasi.png' });
  const refCode = await m.evaluate(() => window.ysii.refCode);
  await m.fill('[name=nama]', 'Rina Pratiwi');
  await m.fill('[name=no_hp]', '0812 7777 8888');
  await m.locator('#daftar-sec').screenshot({ path: OUT + '/14-form-pendaftaran.png' });
  await Promise.all([m.waitForURL('**/terima-kasih.html**'), m.click('#daftar button')]);
  await m.waitForTimeout(1500);

  // ---------- dashboard (desktop) ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(API + '/');
  await p.waitForSelector('#login-form');
  await p.fill('[name=username]', 'admin');
  await p.screenshot({ path: OUT + '/01-login.png' });
  await p.fill('[name=password]', 'demo-ysii-2026');
  await p.click('#login-form button');
  await p.waitForSelector('#kpi-tiles .tile');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: OUT + '/02-ringkasan.png', fullPage: true });

  await p.click('a[href="#lead"]');
  await p.waitForSelector('#lead-table tr[data-id]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/03-daftar-lead.png' });
  await p.fill('#lead-filter [name=q]', 'Rina');
  await p.waitForTimeout(800);
  await p.click('#lead-table tr[data-id] td:nth-child(2)');
  await p.waitForSelector('#lead-detail h2');
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/04-detail-lead.png' });
  await p.click('#close-lead');
  await p.fill('#lead-filter [name=q]', '');
  await p.waitForTimeout(600);
  await p.waitForSelector('#lead-table select[data-status]');
  await p.selectOption('#lead-filter [name=segment]', 'hot');
  await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/05-filter-hot.png', clip: { x: 0, y: 0, width: 1280, height: 520 } });
  await p.selectOption('#lead-filter [name=segment]', '');

  // WA dialog
  const code = refCode;
  await p.click('#btn-add-wa');
  await p.fill('#wa-form [name=name]', 'Budi Santoso');
  await p.fill('#wa-form [name=phone]', '0813 2222 3333');
  await p.fill('#wa-form [name=ref_code]', code || 'A1B2C3');
  await p.selectOption('#wa-form [name=program_slug]', 'barista');
  await p.fill('#wa-form [name=message]', 'Tanya jadwal batch November');
  await p.screenshot({ path: OUT + '/06-lead-whatsapp.png' });
  await p.click('#wa-form button[value=cancel]');

  await p.click('a[href="#program"]');
  await p.waitForSelector('#program-table code');
  await p.click('#program-table [data-edit="barista"]');
  await p.waitForTimeout(600);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: OUT + '/07-program.png', fullPage: true });

  await p.click('a[href="#seo"]');
  await p.waitForSelector('#seo-body .tile');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: OUT + '/08-seo.png', fullPage: true });

  await p.click('a[href="#model"]');
  await p.waitForSelector('#model-body table');
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/09-model-ml.png', fullPage: true });

  // tampilan HP
  await p.setViewportSize({ width: 390, height: 800 });
  await p.click('a[href="#lead"]');
  await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/15-dashboard-hp.png' });

  // dokumentasi API
  const d = await ctx.newPage();
  await d.setViewportSize({ width: 1280, height: 800 });
  await d.goto(API + '/docs');
  try { await d.waitForSelector('.opblock', { timeout: 15000 }); await d.waitForTimeout(800);
        await d.screenshot({ path: OUT + '/10-dokumentasi-api.png' }); }
  catch (e) { console.log('swagger UI tidak termuat (CDN diblokir)'); }
  console.log('refCode', code, 'errors:', errs.length ? errs : 'none');
  await browser.close();
})();
