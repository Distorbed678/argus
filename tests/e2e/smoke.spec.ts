import { test, expect, type Page } from '@playwright/test';

/** Everything off-origin is blocked; relayed feeds get empty payloads. Bundled snapshots still load. */
async function stubNetwork(page: Page) {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return route.abort();
    if (u.pathname.includes('__proxy')) return route.fulfill({ json: { ac: [], states: [], features: [] } });
    return route.continue();
  });
}

/** Console errors that matter: not the ones caused by the blocked network above. */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|NetworkError/i.test(t)) return;
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('argus.settings.v1', JSON.stringify({ bootSeen: true, reduceFx: true, layers: ['sat-stations', 'sat-earthobs'] }));
  });
  await stubNetwork(page);
});

async function boot(page: Page) {
  await page.goto('/');
  // catalog falls back to the bundled snapshot; wait until the SGP4 worker has it
  await expect(page.locator('#log-list')).toContainText('propagator armed', { timeout: 60_000 });
  // the boot overlay fades out (".done") or, on the fast path, is removed
  await page.waitForFunction(() => {
    const b = document.getElementById('boot');
    return !b || b.classList.contains('done') || !b.childElementCount;
  });
}

const isMobileLayout = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 860;

test('boots without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
});

test('layers toggle on and off', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  if (isMobileLayout(page)) await page.locator('#mobilebar [data-sheet="layers"]').click();
  const row = page.locator('.row[data-id="volcanoes"]');
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(row).toHaveClass(/\bon\b/);
  await expect(row.locator('.st')).toContainText(/LIVE|CACHED/);
  await expect(row.locator('.cnt')).toHaveText(/\d/);
  await row.click();
  await expect(row).not.toHaveClass(/\bon\b/);
  expect(errors).toEqual([]);
});

test('"track ISS" opens the ISS dossier', async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  if (isMobileLayout(page)) await page.locator('#mb-cmd').click();
  else await page.keyboard.press('/');
  const input = page.locator('#cmd-input');
  await expect(input).toBeVisible();
  await input.fill('track ISS');
  await input.press('Enter');
  const dossier = page.locator('#dossier');
  await expect(dossier).toBeVisible();
  await expect(dossier.locator('.d-title')).toContainText('ISS');
  await expect(dossier.locator('.d-live')).toContainText('ALTITUDE');
  expect(errors).toEqual([]);
});
