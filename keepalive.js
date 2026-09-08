// 天翼云电脑云端防休眠保活脚本 v2（健壮版）
// 修复：登录态误判（海外加载慢）、进入按钮改版、canvas 装饰误判
const { chromium } = require('playwright');

const ACCOUNT  = process.env.CTYUN_ACCOUNT  || '15305669128';
const PASSWORD = process.env.CTYUN_PASSWORD || 'Supercom.132';
const URL      = 'https://pc.ctyun.cn';

function log(msg) {
  console.log(`[${new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}] ${msg}`);
}

async function dumpBody(page, maxlen) {
  try {
    const t = await page.locator('body').innerText();
    log('页面文本(前' + maxlen + '字): ' + t.substring(0, maxlen).replace(/\s+/g, ' '));
  } catch (e) { log('dumpBody失败: ' + e.message); }
}

// 找到真实可见的云桌面画布（宽高都>100的canvas中最大者）
async function findRealCanvas(page) {
  try {
    const n = await page.locator('canvas').count();
    let best = null;
    for (let i = 0; i < n; i++) {
      const b = await page.locator('canvas').nth(i).boundingBox().catch(() => null);
      if (b && b.width > 100 && b.height > 100) {
        const area = b.width * b.height;
        if (!best || area > best.area) best = { idx: i, box: b, area };
      }
    }
    return best;
  } catch (e) { return null; }
}

async function waitRealCanvas(page, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const c = await findRealCanvas(page);
    if (c) return c;
    await page.waitForTimeout(5000);
  }
  return null;
}

async function simulateActivity(page, canvas) {
  try {
    const b = canvas.box;
    for (let i = 0; i < 3; i++) {
      const x = b.x + 100 + Math.random() * (b.width - 200);
      const y = b.y + 100 + Math.random() * (b.height - 200);
      await page.mouse.move(x, y);
      await page.waitForTimeout(400);
      await page.mouse.click(x, y);
      await page.waitForTimeout(400);
      await page.mouse.move(x + 40, y + 40);
      await page.waitForTimeout(300);
    }
    log('✅ 已模拟鼠标操作 3 组 @canvas(' + Math.round(b.width) + 'x' + Math.round(b.height) + ')');
  } catch (e) {
    log('模拟操作失败: ' + e.message);
  }
}

(async () => {
  if (!ACCOUNT || !PASSWORD) { log('错误: 未设置账号密码'); process.exit(1); }
  let browser = null;
  try {
    log('=== 天翼云云端保活 v2 开始 ===');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,800']
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    log('打开天翼云电脑页面...');
    await page.goto(URL, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForTimeout(10000);

    // 登录态判断：等手机号输入框最多20秒
    let needLogin = false;
    try {
      await page.locator('input[placeholder*="手机号"]').first().waitFor({ state: 'visible', timeout: 20000 });
      needLogin = true;
    } catch (e) {
      needLogin = false;
    }

    if (needLogin) {
      log('检测到登录页，开始自动登录...');
      const acctTab = page.getByText('账号登录', { exact: true }).first();
      if (await acctTab.count() > 0) { await acctTab.click(); await page.waitForTimeout(1500); }
      await page.locator('input[placeholder*="手机号"]').fill(ACCOUNT);
      await page.locator('input[placeholder*="密码"]').fill(PASSWORD);
      await page.waitForTimeout(500);
      const btn = page.locator('button.btn-submit:visible');
      if (await btn.count() > 0) { await btn.first().click(); }
      await page.waitForTimeout(3000);
      const ok = page.locator('button:has-text("确定")');
      if (await ok.count() > 0) { await ok.first().click(); await page.waitForTimeout(1500); }
      try {
        await page.waitForSelector('button.btn-submit:visible:not(.is-loading)', { timeout: 20000 });
        const btn2 = page.locator('button.btn-submit:visible');
        if (await btn2.count() > 0) { await btn2.first().click(); await page.waitForTimeout(6000); }
      } catch (e) { log('第二次点击跳过: ' + e.message); }
      log('登录操作完成');
    } else {
      log('已处于登录态');
    }

    // 重新进入主页，等桌面列表加载
    await page.goto(URL, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForTimeout(15000);

    // 找"进入"按钮（多候选，兼容改版）
    const enterSelectors = ['text=进入AI云电脑', 'text=进入云电脑', 'text=进入桌面', 'text=连接云电脑', 'text=进入', 'text=连接'];
    let clicked = false;
    for (const sel of enterSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        log('点击进入按钮: ' + sel);
        await el.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      log('未找到进入按钮，尝试其他按钮...');
      const texts = await page.locator('button, a, [class*=btn]').allTextContents().catch(() => []);
      const cands = [...new Set(texts.map(t => t.trim()).filter(t => t && t.length < 20))];
      log('页面按钮: ' + JSON.stringify(cands.slice(0, 40)));
      const fuzzy = page.locator('button:has-text("进入"), a:has-text("进入"), button:has-text("连接"), a:has-text("连接")').first();
      if (await fuzzy.count() > 0) {
        log('模糊匹配进入按钮');
        await fuzzy.click();
        clicked = true;
      } else {
        dumpBody(page, 600);
      }
    }

    if (clicked) await page.waitForTimeout(8000);

    // 休眠状态检测
    try {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const sleepRe = /休眠|正在开机|唤醒|启动中|正在启动/;
      if (sleepRe.test(bodyText)) {
        const idx = bodyText.search(sleepRe);
        log('检测到云电脑休眠/唤醒: ' + bodyText.substring(Math.max(0, idx - 15), idx + 15).replace(/\s+/g, ' '));
        log('等待唤醒完成...');
        await page.waitForTimeout(25000);
      } else {
        log('云电脑状态: 在线');
      }
    } catch (e) { log('休眠检测跳过: ' + e.message); }

    // 等待真实 canvas（最多120秒）
    const canvas = await waitRealCanvas(page, 120000);
    if (canvas) {
      log('云桌面连接已建立 canvas#' + canvas.idx + ' (' + Math.round(canvas.box.width) + 'x' + Math.round(canvas.box.height) + ')');
      await simulateActivity(page, canvas);
      log('保活完成');
    } else {
      log('⚠️ 未检测到真实画布，连接未建立');
      try { await page.screenshot({ path: 'error_screenshot.png', fullPage: true }); log('已保存错误截图'); } catch (e) {}
      dumpBody(page, 600);
      process.exitCode = 1;
    }

    log('=== 天翼云云端保活 v2 结束 ===');
  } catch (e) {
    log('执行异常: ' + e.message);
    log('堆栈: ' + (e && e.stack));
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
})();
