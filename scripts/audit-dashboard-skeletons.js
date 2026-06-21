async (page) => {
  const SKINS = [
    { value: 'classic', label: 'Classic', desc: 'The current dashboard' },
    { value: 'aurora', label: 'Aurora Bento', desc: 'Glass bento grid' },
    { value: 'editorial', label: 'Editorial', desc: 'Swiss/typographic' },
    { value: 'spatial', label: 'Spatial Depth', desc: 'visionOS-style frosted' },
    { value: 'command-deck', label: 'Command Deck', desc: 'HUD/terminal' },
    { value: 'orbital', label: 'Orbital Core', desc: 'Item-type constellation' },
    { value: 'mission-control', label: 'Mission Control', desc: 'Analytics cockpit' },
    { value: 'neon-grid', label: 'Neon Grid', desc: 'Synthwave neon' },
    { value: 'holographic', label: 'Holographic', desc: 'Iridescent animated' }
  ];

  const results = {};
  const screenshotDir = '/Users/amishchenko/repos/devstash/.playwright-mcp/screenshots';

  const getLayoutMetrics = async (page) => {
    return page.evaluate(() => {
      const metrics = {};

      const getRect = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          top: Math.round(rect.top + window.scrollY),
          left: Math.round(rect.left + window.scrollX),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      };

      metrics.container = getRect(document.querySelector('.app-page'));
      metrics.header = getRect(document.querySelector('header'));
      
      const pageElements = Array.from(document.querySelectorAll('.app-page > *'));
      const headerIdx = pageElements.findIndex(el => el.tagName === 'HEADER');
      
      let statsContainer = null;
      if (headerIdx !== -1 && pageElements[headerIdx + 1]) {
        statsContainer = pageElements[headerIdx + 1];
      }
      metrics.statsContainer = getRect(statsContainer);

      const sections = Array.from(document.querySelectorAll('section, .ds-glass, .ds-holo-foil, .rounded-lg, .rounded-2xl'));
      sections.forEach(sec => {
        const titleEl = sec.querySelector('h2, h3, .font-bold, .font-semibold');
        if (!titleEl) return;
        const titleText = titleEl.textContent?.trim().toLowerCase() || '';
        
        if (titleText.includes('pinned')) {
          metrics.pinned = getRect(sec);
        } else if (titleText.includes('recent')) {
          metrics.recent = getRect(sec);
        } else if (titleText.includes('collection')) {
          metrics.collections = getRect(sec);
        } else if (titleText.includes('distribution') || titleText.includes('type')) {
          metrics.distribution = getRect(sec);
        } else if (titleText.includes('ai usage') || titleText.includes('ai')) {
          metrics.aiUsage = getRect(sec);
        }
      });

      return metrics;
    });
  };

  const compareMetrics = (loaded, skeleton) => {
    const comparisons = {};
    for (const key of Object.keys(loaded)) {
      const loadRect = loaded[key];
      const skelRect = skeleton[key];
      
      if (!loadRect && !skelRect) continue;
      
      if (!loadRect || !skelRect) {
        comparisons[key] = {
          mismatch: true,
          reason: loadRect ? 'Skeleton element missing' : 'Loaded element missing',
          loaded: loadRect,
          skeleton: skelRect
        };
        continue;
      }

      const diffs = {
        top: skelRect.top - loadRect.top,
        left: skelRect.left - loadRect.left,
        width: skelRect.width - loadRect.width,
        height: skelRect.height - loadRect.height
      };

      const hasMismatch = Math.abs(diffs.top) > 1 || Math.abs(diffs.left) > 1 || 
                          Math.abs(diffs.width) > 1 || Math.abs(diffs.height) > 1;

      comparisons[key] = {
        mismatch: hasMismatch,
        loaded: loadRect,
        skeleton: skelRect,
        diffs: diffs
      };
    }
    return comparisons;
  };

  for (const skin of SKINS) {
    // 1. Change skin
    await page.goto('http://localhost:3000/settings');
    await page.waitForSelector('text=Dashboard Skin');
    
    const buttonSelector = `button:has-text("${skin.label}"):has-text("${skin.desc}")`;
    const btn = page.locator(buttonSelector);
    if (await btn.count() > 0) {
      await btn.first().click();
      await page.waitForTimeout(1000);
    }

    results[skin.value] = { label: skin.label, desktop: {}, mobile: {} };

    // 2. Desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForSelector('.app-page');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/${skin.value}-desktop-loaded.png`, fullPage: true });
    const loadedDesktopMetrics = await getLayoutMetrics(page);

    await page.goto('http://localhost:3000/dashboard?skeleton=true');
    await page.waitForSelector('.app-page');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/${skin.value}-desktop-skeleton.png`, fullPage: true });
    const skeletonDesktopMetrics = await getLayoutMetrics(page);
    
    results[skin.value].desktop = compareMetrics(loadedDesktopMetrics, skeletonDesktopMetrics);

    // 3. Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForSelector('.app-page');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/${skin.value}-mobile-loaded.png`, fullPage: true });
    const loadedMobileMetrics = await getLayoutMetrics(page);

    await page.goto('http://localhost:3000/dashboard?skeleton=true');
    await page.waitForSelector('.app-page');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/${skin.value}-mobile-skeleton.png`, fullPage: true });
    const skeletonMobileMetrics = await getLayoutMetrics(page);

    results[skin.value].mobile = compareMetrics(loadedMobileMetrics, skeletonMobileMetrics);
  }

  return results;
}
