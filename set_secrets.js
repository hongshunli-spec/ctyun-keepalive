// 设置GitHub Secrets (用libsodium官方sealed box加密)
const _sodium = require('libsodium-wrappers');
const https = require('https');

const TOKEN = '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';
const REPO = 'hongshunli-spec/ctyun-keepalive';
const PUBLIC_KEY = 'C/AlueLh3uADv/wQUKxsTKE9/ozzwg4x7id8Rtt84RE=';
const KEY_ID = '3380204578043523366';

const secrets = {
  CTYUN_ACCOUNT: '15305669128',
  CTYUN_PASSWORD: 'Supercom.132'
};

function putSecret(name, encryptedValue) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      encrypted_value: encryptedValue,
      key_id: KEY_ID
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/actions/secrets/${name}`,
      method: 'PUT',
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'nodejs'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 204) {
          resolve({ name, status: res.statusCode, success: true });
        } else {
          reject({ name, status: res.statusCode, body, success: false });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  await _sodium.ready;
  const sodium = _sodium;

  for (const [name, value] of Object.entries(secrets)) {
    try {
      console.log(`处理 ${name}...`);
      const publicKeyBytes = new Uint8Array(Buffer.from(PUBLIC_KEY, 'base64'));
      console.log(`公钥长度: ${publicKeyBytes.length}`);
      const messageBytes = sodium.from_string(value);
      console.log(`消息长度: ${messageBytes.length}`);
      // libsodium sealed box加密
      const encryptedBytes = sodium.crypto_box_seal(messageBytes, publicKeyBytes);
      console.log(`加密后长度: ${encryptedBytes.length}`);
      const encryptedBase64 = Buffer.from(encryptedBytes).toString('base64');
      console.log(`加密后base64长度: ${encryptedBase64.length}`);

      const result = await putSecret(name, encryptedBase64);
      console.log(`✅ Secret ${name} 设置成功 (HTTP ${result.status})`);
    } catch (e) {
      console.log(`❌ Secret ${name} 设置失败:`, e.status, e.body || e.message);
      console.log(e.stack);
    }
  }
})();
