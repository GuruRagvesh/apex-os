const http = require('https');

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function verify() {
  console.log('Logging in...');
  const loginBody = JSON.stringify({
    email: 'subrat@technoedgels.com',
    password: 'SubratApex@2026'
  });
  
  const loginRes = await request('https://apex-os-3nyi.onrender.com/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginBody)
    },
    body: loginBody
  });
  
  if (loginRes.status !== 200 && loginRes.status !== 201) {
    console.error('Login failed!', loginRes.status, loginRes.data);
    return;
  }
  
  const token = JSON.parse(loginRes.data).accessToken;
  console.log('Got token. Fetching endpoints...');
  
  const endpoints = [
    '/api/home/summary',
    '/api/events?limit=15',
    '/api/notifications/unread-count',
    '/api/dashboard/overview',
    '/api/tickets/sla-risk',
    '/api/workday/today'
  ];
  
  for (const ep of endpoints) {
    try {
      const res = await request('https://apex-os-3nyi.onrender.com' + ep, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      let preview = res.data.slice(0, 100);
      if (res.data.length > 100) preview += '...';
      console.log(`[${res.status}] ${ep} => ${preview.replace(/\n/g, ' ')}`);
    } catch (e) {
      console.error(`[ERR] ${ep} => ${e.message}`);
    }
  }
}

verify();
