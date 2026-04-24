# Web EPUB Reader (本地 EPUB 网页阅读器)

这是一个基于 `Node.js + Express` 开发的轻量级网页版 EPUB 电子书阅读器，支持用户注册登录、管理员后台和书籍管理。


---

## ✨ 功能特点

- **书架展示**：自动提取 epub 封面，支持分页浏览
- **阅读器**：支持翻页、键盘控制（左右箭头）、夜间模式、字体大小调节
- **书名清理**：自动去除书名中的《》、网址等特殊字符
- **进度管理**：自动记录阅读章节到数据库
- **阅读历史**：记录用户阅读历史（需登录）
- **章节统计**：初始化时自动解析 epub 获取章节数
- **章节HTML**：初始化时自动生成各章节的 HTML 文件
- **封面提取**：初始化时自动提取并保存封面图片
- **用户系统**：支持注册登录（数据存储在 SQLite）
- **管理员后台**：管理用户权限、管理书籍（上传/删除）
- **书籍上传**：支持网页上传 epub 文件

---

## 🛠️ 项目架构与原理

1. **Node.js (Express)**: 负责提供 Web 服务环境：
   - 静态目录服务：让浏览器可以访问 `public/` 下的网页文件和 `books/` 下的电子书
   - SQLite 数据库：存储用户信息和书籍数据
   - RESTful API：提供书籍管理和用户认证接口

2. **前端网页 (浏览器)**:
   - 使用 `fetch` API 请求后端接口
   - 阅读器通过 iframe 加载预先生成的章节 HTML 文件

---

## 📂 文件目录说明

```
book/
├── books/                 # 书籍存放目录，.epub 格式文件放这里
├── public/                # 前端静态文件目录
│   ├── index.html         # 书架页：展示书籍列表和封面
│   ├── reader.html        # 阅读页：电子书阅读器
│   ├── login.html         # 登录页
│   ├── register.html      # 注册页
│   ├── history.html       # 阅读历史页
│   ├── header.html        # 头部公共组件
│   ├── header.js          # 头部公共脚本
│   ├── admin/             # 管理后台
│   │   ├── index.html     # 管理首页
│   │   ├── books.html     # 书籍管理
│   │   └── users.html     # 用户管理
│   └── generated/         # 生成的章节HTML和封面图片
│       └── {书名}/
│           ├── cover.jpg/png  # 封面图片
│           ├── toc.html       # 目录页
│           └── chapter_1.html # 章节页
├── data/                  # SQLite 数据库目录
├── server.js              # Node.js 后端服务器
├── package.json           # 项目配置
└── README.md              # 项目说明
```

---

## 🗄️ 数据库表结构

### users 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键自增 |
| username | TEXT | 用户名（唯一） |
| password | TEXT | 密码 |
| is_admin | INTEGER | 是否管理员（0/1） |
| is_allowed | INTEGER | 是否允许登录（0/1） |
| last_login | DATETIME | 最后登录时间 |
| created_at | DATETIME | 创建时间 |

### books 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键自增 |
| title | TEXT | 书名（自动清理特殊字符） |
| file_path | TEXT | 文件路径（唯一） |
| cover_path | TEXT | 封面图片路径 |
| total_chapters | INTEGER | 总章节数 |
| current_page | INTEGER | 当前阅读章节 |
| click_count | INTEGER | 点击次数 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### reading_history 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键自增 |
| user_id | INTEGER | 用户ID |
| book_id | INTEGER | 书籍ID |
| current_page | INTEGER | 当前阅读章节 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

---

## 📡 API 接口

### 用户接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/register | 用户注册 |
| POST | /api/login | 用户登录 |

### 书籍接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/books | 获取 epub 文件列表 |
| GET | /api/db/books | 获取数据库书籍列表（分页） |
| POST | /api/db/books/init | 初始化书籍（扫描 books 目录） |
| GET | /api/db/books/by-filename | 根据文件名获取书籍详情 |
| PUT | /api/db/books/:id/progress | 更新书籍进度 |
| PUT | /api/db/books/:id/click | 更新书籍点击次数 |
| PUT | /api/db/books/by-filename/progress | 根据文件名更新进度 |

### 阅读历史接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/reading-history | 保存阅读历史（用户ID+书籍ID+页码） |
| GET | /api/reading-history/:user_id | 获取用户阅读历史列表 |
| GET | /api/reading-history/:user_id/:book_id | 获取指定用户和书籍的阅读历史 |

### 管理员接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users | 获取用户列表（分页） |
| PUT | /api/admin/users/:id | 更新用户（is_admin/is_allowed） |
| POST | /api/admin/books/upload | 上传书籍 |
| DELETE | /api/admin/books/:id | 删除书籍 |

---

## 🚀 如何使用

### 1. 环境准备
确保已安装 [Node.js](https://nodejs.org/)

### 2. 安装依赖
```bash
npm install
```

### 3. 添加电子书
将 `.epub` 文件放入 `books/` 目录

### 4. 初始化书籍（重要）
启动服务后，调用初始化接口扫描书籍：
```bash
curl -X POST http://localhost:3000/api/db/books/init
```

### 5. 启动服务
```bash
npm start
# 或直接运行
node server.js
```

服务运行在 http://localhost:3000

### 6. 开始使用
- 访问 http://localhost:3000/index.html 进入书架
- 点击书籍进入阅读器
- 访问 http://localhost:3000/register.html 注册账号
- 访问 http://localhost:3000/login.html 登录
- 管理员访问 http://localhost:3000/admin/index.html 管理后台

初始管理员账号admin/admin1024
---

## 🐳 Docker 部署

### 使用 Docker Compose（推荐）
```bash
docker-compose up -d

docker-compose up -d --build
```


### 使用 Dockerfile
```bash
# 构建镜像
docker build -t book-reader .

# 运行容器
docker run -d -p 3000:3000 -v $(pwd)/books:/app/books book-reader
```