const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库文件存放路径，当前目录下生成 library.db
const dbPath = path.join(__dirname, 'library.db');

// 初始化并连接到 SQLite 数据库
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('SQLite 数据库连接失败:', err.message);
    } else {
        console.log('SQLite 数据库连接成功: ' + dbPath);
        
        // 在这里可以初始化我们可能需要的表结构，比如保存阅读进度
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS reading_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_filename TEXT NOT NULL UNIQUE,
                cfi TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('创建表格失败:', err.message);
                } else {
                    console.log('数据表初始检查完成。');
                }
            });
        });
    }
});

// 导出 db 实例以便其他文件引用，例如 server.js
module.exports = db;
