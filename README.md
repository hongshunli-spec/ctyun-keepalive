# 天翼云电脑云端防休眠保活

基于 GitHub Actions + Playwright 的天翼云电脑自动保活方案，防止云电脑因空闲超过1小时而自动休眠。

## 原理

天翼云电脑（公众版）连续1小时无操作或无连接会自动休眠。本方案通过 GitHub Actions 定时（每50分钟）在云端启动浏览器，自动登录天翼云电脑、进入云桌面、模拟鼠标操作，制造"有人在用"的信号，防止休眠。

## 特性

- 云端运行，不占用本地资源
- 7x24 小时稳定运行，不受本地电脑开关机影响
- 账号密码通过 GitHub Secrets 安全存储
- 失败时自动上传错误截图便于排查
- 支持手动触发测试

## 配置

### 1. 设置 Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：

- `CTYUN_ACCOUNT`：天翼云账号（手机号）
- `CTYUN_PASSWORD`：天翼云密码

### 2. 定时规则

默认每小时的 0 分和 50 分各运行一次（最大间隔 50 分钟，小于 1 小时休眠阈值）。

如需修改，编辑 `.github/workflows/keepalive.yml` 中的 `cron` 表达式。

### 3. 成本

GitHub 免费账户每月 2000 分钟 Actions 额度。本方案每次运行约 1-2 分钟，每月约 800-1700 分钟，在免费额度内。

## 本地测试

```bash
npm install
npx playwright install chromium
CTYUN_ACCOUNT=你的账号 CTYUN_PASSWORD=你的密码 node keepalive.js
```

## 注意事项

- 如天翼云登录触发验证码，云端自动化可能失败，需关注 Actions 运行结果
- 首次使用建议先手动触发一次（Actions 页面点击 Run workflow）验证配置正确
- 云电脑休眠后首次连接需要等待唤醒（脚本已内置20秒等待）
