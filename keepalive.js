// 天翼云电脑云端防休眠保活脚本 (GitHub Actions + Playwright)
// 云端 headless 运行，自动登录 -> 进云桌面 -> 模拟鼠标操作 -> 退出
// 账号密码从环境变量读取: CTYUN_ACCOUNT, CTYUN_PASSWORD

const { chromium } = require('playwright');

const ACCOUNT  = process.env.CTYUN_ACCOUNT  || '';
const PASSWORD = process.env.CTYUN_PASSWORD || '';
const URL      = 'https://pc.ctyun.cn';

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}] ${msg}`;
  console.log(line);
}

async function simulateActivity(page) {
  try {
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) { log('无法获取画布位置，跳过模拟操作'); return; }
    const x = box.x + Math.random() * box.width;
    const y = box.y + Math.random() * box.height;
    await page.mouse.move(x, y);
    await page.waitForTimeout(300);
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    await page.mouse.move(x + 30, y + 30);
    await page.waitForTimeout(200);
    log('已模拟鼠标操作 @(' + Math.round(x) + ',' + Math.round(y) + ')');
  } catch (e) {
    log('模拟操作失败: ' + (e && e.message));
  }
}

(async () => {
  if (!ACCOUNT || !PASSWORD) {
    log('错误: 未设置 CTYUN_ACCOUNT 或 CTYUN_PASSWORD 环境变量');
    process.exit(1);
  }

  let browser = null;
  try {
    log('=== 天翼云云端保活开始 ===');
    log('账号: ' + ACCOUNT);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    log('打开天翼云电脑页面...');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // 检测是否需要登录
    const hasForm = await page.locator('input[placeholder*="手机号"]').count();
    if (hasForm > 0) {
      log('检测到登录页，开始自动登录...');

      // 切换到账号登录tab
      const acctTab = page.getByText('账号登录', { exact: true }).first();
      if (await acctTab.count() > 0) {
        await acctTab.click();
        await page.waitForTimeout(1500);
      }

      // 填写账号密码
      await page.locator('input[placeholder*="手机号"]').fill(ACCOUNT);
      await page.locator('input[placeholder*="密码"]').fill(PASSWORD);
      await page.waitForTimeout(500);

      // 点击登录
      const btn = page.locator('button.btn-submit:visible');
      if (await btn.count() > 0) {
        await btn.first().click();
      }
      await page.waitForTimeout(3000);

      // 处理可能的弹窗
      const ok = page.locator('button:has-text("确定")');
      if (await ok.count() > 0) {
        await ok.first().click();
        await page.waitForTimeout(1500);
      }

      // 再次点击登录（有些情况下需要点两次）
      const btn2 = page.locator('button.btn-submit:visible');
      if (await btn2.count() > 0) {
        await btn2.first().click();
      }
      await page.waitForTimeout(6000);

      log('登录操作完成');
    } else {
      log('已处于登录态');
    }

    // 重新进入主页
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    // 点击进入AI云电脑
    const enterBtn = page.locator('text=进入AI云电脑').first();
    if (await enterBtn.count() > 0) {
      log('点击进入AI云电脑');
      await enterBtn.click();
      await page.waitForTimeout(15000);
    } else {
      log('未找到进入按钮，尝试检测云桌面...');
    }

    // 检测云电脑是否休眠
    try {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const sleepRe = /休眠|正在开机|唤醒|启动中|正在启动/;
      if (sleepRe.test(bodyText)) {
        const idx = bodyText.search(sleepRe);
        log('检测到云电脑休眠/唤醒状态: ' + bodyText.substring(Math.max(0, idx - 15), idx + 15).replace(/\s+/g, ' '));
        log('等待唤醒完成...');
        await page.waitForTimeout(20000);
      } else {
        log('云电脑状态: 在线');
      }
    } catch (e) {
      log('休眠状态检测跳过: ' + (e && e.message));
    }

    // 检测canvas
    const canvasCount = await page.locator('canvas').count().catch(() => 0);
    log('当前URL: ' + page.url() + ', canvas数: ' + canvasCount);

    if (canvasCount > 0) {
      log('云桌面连接已建立，开始模拟操作...');
      await simulateActivity(page);
      log('保活完成');
    } else {
      log('未检测到画布，可能连接未建立或页面异常');
      // 截图保存以便排查
      try {
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        log('已保存错误截图 error_screenshot.png');
      } catch (e) {}
    }

    log('=== 天翼云云端保活结束 ===');

  } catch (e) {
    log('执行异常: ' + (e && e.message));
    log('堆栈: ' + (e && e.stack));
    process.exitCode = 1;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
})();
