import api from './api.js';

export default class AdminPanel {
    constructor() {
        this.modal = document.getElementById('admin-modal');
        this.list = document.getElementById('admin-user-list');
        this.codeEl = document.getElementById('admin-invite-code');
    }

    async open() {
        this.modal.style.display = 'flex';
        const json = await api.adminGetInvite();
        this.codeEl.innerText = json.code;
        this.renderUserList();
    }

    close() {
        this.modal.style.display = 'none';
    }

    async refreshCode() {
        const json = await api.adminRefreshInvite();
        this.codeEl.innerText = json.code;
    }

    async renderUserList() {
        const json = await api.adminGetUsers();
        this.list.innerHTML = json.users.map(u => `
            <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:bold">${u.username} ${u.is_admin ? '<span style="color:red;font-size:0.8rem">[管理员]</span>':''}</div>
                </div>
                ${!u.is_admin ? `
                <div style="display:flex; gap:5px;">
                    <button class="btn-sm btn-secondary" onclick="window.app.adminResetPwd('${u.username}')">重置密码</button>
                    <button class="btn-sm btn-danger" onclick="window.app.adminDelete('${u.username}')">删除</button>
                </div>` : ''}
            </div>
        `).join('');
    }

    async resetPwd(user) {
        if(!confirm(`确定重置用户 [${user}] 的密码为 123456 吗？`)) return;
        await api.adminResetPwd(user);
        alert("已重置");
    }

    async deleteUser(user) {
        if(!confirm(`确定删除用户 [${user}] 吗？数据将无法恢复！`)) return;
        await api.adminDeleteUser(user);
        this.renderUserList();
    }
}