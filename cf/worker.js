const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,x-invite-code'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function textResponse(body, status = 200, contentType = 'text/plain') {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': contentType }
  });
}

function decodeBase64Utf8(token) {
  try {
    return decodeURIComponent(escape(atob(token)));
  } catch (e) {
    return null;
  }
}

function generateInviteCode() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function getOrInitInviteCode(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'invite_code'")
    .first();
  if (row && row.value) return row.value;
  const code = generateInviteCode();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('invite_code', ?)")
    .bind(code)
    .run();
  return code;
}

async function authenticate(req, env) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

  const token = authHeader.startsWith('Basic ') ? authHeader.slice(6) : authHeader;
  const decoded = decodeBase64Utf8(token);
  if (!decoded) return jsonResponse({ error: 'Invalid token' }, 401);

  const parts = decoded.split(':');
  if (parts.length < 2) return jsonResponse({ error: 'Invalid credentials' }, 401);
  const username = parts.shift();
  const password = parts.join(':');
  if (!username || !password) return jsonResponse({ error: 'Invalid credentials' }, 401);

  const userRow = await env.DB.prepare(
    'SELECT username, password, is_admin FROM users WHERE username = ?'
  )
    .bind(username)
    .first();

  if (userRow) {
    if (userRow.password !== password) {
      return jsonResponse({ error: 'Invalid password' }, 401);
    }
    return { username: userRow.username, is_admin: !!userRow.is_admin };
  }

  const countRow = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
  const userCount = countRow ? Number(countRow.count || 0) : 0;

  if (userCount === 0) {
    await env.DB.prepare(
      'INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)'
    )
      .bind(username, password)
      .run();
    return { username, is_admin: true };
  }

  const inviteCode = req.headers.get('x-invite-code');
  if (!inviteCode) return jsonResponse({ error: 'Invite code required', needInvite: true }, 403);

  const correctCode = await getOrInitInviteCode(env);
  if (inviteCode.toUpperCase() !== String(correctCode).toUpperCase()) {
    return jsonResponse({ error: 'Invalid invite code' }, 403);
  }

  await env.DB.prepare(
    'INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)'
  )
    .bind(username, password)
    .run();
  return { username, is_admin: false };
}

async function parseJsonBody(req) {
  if (req.method === 'GET') return {};
  const type = req.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) return {};
  try {
    return await req.json();
  } catch (e) {
    return null;
  }
}

async function handleLogin(req, env) {
  const user = await authenticate(req, env);
  if (user instanceof Response) return user;
  return jsonResponse({ success: true, username: user.username, isAdmin: !!user.is_admin });
}

async function handleGetData(user, env) {
  const row = await env.DB.prepare(
    'SELECT json_data, version FROM data WHERE username = ?'
  )
    .bind(user.username)
    .first();
  const data = row && row.json_data ? JSON.parse(row.json_data) : [];
  const version = row && row.version ? Number(row.version) : 0;
  return jsonResponse({ data, version });
}

async function handlePostData(user, req, env) {
  const body = await parseJsonBody(req);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400);

  const data = Array.isArray(body.data) ? body.data : [];
  const version = Number(body.version || 0);
  const force = !!body.force;

  const row = await env.DB.prepare('SELECT version FROM data WHERE username = ?')
    .bind(user.username)
    .first();
  const serverVersion = row && row.version ? Number(row.version) : 0;

  if (!force && version < serverVersion) {
    return jsonResponse(
      { error: 'Conflict', serverVersion, message: 'Server data is newer' },
      409
    );
  }

  const newVersion = Date.now();
  await env.DB.prepare(
    'INSERT OR REPLACE INTO data (username, json_data, version) VALUES (?, ?, ?)'
  )
    .bind(user.username, JSON.stringify(data), newVersion)
    .run();
  return jsonResponse({ success: true, version: newVersion });
}

async function handleAdminInvite(env) {
  const code = await getOrInitInviteCode(env);
  return jsonResponse({ code });
}

async function handleAdminInviteRefresh(env) {
  const code = generateInviteCode();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('invite_code', ?)"
  )
    .bind(code)
    .run();
  return jsonResponse({ code });
}

async function handleAdminUsers(env) {
  const rows = await env.DB.prepare('SELECT username, is_admin FROM users').all();
  return jsonResponse({ users: rows.results || [] });
}

async function handleAdminResetPwd(req, env) {
  const body = await parseJsonBody(req);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400);
  const targetUser = String(body.targetUser || '').trim();
  if (!targetUser) return jsonResponse({ error: 'Missing targetUser' }, 400);

  const res = await env.DB.prepare(
    "UPDATE users SET password = '123456' WHERE username = ?"
  )
    .bind(targetUser)
    .run();
  if (!res || res.changes === 0) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ success: true, message: 'Password reset to 123456' });
}

async function handleAdminDeleteUser(req, user, env) {
  const body = await parseJsonBody(req);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400);
  const targetUser = String(body.targetUser || '').trim();
  if (!targetUser) return jsonResponse({ error: 'Missing targetUser' }, 400);
  if (targetUser === user.username) {
    return jsonResponse({ error: 'Cannot delete self' }, 400);
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM users WHERE username = ?').bind(targetUser),
    env.DB.prepare('DELETE FROM data WHERE username = ?').bind(targetUser)
  ]);
  return jsonResponse({ success: true });
}

async function handleChangePassword(req, user, env) {
  const body = await parseJsonBody(req);
  if (!body) return jsonResponse({ error: 'Invalid JSON' }, 400);
  const oldPassword = String(body.oldPassword || '').trim();
  const newPassword = String(body.newPassword || '').trim();
  if (!oldPassword || !newPassword) {
    return jsonResponse({ error: 'Invalid parameters' }, 400);
  }
  const row = await env.DB.prepare('SELECT password FROM users WHERE username = ?')
    .bind(user.username)
    .first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  if (row.password !== oldPassword) {
    return jsonResponse({ error: 'Old password mismatch' }, 400);
  }
  await env.DB.prepare('UPDATE users SET password = ? WHERE username = ?')
    .bind(newPassword, user.username)
    .run();
  return jsonResponse({ success: true });
}

async function handleHolidays(pathname) {
  const parts = pathname.split('/');
  const year = String(parts[parts.length - 1] || '').trim();
  if (!/^\d{4}$/.test(year)) return jsonResponse({ error: 'Invalid year' }, 400);

  const url = `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`;
  const resp = await fetch(url);
  if (!resp.ok) return jsonResponse({ error: 'Holiday data not found' }, 404);

  const text = await resp.text();
  try {
    JSON.parse(text);
  } catch (e) {
    return jsonResponse({ error: 'Invalid holiday data' }, 500);
  }
  return textResponse(text, 200, 'application/json');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const { pathname } = url;

    if (!pathname.startsWith('/api/')) {
      return textResponse('Not Found', 404);
    }

    if (pathname === '/api/login') {
      return handleLogin(req, env);
    }

    const user = await authenticate(req, env);
    if (user instanceof Response) return user;

    if (pathname === '/api/data' && req.method === 'GET') {
      return handleGetData(user, env);
    }
    if (pathname === '/api/data' && req.method === 'POST') {
      return handlePostData(user, req, env);
    }

    if (pathname === '/api/admin/invite' && req.method === 'GET') {
      if (!user.is_admin) return jsonResponse({ error: 'Admin required' }, 403);
      return handleAdminInvite(env);
    }
    if (pathname === '/api/admin/invite/refresh' && req.method === 'POST') {
      if (!user.is_admin) return jsonResponse({ error: 'Admin required' }, 403);
      return handleAdminInviteRefresh(env);
    }
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      if (!user.is_admin) return jsonResponse({ error: 'Admin required' }, 403);
      return handleAdminUsers(env);
    }
    if (pathname === '/api/admin/reset-pwd' && req.method === 'POST') {
      if (!user.is_admin) return jsonResponse({ error: 'Admin required' }, 403);
      return handleAdminResetPwd(req, env);
    }
    if (pathname === '/api/admin/delete-user' && req.method === 'POST') {
      if (!user.is_admin) return jsonResponse({ error: 'Admin required' }, 403);
      return handleAdminDeleteUser(req, user, env);
    }

    if (pathname === '/api/change-pwd' && req.method === 'POST') {
      return handleChangePassword(req, user, env);
    }

    if (pathname.startsWith('/api/holidays/') && req.method === 'GET') {
      return handleHolidays(pathname);
    }

    return jsonResponse({ error: 'Not Found' }, 404);
  }
};
