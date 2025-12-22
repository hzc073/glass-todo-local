const crypto = require('crypto');
const db = require('./db');

// 生成邀请码工具
const generateInviteCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

// 获取或初始化邀请码
const getOrInitInviteCode = (cb) => {
    db.get("SELECT value FROM settings WHERE key = 'invite_code'", (err, row) => {
        if (row) {
            cb(row.value);
        } else {
            const newCode = generateInviteCode();
            db.run("INSERT INTO settings (key, value) VALUES ('invite_code', ?)", [newCode], () => cb(newCode));
        }
    });
};

// 核心鉴权中间件
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

    const token = authHeader.replace('Basic ', '');
    let creds;
    try {
        creds = Buffer.from(token, 'base64').toString('utf8');
    } catch (e) {
        return res.status(401).json({ error: "Invalid token" });
    }
    
    const [username, password] = creds.split(':');
    if (!username || !password) return res.status(401).json({ error: "Invalid credentials" });

    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        
        if (user) {
            // 登录
            if (user.password === password) {
                req.user = user;
                next();
            } else {
                res.status(401).json({ error: "密码错误" });
            }
        } else {
            // 注册逻辑
            db.get("SELECT count(*) as count FROM users", (err, row) => {
                const isFirstUser = row.count === 0;
                
                if (isFirstUser) {
                    // 首个用户自动管理员
                    db.run("INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)", [username, password], (err) => {
                        if(err) return res.status(500).json({ error: "Register failed" });
                        req.user = { username, is_admin: 1 };
                        next();
                    });
                } else {
                    // 后续用户需邀请码
                    const inviteCode = req.headers['x-invite-code'];
                    if (!inviteCode) return res.status(403).json({ error: "需要邀请码", needInvite: true });

                    getOrInitInviteCode((correctCode) => {
                        if (inviteCode.toUpperCase() === correctCode) {
                            db.run("INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)", [username, password], (err) => {
                                if(err) return res.status(500).json({ error: "Register failed" });
                                req.user = { username, is_admin: 0 };
                                next();
                            });
                        } else {
                            res.status(403).json({ error: "邀请码错误" });
                        }
                    });
                }
            });
        }
    });
};

const requireAdmin = (req, res, next) => {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ error: "需要管理员权限" });
    next();
};

module.exports = { authenticate, requireAdmin, generateInviteCode, getOrInitInviteCode };