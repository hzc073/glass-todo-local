import api from './api.js';
import AdminPanel from './admin.js';
import CalendarView from './calendar.js';

class TodoApp {
    constructor() {
        this.data = [];
        this.dataVersion = 0;
        this.isAdmin = false;
        
        // 状态
        this.currentDate = new Date();
        this.statsDate = new Date(); 
        this.currentTaskId = null;
        this.view = 'tasks';
        this.filter = { query: '', tag: '' };
        
        // 多选状态
        this.isSelectionMode = false;
        this.selectedTaskIds = new Set();
        this.longPressTimer = null;

        // 模块初始化
        this.admin = new AdminPanel();
        this.calendar = new CalendarView(this); // 传递 this 给 Calendar

        this.exportSettings = {
            type: 'daily',
            dailyTemplate: "📅 {date} 日报\n------------------\n✅ 完成进度: {rate}%\n\n【今日完成】\n{tasks}\n\n【明日计划】\n{plan}",
            weeklyTemplate: "📅 {date} 周报\n==================\n✅ 本周进度: {rate}%\n\n【本周产出】\n{tasks}\n\n【下周规划】\n{plan}"
        };

        window.app = this;
    }

    async init() {
        if(api.auth) {
            document.getElementById('login-modal').style.display = 'none';
            document.getElementById('current-user').innerText = api.user;
            await this.loadData();
        } else {
            document.getElementById('login-modal').style.display = 'flex';
        }
        
        // 样式已移至 css/style.css，这里只保留基本的兼容性处理或空实现
        this.calendar.initControls(); // 委托 Calendar 初始化控件
        this.calendar.renderRuler();  // 委托 Calendar 渲染尺子
        
        setInterval(() => { if (!document.hidden) this.loadData(); }, 30000);
        document.addEventListener("visibilitychange", () => {
             if (document.visibilityState === 'visible') this.loadData();
        });
    }

    // --- Auth & Admin (委托给 AdminPanel 或 API) ---
    async login() {
        const u = document.getElementById('login-user').value.trim();
        const p = document.getElementById('login-pwd').value.trim();
        const invite = document.getElementById('login-invite').value.trim();
        if(!u || !p) return alert("请输入用户名密码");
        try {
            const result = await api.login(u, p, invite);
            if(result.success) {
                this.isAdmin = result.isAdmin;
                document.getElementById('login-modal').style.display = 'none';
                document.getElementById('current-user').innerText = u;
                this.loadData();
            } else {
                if(result.needInvite) {
                    document.getElementById('invite-field').style.display = 'block';
                    alert("新用户注册需要管理员邀请码");
                } else alert("登录失败: " + result.error);
            }
        } catch(e) { console.error(e); alert("网络错误"); }
    }
    logout() { api.clearAuth(); location.reload(); }
    openAdminPanel() { this.admin.open(); }
    adminRefreshCode() { this.admin.refreshCode(); }
    adminResetPwd(u) { this.admin.resetPwd(u); }
    adminDelete(u) { this.admin.deleteUser(u); }
    async changePassword() {
        const oldPwd = document.getElementById('pwd-old')?.value.trim();
        const newPwd = document.getElementById('pwd-new')?.value.trim();
        const confirmPwd = document.getElementById('pwd-confirm')?.value.trim();
        if (!oldPwd || !newPwd || !confirmPwd) return alert("请填写完整");
        if (newPwd !== confirmPwd) return alert("两次新密码不一致");
        try {
            const res = await api.changePassword(oldPwd, newPwd);
            const json = await res.json();
            if (res.ok && json.success) {
                ['pwd-old','pwd-new','pwd-confirm'].forEach(id => document.getElementById(id).value = '');
                // 更新本地凭证，避免修改密码后仍使用旧凭证导致后续请求失败
                const token = btoa(unescape(encodeURIComponent(`${api.user}:${newPwd}`)));
                api.setAuth(api.user, token);
                this.showToast("密码已更新");
            } else {
                alert(json.error || "修改失败");
            }
        } catch (e) { console.error(e); alert("修改失败"); }
    }

    // --- 数据逻辑 ---
    async loadData() {
        try {
            const json = await api.loadData();
            const newData = json.data || [];
            const newVer = json.version || 0;
            if (newVer > this.dataVersion || this.data.length === 0) {
                this.data = newData;
                this.dataVersion = newVer;
                // 清理过期回收站任务（7天）
                const cleaned = this.cleanupRecycle();
                if (cleaned) await this.saveData(true);
                // 检查权限
                const loginCheck = await fetch('/api/login', { method:'POST', headers: { 'Authorization': api.auth } });
                const loginJson = await loginCheck.json();
                this.isAdmin = loginJson.isAdmin;
                if(this.isAdmin) document.getElementById('admin-btn').style.display = 'block';
                
                this.render();
                this.renderTags();
                this.showToast('数据已同步');
            }
        } catch(e) { console.error(e); if(e.message === 'Unauthorized') this.logout(); }
    }

    async saveData(force = false) {
        try {
            const body = { data: this.data, version: this.dataVersion, force: force };
            const res = await api.request('/api/data', 'POST', body);
            if (res.status === 409) {
                 const err = await res.json();
                 if (confirm(`同步冲突！\n云端版本(${err.serverVersion}) 比本地新。\n确定强制覆盖吗？(取消则拉取云端数据)`)) {
                     this.saveData(true);
                 } else {
                     this.dataVersion = 0;
                     this.loadData();
                 }
                 return;
            }
            const json = await res.json();
            if(json.success) this.dataVersion = json.version;
        } catch(e) { this.showToast("保存失败"); }
    }

    // --- 视图切换 ---
    switchView(v) {
        this.view = v;
        if(v !== 'tasks') this.exitSelectionMode();

        document.querySelectorAll('.view-container').forEach(e => e.classList.remove('active'));
        document.getElementById('view-'+v).classList.add('active');
        
        // 更新导航高亮 (Desktop & Mobile) 仅匹配 data-view，避免清除标签筛选状态
        document.querySelectorAll('#mobile-tabbar .tab-item').forEach(e => e.classList.toggle('active', e.dataset.view === v));
        document.querySelectorAll('#sidebar .nav-item[data-view]').forEach(e => e.classList.toggle('active', e.dataset.view === v));

        // 日历控件显隐委托给 CSS 或逻辑控制
        document.getElementById('calendar-controls').style.display = v === 'calendar' ? 'flex' : 'none';
        
        this.render();
    }

    // 代理日历方法，供 HTML onclick 调用
    setCalendarMode(mode) { this.calendar.setMode(mode); }
    changeDate(off) { this.calendar.changeDate(off); }
    dropOnTimeline(ev) { this.calendar.handleDropOnTimeline(ev); }
    
    // HTML ondrop 代理
    allowDrop(ev) { ev.preventDefault(); ev.currentTarget.style.background = 'rgba(0,122,255,0.1)'; }
    leaveDrop(ev) { ev.currentTarget.style.background = ''; }
    dropOnDate(ev, dateStr) {
        ev.preventDefault();
        ev.currentTarget.style.background = '';
        const id = parseInt(ev.dataTransfer.getData("text"));
        const t = this.data.find(i => i.id === id);
        document.querySelector('.dragging')?.classList.remove('dragging');
        if (t && !t.deletedAt && t.date !== dateStr) {
            t.date = dateStr;
            t.inbox = false;
            this.saveData();
            this.render();
            this.showToast(`已移动到 ${dateStr}`);
        }
    }
    
    // 代理日历设置 (HTML onclick)
    toggleCalSetting(key) { this.calendar.toggleSetting(key); }

    // --- 渲染分发 ---
    render() {
        this.updateDateDisplay();
        const allTasks = this.getFilteredData();
        const inboxTasks = allTasks.filter(t => this.isInboxTask(t));
        const datedTasks = allTasks.filter(t => !this.isInboxTask(t));

        // 1. 渲染多选操作栏
        this.renderSelectionBar();

        // 2. 渲染视图
        if (this.view === 'search') {
            document.getElementById('search-results-list').innerHTML = allTasks.map(t => this.createCardHtml(t)).join('');
            return;
        }
        if (this.view === 'tasks') {
            document.getElementById('list-todo').innerHTML = datedTasks.filter(t => t.status !== 'completed').map(t => this.createCardHtml(t)).join('');
            document.getElementById('list-done').innerHTML = datedTasks.filter(t => t.status === 'completed').map(t => this.createCardHtml(t)).join('');
        }
        if (this.view === 'inbox') {
            document.getElementById('list-inbox').innerHTML = inboxTasks.map(t => this.createCardHtml(t)).join('') || '<div style=\"opacity:0.7\">暂无待办箱任务</div>';
        }
        if (this.view === 'matrix') {
            ['q1','q2','q3','q4'].forEach(q => {
                document.querySelector('#'+q+' .q-list').innerHTML = datedTasks.filter(t => t.status !== 'completed' && t.quadrant === q).map(t => this.createCardHtml(t)).join('');
            });
        }
        if (this.view === 'calendar') {
            this.calendar.render(); // 委托 Calendar 模块渲染
        }
        if (this.view === 'stats') {
             this.renderStats(datedTasks);
        }
        if (this.view === 'recycle') {
            const deleted = this.getFilteredData({ onlyDeleted: true });
            this.renderRecycle(deleted);
        }
    }

    // --- 辅助逻辑 ---
    renderSelectionBar() {
        const selBar = document.getElementById('selection-bar');
        if (this.isSelectionMode) {
            // 修复 Problem 6: 全选只针对未完成任务 (或者当前视图可见任务)
            // 这里我们定义“全选”为当前筛选下的 未完成任务 + 已选任务（避免取消掉已选的）
            // 或者更简单的逻辑：全选 = 当前视图所有可见任务。用户说“排除已完成”，通常指在全选时不要选中已完成列表里的。
            // 假设用户是在 Tasks 视图下操作，我们只选取 todo 列表中的。
            const visibleTasks = this.getFilteredData().filter(t => !this.isInboxTask(t) && t.status !== 'completed');
            const allSelected = visibleTasks.length > 0 && visibleTasks.every(t => this.selectedTaskIds.has(t.id));
            
            if (!selBar) {
                const bar = document.createElement('div');
                bar.id = 'selection-bar';
                bar.innerHTML = `
                    <div style="font-weight:bold" id="sel-count">已选 ${this.selectedTaskIds.size}</div>
                    <button class="btn btn-sm btn-secondary" id="btn-select-all" onclick="app.selectAllTasks()">全选</button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteSelectedTasks()">删除</button>
                    <button class="btn btn-sm btn-secondary" onclick="app.exitSelectionMode()">取消</button>
                `;
                document.body.appendChild(bar);
            } else {
                document.getElementById('sel-count').innerText = `已选 ${this.selectedTaskIds.size}`;
                document.getElementById('btn-select-all').innerText = allSelected ? '全不选' : '全选';
            }
        } else {
            if (selBar) selBar.remove();
        }
    }

    ensureInboxField() {
        const tagsInput = document.getElementById('task-tags');
        if (!tagsInput) return;
        const parent = tagsInput.closest('.form-group');
        if (!parent) return;
        if (!document.getElementById('task-inbox')) {
            const div = document.createElement('div');
            div.className = 'form-group';
            div.style.display = 'flex';
            div.style.gap = '10px';
            div.style.alignItems = 'center';
            div.innerHTML = `<input type="checkbox" id="task-inbox" style="width:auto; height:auto;"> <label for="task-inbox" class="form-label" style="margin:0;">加入待办箱（无日期/时间）</label>`;
            parent.insertAdjacentElement('afterend', div);
        }
    }

    createCardHtml(t) {
        const qColor = this.getQuadrantColor(t.quadrant);
        const tags = (t.tags||[]).map(tag => `<span class="tag-pill">#${tag}</span>`).join(' ');
        const isSelected = this.selectedTaskIds.has(t.id);
        const dateText = this.isInboxTask(t) ? '待办箱' : (t.date || '未设日期');
        
        const selClass = this.isSelectionMode ? `selection-mode ${isSelected ? 'selected' : ''}` : '';
        const clickHandler = this.isSelectionMode ? `app.toggleSelection(${t.id})` : `app.openModal(${t.id})`;
        
        let subHtml = '';
        if(t.subtasks && t.subtasks.length > 0 && !this.isSelectionMode) {
            const subRows = t.subtasks.map((sub, idx) => `
                <div class="card-subtask-item" onclick="event.stopPropagation(); app.toggleSubtask(${t.id}, ${idx})">
                    <div class="sub-checkbox ${sub.completed?'checked':''}"></div>
                    <span style="${sub.completed?'text-decoration:line-through;opacity:0.6':''}">${sub.title}</span>
                </div>
            `).join('');
            subHtml = `<div class="card-subtask-list">${subRows}</div>`;
        }

        return `
            <div class="task-card ${t.status} ${selClass}" style="border-left-color:${qColor}" 
                 draggable="${!this.isSelectionMode}" 
                 ondragstart="app.drag(event, ${t.id})" 
                 onmousedown="app.handleCardPress(event, ${t.id})" 
                 onmouseup="app.handleCardRelease()" 
                 ontouchstart="app.handleCardPress(event, ${t.id})" 
                 ontouchend="app.handleCardRelease()" 
                 onclick="${clickHandler}">
                <div class="checkbox ${t.status==='completed'?'checked':''}" onclick="event.stopPropagation();app.toggleTask(${t.id})"></div>
                <div style="flex:1">
                    <div class="task-title">${t.title}</div>
                    <div style="font-size:0.75rem; color:#666; margin-top:2px;">📅 ${dateText}</div>
                    <div style="margin-top:4px;">${tags}</div>
                    ${t.start ? `<div style="font-size:0.75rem; color:var(--primary)">⏰ ${t.start}</div>` : ''}
                    ${subHtml}
                </div>
            </div>
        `;
    }

    // --- 任务操作 ---
    openModal(taskId = null, dateStr = null) {
        if (this.isSelectionMode) { if (taskId) this.toggleSelection(taskId); return; }

        this.currentTaskId = taskId;
        this.ensureInboxField();
        document.getElementById('modal-overlay').style.display = 'flex';
        document.getElementById('modal-title').innerText = taskId ? '✏️ 编辑任务' : '📝 新建任务';
        
        const t = taskId ? this.data.find(i => i.id === taskId) : null;
        const isInbox = t ? (t.inbox || this.isInboxTask(t)) : false;
        document.getElementById('task-title').value = t ? t.title : '';
        document.getElementById('task-date').value = t ? (t.date || '') : (dateStr || this.formatDate(this.currentDate));
        document.getElementById('task-start').value = t ? t.start || '' : '';
        document.getElementById('task-end').value = t ? t.end || '' : '';
        document.getElementById('task-quadrant').value = t ? t.quadrant || 'q2' : 'q2';
        document.getElementById('task-tags').value = t ? (t.tags || []).join(', ') : '';
        const inboxBox = document.getElementById('task-inbox');
        if (inboxBox) inboxBox.checked = isInbox;
        if (isInbox) {
            document.getElementById('task-date').value = '';
            document.getElementById('task-start').value = '';
            document.getElementById('task-end').value = '';
        }
        
        document.getElementById('subtask-container').innerHTML = '';
        const subs = t ? (t.subtasks || []) : [];
        if(subs.length === 0) this.addSubtaskInput(); 
        else subs.forEach(s => this.addSubtaskInput(s.title, s.completed));

        setTimeout(() => document.getElementById('task-title').focus(), 100);
    }
    closeModal() { document.getElementById('modal-overlay').style.display = 'none'; this.currentTaskId = null; }

    saveTask() {
        const title = document.getElementById('task-title').value;
        if(!title) return alert("标题不能为空");
        
        const inboxBox = document.getElementById('task-inbox');
        const isInbox = inboxBox ? inboxBox.checked : false;
        const subtasks = [];
        document.querySelectorAll('.subtask-item').forEach(item => {
            const input = item.querySelector('input[type="text"]');
            const check = item.querySelector('input[type="checkbox"]');
            if(input.value.trim()) subtasks.push({ title: input.value.trim(), completed: check.checked });
        });

        // 自动完成父任务逻辑
        let status = this.currentTaskId ? (this.data.find(i=>i.id==this.currentTaskId).status) : 'todo';
        if (subtasks.length > 0) {
            if (subtasks.every(s => s.completed)) status = 'completed';
            else if (status === 'completed') status = 'todo';
        }

        const newItem = {
            id: this.currentTaskId || Date.now(),
            title, 
            date: isInbox ? '' : document.getElementById('task-date').value,
            start: isInbox ? '' : document.getElementById('task-start').value,
            end: isInbox ? '' : document.getElementById('task-end').value,
            quadrant: document.getElementById('task-quadrant').value,
            tags: document.getElementById('task-tags').value.split(/[,，]/).map(t => t.trim()).filter(t => t),
            subtasks, status,
            inbox: isInbox,
            deletedAt: this.currentTaskId ? (this.data.find(i=>i.id==this.currentTaskId)?.deletedAt || null) : null
        };

        if (this.currentTaskId) {
            const idx = this.data.findIndex(t => t.id === this.currentTaskId);
            if (idx > -1) this.data[idx] = { ...this.data[idx], ...newItem };
        } else {
            this.data.push(newItem);
        }

        this.closeModal();
        this.saveData();
        this.render();
        this.renderTags();
    }

    // --- 多选逻辑 ---
    handleCardPress(e, id) {
        if (this.isSelectionMode) return;
        // 仅在任务列表或待办箱支持长按进入多选
        if (this.view !== 'tasks' && this.view !== 'inbox') return;
        this.longPressTimer = setTimeout(() => { this.enterSelectionMode(id); this.longPressTimer = null; }, 500);
    }
    handleCardRelease() { if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; } }
    enterSelectionMode(initialId) { this.isSelectionMode = true; this.selectedTaskIds.clear(); if (initialId) this.selectedTaskIds.add(initialId); if(navigator.vibrate) navigator.vibrate(50); this.render(); }
    exitSelectionMode() { this.isSelectionMode = false; this.selectedTaskIds.clear(); this.render(); }
    toggleSelection(id) { if (this.selectedTaskIds.has(id)) this.selectedTaskIds.delete(id); else this.selectedTaskIds.add(id); this.render(); }
    
    selectAllTasks() {
        // 修复 Problem 6: 全选逻辑，只选中 visible 且未完成的任务
        const visibleTasks = this.getFilteredData().filter(t => t.status !== 'completed');
        const visibleIds = visibleTasks.map(t => t.id);
        
        // 检查是否所有未完成任务都已被选中
        const isAllSelected = visibleIds.length > 0 && visibleIds.every(id => this.selectedTaskIds.has(id));
        
        if (isAllSelected) {
            // 反选：清空当前选中的这些（保留不在当前视图的？通常全选操作清空就清空当前视图的）
            // 这里简单处理：如果全选了，就清空
            this.selectedTaskIds.clear();
        } else {
            // 全选：添加所有可见未完成任务ID
            visibleIds.forEach(id => this.selectedTaskIds.add(id));
        }
        this.render();
    }
    
    deleteSelectedTasks() {
        const count = this.selectedTaskIds.size;
        if (count === 0) return;
        if (!confirm(`确定删除选中的 ${count} 个任务吗？`)) return;
        const now = Date.now();
        this.data.forEach(t => {
            if (this.selectedTaskIds.has(t.id) && !t.deletedAt) {
                t.deletedAt = now;
            }
        });
        this.saveData();
        this.exitSelectionMode();
        this.showToast(`已移动到回收站: ${count} 个任务`);
    }

    deleteCurrentTask() {
        if (!this.currentTaskId) { this.closeModal(); return; }
        const t = this.data.find(x => x.id === this.currentTaskId);
        if (!t) { this.closeModal(); return; }
        if (!confirm(`确定删除任务 "${t.title}" 吗？`)) return;
        t.deletedAt = Date.now();
        this.saveData();
        this.closeModal();
        this.render();
        this.showToast('已移动到回收站');
    }

    restoreTask(id) {
        const t = this.data.find(x => x.id === id);
        if (t) {
            t.deletedAt = null;
            this.saveData();
            this.render();
            this.showToast('已还原');
        }
    }

    deleteForever(id) {
        if (!confirm('确定彻底删除该任务吗？')) return;
        this.data = this.data.filter(t => t.id !== id);
        this.saveData();
        this.render();
    }
    emptyRecycle() {
        if (!confirm('确定清空回收站吗？此操作不可恢复')) return;
        this.data = this.data.filter(t => !t.deletedAt);
        this.saveData();
        this.render();
        this.showToast('回收站已清空');
    }

    // --- 工具 & 统计 ---
    toggleTask(id) {
        if(this.isSelectionMode) return;
        const t = this.data.find(t => t.id === id);
        if (t && !t.deletedAt) {
            t.status = t.status === 'completed' ? 'todo' : 'completed';
            if (t.status === 'completed' && t.subtasks) t.subtasks.forEach(s => s.completed = true);
            this.saveData();
            this.render();
        }
    }
    toggleSubtask(taskId, subIndex) {
        if(this.isSelectionMode) return;
        const t = this.data.find(i => i.id === taskId);
        if(t && !t.deletedAt && t.subtasks && t.subtasks[subIndex]) {
            t.subtasks[subIndex].completed = !t.subtasks[subIndex].completed;
            if (t.subtasks.every(s => s.completed)) { t.status = 'completed'; this.showToast('子任务全部完成，任务已自动勾选！'); }
            else { if (t.status === 'completed') t.status = 'todo'; }
            this.saveData();
            this.render();
        }
    }
    addSubtaskInput(val = '', checked = false) {
        const div = document.createElement('div');
        div.className = 'subtask-item';
        div.innerHTML = `<input type="checkbox" ${checked?'checked':''}> <input type="text" class="form-input" style="margin:0; margin-left:8px; padding:6px; flex:1;" value="${val}" placeholder="子任务"> <span onclick="this.parentElement.remove()" style="cursor:pointer; margin-left:8px;">✕</span>`;
        document.getElementById('subtask-container').appendChild(div);
    }
    
    // Drag, Stats, Utils
    drag(ev, id) { 
        if(this.isSelectionMode) { ev.preventDefault(); return; } 
        const t = this.data.find(x => x.id === id);
        if (t && t.deletedAt) { ev.preventDefault(); return; }
        ev.dataTransfer.setData("text", id); ev.target.classList.add('dragging'); 
    }
    drop(ev, quadrantId) {
        ev.preventDefault();
        const id = parseInt(ev.dataTransfer.getData("text"));
        const t = this.data.find(i => i.id === id);
        document.querySelector('.dragging')?.classList.remove('dragging');
        if(t && !t.deletedAt && t.quadrant !== quadrantId) { t.quadrant = quadrantId; this.saveData(); this.render(); }
    }
    
    renderStats(tasks = this.getFilteredData()) {
        const done = tasks.filter(t => t.status === 'completed').length;
        const total = tasks.length;
        const rate = total === 0 ? 0 : Math.round((done/total)*100);
        document.getElementById('completion-rate').innerText = rate + '%';
        
        const currentAnchor = new Date(this.statsDate);
        const day = currentAnchor.getDay();
        const diff = currentAnchor.getDate() - day + (day == 0 ? -6 : 1);
        const startOfWeek = new Date(currentAnchor.setDate(diff));
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        
        const weekData = [];
        for(let i=0; i<7; i++) {
            const d = new Date(startOfWeek); d.setDate(d.getDate() + i);
            const dStr = this.formatDate(d);
            const dayDone = tasks.filter(t => t.date === dStr && t.status === 'completed').length;
            weekData.push({ day: ['一','二','三','四','五','六','日'][i], count: dayDone });
        }
        
        const maxVal = Math.max(...weekData.map(d=>d.count), 1);
        const barsHtml = weekData.map(d => `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end;">
                <div style="width:20px; height:${Math.max(4, (d.count/maxVal)*100)}%; background:var(--primary); border-radius:4px 4px 0 0; opacity:0.8;"></div>
                <div style="font-size:0.7rem; color:#666; margin-top:5px;">${d.day}</div>
                <div style="font-size:0.7rem; font-weight:bold;">${d.count}</div>
            </div>`).join('');

        document.getElementById('view-stats').innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:20px;">
                <div class="stats-card" style="flex:1; min-width:250px; text-align:center;">
                    <h3>📊 总完成率</h3>
                    <div style="width:120px; height:120px; border-radius:50%; background:conic-gradient(var(--primary) ${rate}%, #eee 0); margin:20px auto; display:flex; align-items:center; justify-content:center;">
                        <div style="width:100px; height:100px; background:rgba(255,255,255,0.9); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:1.5rem;">${rate}%</div>
                    </div>
                    <p style="color:#666;">总任务: ${total} / 已完成: ${done}</p>
                </div>
                <div class="stats-card" style="flex:2; min-width:300px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3>📈 本周趋势</h3>
                        <div>
                            <button class="btn-text" onclick="app.changeStatsWeek(-1)">❮</button>
                            <span style="font-size:0.8rem; font-weight:bold; margin:0 10px;">${this.formatDate(startOfWeek).slice(5)} - ${this.formatDate(endOfWeek).slice(5)}</span>
                            <button class="btn-text" onclick="app.changeStatsWeek(1)">❯</button>
                        </div>
                    </div>
                    <div style="height:150px; display:flex; gap:5px; align-items:flex-end; padding-bottom:10px;">${barsHtml}</div>
                </div>
            </div>`;
    }
    changeStatsWeek(off) { this.statsDate.setDate(this.statsDate.getDate() + off * 7); this.render(); }

    renderRecycle(tasks) {
        const box = document.getElementById('recycle-list');
        if (!box) return;
        const clearBtn = `<div style="text-align:right; margin-bottom:10px;"><button class="btn btn-sm btn-danger" onclick="app.emptyRecycle()">清空回收站</button></div>`;
        if (!tasks.length) { box.innerHTML = clearBtn + '<div style="opacity:0.7">回收站空空如也</div>'; return; }
        box.innerHTML = clearBtn + tasks.map(t => `
            <div class="task-card" style="background:#f9f9f9; border-left-color:#aaa;">
                <div style="flex:1">
                    <div class="task-title">${t.title}</div>
                    <div style="font-size:0.75rem; color:#666; margin-top:4px;">删除时间：${new Date(t.deletedAt).toLocaleString()}</div>
                    <div style="margin-top:4px; font-size:0.75rem; color:#666;">标签：${(t.tags||[]).join(', ') || '无'}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-sm btn-secondary" onclick="app.restoreTask(${t.id})">还原</button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteForever(${t.id})">彻底删除</button>
                </div>
            </div>`).join('');
    }

    renderTags() {
        const tags = new Set(); this.data.filter(t => !t.deletedAt).forEach(t => (t.tags||[]).forEach(tag => tags.add(tag)));
        document.getElementById('tag-filter-list').innerHTML = Array.from(tags).map(tag => `
            <div class="nav-item ${this.filter.tag===tag?'active':''}" onclick="if(!event.target.closest('.tag-more')) app.setTagFilter('${tag}')">
                <div class="tag-dot"></div> 
                <span style="flex:1">${tag}</span>
                <div class="tag-more" onclick="event.stopPropagation();app.openTagMenu('${tag}')">⋯</div>
            </div>
        `).join('');
    }
    setTagFilter(tag) { this.filter.tag = this.filter.tag === tag ? '' : tag; this.renderTags(); this.render(); }
    deleteTag(tag) {
        if (!confirm(`删除标签 "${tag}" 会移除所有包含该标签的任务，确定吗？`)) return;
        const now = Date.now();
        this.data.forEach(t => {
            if ((t.tags||[]).includes(tag)) {
                t.deletedAt = now;
            }
        });
        this.saveData();
        this.render();
        this.renderTags();
        this.showToast(`已删除包含 ${tag} 的任务`);
    }

    openTagMenu(tag) {
        const newName = prompt(`标签操作: 输入新名称以重命名，或留空直接删除。\n当前: ${tag}`, tag);
        if (newName === null) return;
        const trimmed = newName.trim();
        if (trimmed === '' || trimmed === tag) {
            this.deleteTag(tag);
            return;
        }
        // 重命名
        this.data.forEach(t => {
            if (t.tags) {
                t.tags = t.tags.map(x => x === tag ? trimmed : x);
            }
        });
        this.saveData();
        this.render();
        this.renderTags();
        this.showToast(`已重命名标签为 ${trimmed}`);
    }
    getFilteredData(options = {}) { 
        const { includeDeleted = false, onlyDeleted = false } = options;
        const q = this.filter.query ? this.filter.query.trim() : '';
        return this.data.filter(t => {
            if (onlyDeleted) {
                if (!t.deletedAt) return false;
            } else if (!includeDeleted && t.deletedAt) return false;

            const matchQuery = !q || t.title.includes(q) 
                || (t.tags||[]).some(tag => tag.includes(q))
                || (t.subtasks||[]).some(s => (s.title||'').includes(q));
            const matchTag = !this.filter.tag || (t.tags||[]).includes(this.filter.tag);
            return matchQuery && matchTag;
        });
    }

    cleanupRecycle() {
        const now = Date.now();
        const before = this.data.length;
        this.data = this.data.filter(t => !t.deletedAt || (now - t.deletedAt) <= 7 * 24 * 60 * 60 * 1000);
        return this.data.length !== before;
    }
    handleSearch(val) { this.filter.query = val; if(val && this.view!=='search') this.switchView('search'); this.render(); }
    
    updateDateDisplay() { document.getElementById('date-display').innerText = document.getElementById('cal-date-display').innerText = this.formatDate(this.currentDate); }
    showToast(msg) { const div = document.createElement('div'); div.className = 'toast show'; div.innerText = msg; document.getElementById('toast-container').appendChild(div); setTimeout(() => div.remove(), 2000); }
    
    formatDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    timeToMinutes(str) { const [h,m] = str.split(':').map(Number); return h*60+m; }
    minutesToTime(m) { const h = Math.floor(m/60); const min = Math.floor(m%60); return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`; }
    getQuadrantColor(q) { return {q1:'var(--danger)', q2:'var(--primary)', q3:'var(--warning)', q4:'var(--success)'}[q || 'q2']; }
    isInboxTask(t) { return !!t && ((!t.date && !t.start && !t.end) || t.inbox); }
    
    // 导出
    openExportModal() { document.getElementById('export-modal-overlay').style.display = 'flex'; this.setExportType('daily'); }
    setExportType(type) {
        this.exportSettings.type = type;
        document.getElementById('export-template').value = type === 'daily' ? this.exportSettings.dailyTemplate : this.exportSettings.weeklyTemplate;
        document.getElementById('btn-export-daily').className = type==='daily'?'btn btn-sm':'btn btn-sm btn-secondary';
        document.getElementById('btn-export-weekly').className = type==='weekly'?'btn btn-sm':'btn btn-sm btn-secondary';
        this.renderExportPreview();
    }
    handleTemplateChange(val) { 
        if(this.exportSettings.type === 'daily') this.exportSettings.dailyTemplate = val; else this.exportSettings.weeklyTemplate = val;
        this.renderExportPreview(); 
    }
    renderExportPreview() {
        const tmpl = document.getElementById('export-template').value;
        const now = this.formatDate(new Date());
        const todayTasks = this.data.filter(t => t.date === now);
        const done = todayTasks.filter(t => t.status === 'completed');
        const res = tmpl.replace('{date}', now).replace('{tasks}', done.map(t=>`- ${t.title}`).join('\n')||'(无)').replace('{rate}', todayTasks.length ? Math.round((done.length/todayTasks.length)*100) : 0).replace('{plan}', '(请填写)');
        document.getElementById('export-preview').innerText = res;
    }
    copyReport() { navigator.clipboard.writeText(document.getElementById('export-preview').innerText); this.showToast('已复制'); document.getElementById('export-modal-overlay').style.display = 'none'; }
    downloadJSON() {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(this.data, null, 2)], {type: "application/json"}));
        a.download = `glass-todo-${this.formatDate(new Date())}.json`; a.click();
    }

    async importJSON(file) {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) throw new Error('文件格式错误');
            this.data = parsed;
            this.dataVersion = Date.now();
            this.cleanupRecycle();
            await this.saveData(true);
            this.render();
            this.renderTags();
            this.showToast('导入成功');
        } catch (e) {
            console.error(e);
            alert('导入失败：' + (e.message || '解析错误'));
        }
    }
}
const app = new TodoApp();
app.init();
