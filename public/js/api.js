// 简单的 API 封装，方便其他模块调用
const api = {
    auth: localStorage.getItem('auth') || '',
    user: localStorage.getItem('user') || '',

    setAuth(user, token) {
        this.user = user;
        this.auth = token;
        localStorage.setItem('user', user);
        localStorage.setItem('auth', token);
    },

    clearAuth() {
        this.auth = '';
        this.user = '';
        localStorage.clear();
    },

    async request(url, method = 'GET', body = null, headers = {}) {
        if(!this.auth && !url.includes('login')) throw new Error('No auth');
        
        const opts = {
            method,
            headers: { 'Authorization': this.auth, 'Content-Type': 'application/json', ...headers }
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        if (res.status === 401) {
            window.app.logout(); // 调用主程序的退出
            throw new Error('Unauthorized');
        }
        return res;
    },

    async login(username, password, inviteCode) {
        const token = btoa(unescape(encodeURIComponent(username + ":" + password)));
        const headers = { 'Authorization': token };
        if(inviteCode) headers['x-invite-code'] = inviteCode;
        
        const res = await fetch('/api/login', { method: 'POST', headers });
        const json = await res.json();
        
        if (res.ok) {
            this.setAuth(username, token);
            return { success: true, isAdmin: json.isAdmin };
        }
        return { success: false, error: json.error, needInvite: json.needInvite };
    },

    async loadData() {
        const res = await this.request('/api/data');
        return await res.json();
    },

    async saveData(data) {
        return await this.request('/api/data', 'POST', { data, version: Date.now(), force: true });
    },
    
    // Admin APIs
    async adminGetInvite() { return (await this.request('/api/admin/invite')).json(); },
    async adminRefreshInvite() { return (await this.request('/api/admin/invite/refresh', 'POST')).json(); },
    async adminGetUsers() { return (await this.request('/api/admin/users')).json(); },
    async adminResetPwd(targetUser) { return await this.request('/api/admin/reset-pwd', 'POST', { targetUser }); },
    async adminDeleteUser(targetUser) { return await this.request('/api/admin/delete-user', 'POST', { targetUser }); },

    // Password
    async changePassword(oldPassword, newPassword) { 
        return await this.request('/api/change-pwd', 'POST', { oldPassword, newPassword }); 
    }
};

export default api;
