# Glass Todo Local

## 使用方式一览

你可以根据自己的情况选择一种方式使用。

### 方式一：Windows 本地使用（推荐新手）

这是**最简单**的方式：

1. 下载 Release 压缩包  
2. 解压到任意文件夹  
3. 双击 `启动.bat`
4. 浏览器访问： http://127.0.0.1:3000

如果你想让 **同一局域网的设备访问**：

- 电脑启动后端服务
- 其他设备访问：http://电脑IP:3000

适合：
- 家庭局域网
- 办公室内使用

---

### 方式二：Cloudflare 云端部署（进阶）

如果你想 **在公网使用**（例如手机 / 平板 / 异地）：

☁️ Cloudflare 云端部署说明（生产环境）

适合：
- 想在公网访问（手机 / 平板 / 异地）
- 不想买服务器
- 能接受 Cloudflare 生态

#### 一、你需要准备什么

在开始之前，请确认你已经有：
- 一个 Cloudflare 账号
- 一个 GitHub 账号
- fork本项目代码
- 本地已安装 Node.js

#### 二、部署步骤
1. 创建 Cloudflare D1 数据库
    1. 安装 Wrangler
    ` npm install -g wrangler`
    2. 登录 Cloudflare
    ` wrangler login`
    3. 创建数据库(在项目根目录执行)
    `wrangler d1 create glass_todo`
    *记录返回的database_id*
    4. 初始化数据库表 
    `wrangler d1 execute glass_todo --file=./schema.sql`
2. 部署后端
    1. 修改 wrangler.toml 文件
        ```name = "glass-todo-worker"
main = "worker.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "glass_todo"
database_id = "刚才生成的 database_id"

3. 发布 Worker
`wrangler deploy `

成功后你会得到一个地址，例如：https://glass-todo-worker.xxx.workers.dev  #这个是后端地址

4. 修改config.json文件
将config文件中 **API_BASE** 修改为实际的后端地址。
一定要用 https，不要带 / 结尾。

5. 创建 Pages 项目
    1. Cloudflare 控制台 → Pages → Create Project
    2. 选择 GitHub 仓库
    3. 构建设置：
        1. Framework：None
        2. Build command：留空
        3. Output directory：public

6. 部署完成

几分钟后，你会得到一个 Pages 地址：https://xxx.pages.dev











