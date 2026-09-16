// 天翼云电脑云端防休眠保活脚本 v3（加固版）
// v3 改进：登录后验证 + 失败快速重试 + 超时优化（总时长控制在4分钟内，适配 workflow timeout 5min）
// 保留 v2 已验证的选择器避坑（账号登录 tab、btn-submit:visible、canvas 尺寸过滤）
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
    await page.waitForTimeout(4000);
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
      await page.waitForTimeout(350);
      await page.mouse.click(x, y);
      await page.waitForTimeout(350);
      await page.mouse.move(x + 40, y + 40);
      await page.waitForTimeout(250);
    }
    log('✅ 已模拟鼠标操作 3 组 @canvas(' + Math.round(b.width) + 'x' + Math.round(b.height) + ')');
    return true;
  } catch (e) {
    log('模拟操作失败: ' + e.message);
    return false;
  }
}

// 登录后验证：返回 true=登录成功（或已处于登录态），false=仍停在登录页/遇验证码/风控
async function verifyLogin(page) {
  try {
    const phoneVisible = await page.locator('input[placeholder*="手机号"]').first().isVisible().catch(() => false);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const riskRe = /验证码|滑块|频繁|错误|失败|locked|异常/;
    if (phoneVisible) {
      log('⚠️ 登录未生效：仍可见手机号输入框');
      return false;
    }
    if (riskRe.test(bodyText)) {
      log('⚠️ 检测到风控/错误提示: ' + bodyText.match(riskRe)[0]);
      return false;
    }
    log('登录状态验证通过');
    return true;
  } catch (e) {
    log('verifyLogin异常(视为通过): ' + e.message);
    return true;
  }
}

async function runOnce(browser, attempt, fast) {
  log('=== 第 ' + attempt + ' 次尝试 (' + (fast ? '快速模式' : '标准模式') + ') ===');
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const gotoMs = fast ? 25000 : 40000;
  const canvasMs = fast ? 35000 : 55000;

  log('打开天翼云电脑页面...');
  await page.goto(URL, { waitUntil: 'commit', timeout: gotoMs });
  await page.waitForTimeout(fast ? 5000 : 8000);

  // 登录态判断
  let needLogin = false;
  try {
    await page.locator('input[placeholder*="手机号"]').first().waitFor({ state: 'visible', timeout: 10000 });
    needLogin = true;
  } catch (e) { needLogin = false; }

  if (needLogin) {
    log('检测到登录页，开始自动登录...');
    try {
      const acctTab = page.getByText('账号登录', { exact: true }).first();
      if (await acctTab.count() > 0) { await acctTab.click(); await page.waitForTimeout(1200); }
    } catch (e) {}
    await page.locator('input[placeholder*="手机号"]').fill(ACCOUNT);
    await page.locator('input[placeholder*="密码"]').fill(PASSWORD);
    await page.waitForTimeout(400);
    const btn = page.locator('button.btn-submit:visible');
    if (await btn.count() > 0) { await btn.first().click(); }
    await page.waitForTimeout(4000);
    const ok = page.locator('button:has-text("确定")');
    if (await ok.count() > 0) { await ok.first().click(); await page.waitForTimeout(1200); }
    try {
      await page.waitForSelector('button.btn-submit:visible:not(.is-loading)', { timeout: 12000 });
      const btn2 = page.locator('button.btn-submit:visible');
      if (await btn2.count() > 0) { await btn2.first().click(); await page.waitForTimeout(4000); }
    } catch (e) { log('第二次点击跳过: ' + e.message); }
    // v3 新增：登录后验证
    if (!await verifyLogin(page)) {
      dumpBody(page, 400);
      return false;
    }
  } else {
    log('已处于登录态');
  }

  // 重新进入主页，等桌面列表加载
  await page.goto(URL, { waitUntil: 'commit', timeout: fast ? 18000 : 30000 });
  await page.waitForTimeout(fast ? 8000 : 12000);

  // 找"进入"按钮
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
      dumpBody(page, 500);
      return false;
    }
  }

  if (clicked) await page.waitForTimeout(fast ? 5000 : 8000);

  // 休眠状态检测
  try {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const sleepRe = /休眠|正在开机|唤醒|启动中|正在启动/;
    if (sleepRe.test(bodyText)) {
      const idx = bodyText.search(sleepRe);
      log('检测到云电脑休眠/唤醒: ' + bodyText.substring(Math.max(0, idx - 15), idx + 15).replace(/\s+/g, ' '));
      log('等待唤醒完成...');
      await page.waitForTimeout(20000);
    } else {
      log('云电脑状态: 在线');
    }
  } catch (e) { log('休眠检测跳过: ' + e.message); }

  // 等待真实 canvas
  const canvas = await waitRealCanvas(page, canvasMs);
  if (canvas) {
    log('云桌面连接已建立 canvas#' + canvas.idx + ' (' + Math.round(canvas.box.width) + 'x' + Math.round(canvas.box.height) + ')');
    simulateActivity(page, canvas);
    log('✅ 保活完成');
    return true;
  } else {
    log('⚠️ 未检测到真实画布，连接未建立');
    try { await page.screenshot({ path: 'error_screenshot.png', fullPage: true }); log('已保存错误截图'); } catch (e) {}
    dumpBody(page, 500);
    return false;
  }
}

(async () => {
  if (!ACCOUNT || !PASSWORD) { log('错误: 未设置账号密码'); process.exit(1); }
  let browser = null;
  try {
    log('=== 天翼云云端保活 v3 开始 ===');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,800']
    });

    let ok = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const fast = attempt > 1;
      try {
        ok = await runOnce(browser, attempt, fast);
        if (ok) break;
      } catch (e) {
        log('第' + attempt + '次尝试异常: ' + e.message);
        try { await browser.close(); } catch (e2) {}
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,800']
        });
      }
      if (!ok && attempt < 2) {
        log('等待 3 秒后重试...');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    log('=== 天翼云云端保活 v3 结束 ' + (ok ? '(成功)' : '(失败)') + ' ===');
    if (!ok) process.exitCode = 1;
  } catch (e) {
    log('执行异常: ' + e.message);
    log('堆栈: ' + (e && e.stack));
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
})();
