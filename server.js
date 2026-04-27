const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const AdmZip = require('adm-zip');
const multer = require('multer');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log('[API]', new Date().toISOString(), '-', req.method, req.originalUrl);
    next();
});

setInterval(() => {
    console.log('[HEARTBEAT]', new Date().toISOString(), '- 服务器运行中...');
}, 60000);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(path.join(dataDir, 'users.db'), (err) => {
    if (err) {
        console.error('[DB]', new Date().toISOString(), '- 数据库连接失败:', err);
    } else {
        console.log('[DB]', new Date().toISOString(), '- 成功连接到 SQLite 数据库');
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        is_allowed INTEGER DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('[DB]', new Date().toISOString(), '- 创建users表失败:', err);
        } else {
            db.get("SELECT id FROM users WHERE username = 'admin'", (err, row) => {
                if (!row) {
                    db.run("INSERT INTO users (username, password, is_admin) VALUES ('admin', '6fe9f921b95d9ab966fae28149fa89f7', 1)");
                    console.log('[DB]', new Date().toISOString(), '- 已创建默认管理员账号: admin');
                }
            });
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        file_path TEXT UNIQUE NOT NULL,
        cover_path TEXT,
        total_chapters INTEGER DEFAULT 0,
        current_page INTEGER DEFAULT 1,
        click_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reading_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        current_page INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, book_id)
    )`);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/books/{*path}', (req, res, next) => {
    let fullPathArray = req.params.path;
    let fullPath = Array.isArray(fullPathArray) ? fullPathArray.join('/') : fullPathArray;

    const splitIndex = fullPath.indexOf('!/');
    if (splitIndex === -1) {
        return next();
    }

    let bookFileName = fullPath.substring(0, splitIndex);
    let filePath = fullPath.substring(splitIndex + 2);
    
    try {
        bookFileName = decodeURIComponent(bookFileName);
        filePath = decodeURIComponent(filePath);
    } catch (e) {}

    const bookPath = path.join(__dirname, 'books', bookFileName);
    if (!fs.existsSync(bookPath)) {
        return res.status(404).send('Book not found');
    }

    try {
        const zip = new AdmZip(bookPath);
        const entry = zip.getEntry(filePath);
        if (entry) {
            const content = entry.getData();
            let ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.xhtml': 'application/xhtml+xml',
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.ttf': 'font/ttf',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2'
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.send(content);
        } else {
            res.status(404).send('File not found inside book');
        }
    } catch (err) {
        console.error('[SERVER]', new Date().toISOString(), '- 读取ZIP内容失败:', err.message);
        res.status(500).send('Internal Server Error');
    }
});

app.use('/books', express.static(path.join(__dirname, 'books'), { maxAge: '1h', etag: false }));

const generatedDir = path.join(__dirname, 'public', 'generated');
app.get('/generated/{*path}', (req, res) => {
    let filePath = req.params.path;
    if (Array.isArray(filePath)) {
        filePath = filePath.join('/');
    }
    try {
        filePath = decodeURIComponent(filePath);
    } catch (e) {}
    const fullPath = path.join(generatedDir, filePath);
    res.sendFile(fullPath, (err) => {
        if (err) {
            console.error('[SERVER]', new Date().toISOString(), '- 读取生成文件失败:', fullPath, '- 错误:', err.message);
            res.status(404).send('Not Found');
        }
    });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const booksDir = path.join(__dirname, 'books');
        if (!fs.existsSync(booksDir)) {
            fs.mkdirSync(booksDir, { recursive: true });
        }
        cb(null, booksDir);
    },
    filename: (req, file, cb) => {
        let filename = file.originalname;
        filename = Buffer.from(filename, 'latin1').toString('utf8');
        const safeName = filename.replace(/[<>:"/\\|?*]/g, '_').trim();
        cb(null, safeName);
    }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.get('/api/books', (req, res) => {
    const booksDir = path.join(__dirname, 'books');
    fs.readdir(booksDir, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read books directory' });
        }
        const epubFiles = files.filter(file => file.endsWith('.epub'));
        res.json(epubFiles);
    });
});

app.get('/api/db/books', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 15;
    const offset = (page - 1) * pageSize;

    db.get('SELECT COUNT(*) as total FROM books order by updated_at desc', (err, countResult) => {
        if (err) {
            return res.status(500).json({ error: '获取书籍数量失败' });
        }

        const total = countResult.total;

        db.all('SELECT * FROM books ORDER BY created_at DESC LIMIT ? OFFSET ?', [pageSize, offset], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: '获取书籍列表失败' });
            }

            res.json({
                data: rows,
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.ceil(total / pageSize)
                }
            });
        });
    });
});

function getEpubChapterCount(filePath) {
    try {
        const zip = new AdmZip(filePath);
        const opfFiles = zip.getEntries().map(e => e.entryName).filter(name => name.endsWith('.opf'));
        if (opfFiles.length === 0) return 0;

        const opfContent = zip.readAsText(opfFiles[0]);
        const spineMatch = opfContent.match(/<spine[^>]*>(.*?)<\/spine>/s);
        if (!spineMatch) return 0;

        const itemrefs = spineMatch[1].match(/<itemref[^>]*>/g);
        return itemrefs ? itemrefs.length : 0;
    } catch (err) {
        console.error('[BOOKS]', new Date().toISOString(), '- 解析epub失败:', err.message);
        return 0;
    }
}

function parseEpubForChapters(filePath) {
    try {
        const zip = new AdmZip(filePath);
        const opfFiles = zip.getEntries().map(e => e.entryName).filter(name => name.endsWith('.opf'));
        if (opfFiles.length === 0) return null;

        const opfPath = opfFiles[0];
        const opfDir = path.dirname(opfPath);
        const opfContent = zip.readAsText(opfPath);

        const manifestMatch = opfContent.match(/<manifest>(.*?)<\/manifest>/s);
        if (!manifestMatch) return null;

        const manifest = {};
        const itemMatches = manifestMatch[1].match(/<item[^>]+>/g);
        if (itemMatches) {
            itemMatches.forEach(item => {
                const idMatch = item.match(/id="([^"]+)"/);
                const hrefMatch = item.match(/href="([^"]+)"/);
                const mediaMatch = item.match(/media-type="([^"]+)"/);
                if (idMatch && hrefMatch && mediaMatch) {
                    manifest[idMatch[1]] = {
                        href: hrefMatch[1],
                        mediaType: mediaMatch[1]
                    };
                }
            });
        }

        const spineMatch = opfContent.match(/<spine[^>]*>(.*?)<\/spine>/s);
        if (!spineMatch) return null;

        const chapters = [];
        const itemrefs = spineMatch[1].match(/<itemref[^>]*>/g);
        if (itemrefs) {
            itemrefs.forEach((itemref, index) => {
                const idrefMatch = itemref.match(/idref="([^"]+)"/);
                if (idrefMatch && manifest[idrefMatch[1]]) {
                    const item = manifest[idrefMatch[1]];
                    if (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html') {
                        const fullPath = opfDir === '.' ? item.href : path.join(opfDir, item.href);
                        chapters.push({
                            index: index + 1,
                            id: idrefMatch[1],
                            href: item.href,
                            path: fullPath.replace(/\\/g, '/')
                        });
                    }
                }
            });
        }

        return { chapters, zip, opfDir, manifest };
    } catch (err) {
        console.error('[BOOKS]', new Date().toISOString(), '- 解析epub章节失败:', filePath, '- 错误:', err.message);
        return null;
    }
}

async function extractCoverImage(bookFileName, epubData, outputDir) {
    try {
        const zip = epubData.zip;
        const opfDir = epubData.opfDir;
        const manifest = epubData.manifest;

        let coverPath = null;
        let coverImageEntry = null;

        if (manifest['cover-image']) {
            coverImageEntry = manifest['cover-image'];
        } else {
            for (const id in manifest) {
                if (id.toLowerCase().includes('cover')) {
                    const item = manifest[id];
                    if (item.mediaType && item.mediaType.startsWith('image/')) {
                        coverImageEntry = item;
                        break;
                    }
                }
            }
        }

        if (!coverImageEntry && epubData.chapters.length > 0) {
            const firstChapter = epubData.chapters[0];
            const firstChapterContent = zip.readAsText(firstChapter.path);
            const coverMetaMatch = firstChapterContent.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i);
            if (coverMetaMatch) {
                const coverId = coverMetaMatch[1];
                if (manifest[coverId]) {
                    coverImageEntry = manifest[coverId];
                }
            }

            if (!coverImageEntry) {
                const imgMatch = firstChapterContent.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
                if (imgMatch) {
                    const imgSrc = imgMatch[1];
                    const coverHref = imgSrc.replace(/^[\/\\]*/, '');
                    for (const id in manifest) {
                        if (manifest[id].href === coverHref && manifest[id].mediaType.startsWith('image/')) {
                            coverImageEntry = manifest[id];
                            break;
                        }
                    }
                }
            }
        }

        if (!coverImageEntry) {
            return null;
        }

        const coverHref = coverImageEntry.href;
        const coverFullPath = opfDir === '.' ? coverHref : path.join(opfDir, coverHref).replace(/\\/g, '/');
        const coverEntry = zip.getEntry(coverFullPath);

        if (!coverEntry) {
            return null;
        }

        const ext = path.extname(coverHref).toLowerCase() || '.jpg';
        const bookDir = path.join(outputDir, sanitizeFilename(bookFileName.replace('.epub', '')));
        if (!fs.existsSync(bookDir)) {
            fs.mkdirSync(bookDir, { recursive: true });
        }

        const coverFileName = `cover${ext}`;
        const coverFilePath = path.join(bookDir, coverFileName);
        fs.writeFileSync(coverFilePath, coverEntry.getData());

        return `/generated/${sanitizeFilename(bookFileName.replace('.epub', ''))}/${coverFileName}`;
    } catch (err) {
        console.error('[BOOKS]', new Date().toISOString(), '- 提取封面失败:', bookFileName, '- 错误:', err.message);
        return null;
    }
}

function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
}

function generateBookTitle(filename) {
    let title = filename.replace(/\.epub$/i, '');
    title = title.replace(/[《》]/g, '');
    title = title.replace(/(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|net|org|cn|cc|me|info|xyz|top)(\/[^\s]*)?)/gi, '');
    return title.replace(/^[_\-\s]+|[_\-\s]+$/g, '').trim();
}

async function generateChapterHtml(bookFileName, chapter, epubData, outputDir) {
    try {
        const content = epubData.zip.readAsText(chapter.path);
        let htmlContent = content;

        const baseDir = path.dirname(chapter.path);

        htmlContent = htmlContent.replace(/src=["']([^"']+)["']/gi, (match, src) => {
            if (src.startsWith('http') || src.startsWith('data:')) return match;
            const imgPath = baseDir === '.' ? src : path.join(baseDir, src);
            return `src="/books/${encodeURIComponent(bookFileName)}!/${imgPath.replace(/\\/g, '/')}"`;
        });
        htmlContent = htmlContent.replace(/href=["']([^"']+)["']/gi, (match, href) => {
            if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#') || href.startsWith('data:')) return match;
            const linkPath = baseDir === '.' ? href : path.join(baseDir, href);
            return `href="/books/${encodeURIComponent(bookFileName)}!/${linkPath.replace(/\\/g, '/')}"`;
        });

        const bookDir = path.join(outputDir, sanitizeFilename(bookFileName.replace('.epub', '')));
        if (!fs.existsSync(bookDir)) {
            fs.mkdirSync(bookDir, { recursive: true });
        }

        const chapterFile = path.join(bookDir, `chapter_${chapter.index}.html`);
        fs.writeFileSync(chapterFile, htmlContent, 'utf8');

        return { index: chapter.index, file: `chapter_${chapter.index}.html` };
    } catch (err) {
        console.error('[BOOKS]', new Date().toISOString(), '- 生成章节HTML失败:', chapter.path, '- 错误:', err.message);
        return null;
    }
}

async function generateBookTocHtml(bookFileName, chapters, outputDir) {
    const bookDir = path.join(outputDir, sanitizeFilename(bookFileName.replace('.epub', '')));
    let tocHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>目录 - ${bookFileName.replace('.epub', '')}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }
        h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        .chapter-list { list-style: none; padding: 0; }
        .chapter-item { padding: 12px; border-bottom: 1px solid #eee; }
        .chapter-item a { color: #333; text-decoration: none; display: block; }
        .chapter-item a:hover { color: #007bff; background: #f8f9fa; }
        .chapter-num { color: #007bff; margin-right: 10px; font-weight: bold; }
        .back-link { display: inline-block; margin-bottom: 20px; color: #007bff; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/index.html" class="back-link">&larr; 返回书架</a>
        <h1>目录 - ${bookFileName.replace('.epub', '')}</h1>
        <ul class="chapter-list">
`;

    chapters.forEach(ch => {
        tocHtml += `            <li class="chapter-item">
                <a href="/generated/${sanitizeFilename(bookFileName.replace('.epub', ''))}/chapter_${ch.index}.html">
                    <span class="chapter-num">第${ch.index}章</span>
                </a>
            </li>\n`;
    });

    tocHtml += `        </ul>
    </div>
</body>
</html>`;

    const tocFile = path.join(bookDir, 'toc.html');
    fs.writeFileSync(tocFile, tocHtml, 'utf8');
    return 'toc.html';
}

app.post('/api/admin/books/init-only-new', async (req, res) => {
    console.log('[ADMIN]', new Date().toISOString(), '- 开始差量初始化书籍');
    const booksDir = path.join(__dirname, 'books');
    const outputDir = path.join(__dirname, 'public', 'generated');

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.readdir(booksDir, async (err, files) => {
        if (err) {
            console.error('[ADMIN]', new Date().toISOString(), '- 扫描书籍目录失败:', err.message);
            return res.status(500).json({ error: '扫描书籍目录失败' });
        }

        const epubFiles = files.filter(file => file.endsWith('.epub'));
        if (epubFiles.length === 0) {
            return res.json({ message: '未发现书籍', added: 0, chapters: 0, covers: 0 });
        }

        let added = 0;
        let skipped = 0;
        let totalChaptersGenerated = 0;
        let totalCoversExtracted = 0;

        for (const file of epubFiles) {
            const title = generateBookTitle(file);

            const filePath = path.join(booksDir, file);

            const existingByTitle = await new Promise((resolve) => {
                db.get('SELECT id, file_path FROM books WHERE title = ?', [title], (err, row) => {
                    resolve(row);
                });
            });

            if (existingByTitle && existingByTitle.file_path !== file) {
                console.log('[ADMIN]', new Date().toISOString(), '- 库中已存在相同书名，删除新增文件:', file);
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error('[ADMIN]', new Date().toISOString(), '- 删除重复书籍文件失败:', e.message);
                }
                skipped++;
                continue;
            }

            const epubData = parseEpubForChapters(filePath);
            const totalChapters = epubData ? epubData.chapters.length : 0;

            const existingBook = await new Promise((resolve) => {
                db.get('SELECT id FROM books WHERE file_path = ?', [file], (err, row) => {
                    resolve(row);
                });
            });

            if (existingBook) {
                skipped++;
                continue;
            }

            const coverPath = epubData ? await extractCoverImage(file, epubData, outputDir) : null;

            await new Promise((resolve) => {
                db.run('INSERT INTO books (title, file_path, cover_path, total_chapters) VALUES (?, ?, ?, ?)',
                    [title, file, coverPath, totalChapters], function(err) {
                        if (!err) {
                            added++;
                            console.log('[ADMIN]', new Date().toISOString(), '- 差量新增书籍:', title);
                        }
                        resolve();
                    });
            });

            if (coverPath) totalCoversExtracted++;

            if (epubData) {
                const bookDir = path.join(outputDir, sanitizeFilename(file.replace('.epub', '')));
                if (!fs.existsSync(bookDir)) {
                    fs.mkdirSync(bookDir, { recursive: true });
                }

                for (const chapter of epubData.chapters) {
                    const result = await generateChapterHtml(file, chapter, epubData, outputDir);
                    if (result) totalChaptersGenerated++;
                }

                await generateBookTocHtml(file, epubData.chapters, outputDir);
            }
        }

        console.log('[ADMIN]', new Date().toISOString(), '- 差量初始化完成: 新增', added, '本, 跳过', skipped, '本, 生成', totalChaptersGenerated, '个章节, 提取', totalCoversExtracted, '个封面');
        res.json({
            message: '差量初始化完成',
            added,
            skipped,
            chapters: totalChaptersGenerated,
            covers: totalCoversExtracted
        });
    });
});

app.post('/api/admin/books/init-all', async (req, res) => {
    console.log('[ADMIN]', new Date().toISOString(), '- 开始全量初始化书籍');
    const booksDir = path.join(__dirname, 'books');
    const outputDir = path.join(__dirname, 'public', 'generated');

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.readdir(booksDir, async (err, files) => {
        if (err) {
            console.error('[ADMIN]', new Date().toISOString(), '- 扫描书籍目录失败:', err.message);
            return res.status(500).json({ error: '扫描书籍目录失败' });
        }

        const epubFiles = files.filter(file => file.endsWith('.epub'));
        if (epubFiles.length === 0) {
            return res.json({ message: '未发现书籍', added: 0, updated: 0, chapters: 0, covers: 0 });
        }

        let added = 0;
        let updated = 0;
        let totalChaptersGenerated = 0;
        let totalCoversExtracted = 0;

        for (const file of epubFiles) {
            const title = generateBookTitle(file);

            const filePath = path.join(booksDir, file);

            const existingByTitle = await new Promise((resolve) => {
                db.get('SELECT id, file_path FROM books WHERE title = ?', [title], (err, row) => {
                    resolve(row);
                });
            });

            if (existingByTitle && existingByTitle.file_path !== file) {
                console.log('[ADMIN]', new Date().toISOString(), '- 库中已存在相同书名，删除新增文件:', file);
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error('[ADMIN]', new Date().toISOString(), '- 删除重复书籍文件失败:', e.message);
                }
                continue;
            }

            const epubData = parseEpubForChapters(filePath);
            const totalChapters = epubData ? epubData.chapters.length : 0;

            const coverPath = epubData ? await extractCoverImage(file, epubData, outputDir) : null;

            await new Promise((resolve) => {
                db.get('SELECT id, cover_path FROM books WHERE file_path = ?', [file], (err, row) => {
                    if (!row) {
                        db.run('INSERT INTO books (title, file_path, cover_path, total_chapters) VALUES (?, ?, ?, ?)',
                            [title, file, coverPath, totalChapters], function(err) {
                                if (!err) {
                                    added++;
                                    console.log('[ADMIN]', new Date().toISOString(), '- 全量新增书籍:', title);
                                }
                                resolve();
                            });
                    } else {
                        db.run('UPDATE books SET title = ?, cover_path = ?, total_chapters = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?',
                            [title, coverPath, totalChapters, file], function(err) {
                                if (!err && this.changes > 0) {
                                    updated++;
                                    console.log('[ADMIN]', new Date().toISOString(), '- 全量更新书籍:', title);
                                }
                                resolve();
                            });
                    }
                });
            });

            if (coverPath) totalCoversExtracted++;

            if (epubData) {
                const bookDir = path.join(outputDir, sanitizeFilename(file.replace('.epub', '')));
                if (!fs.existsSync(bookDir)) {
                    fs.mkdirSync(bookDir, { recursive: true });
                }

                for (const chapter of epubData.chapters) {
                    const result = await generateChapterHtml(file, chapter, epubData, outputDir);
                    if (result) totalChaptersGenerated++;
                }

                await generateBookTocHtml(file, epubData.chapters, outputDir);
            }
        }

        console.log('[ADMIN]', new Date().toISOString(), '- 全量初始化完成: 新增', added, '本, 更新', updated, '本, 生成', totalChaptersGenerated, '个章节, 提取', totalCoversExtracted, '个封面');
        res.json({
            message: '全量初始化完成',
            added,
            updated,
            chapters: totalChaptersGenerated,
            covers: totalCoversExtracted
        });
    });
});

app.post('/api/db/books/init', async (req, res) => {
    console.log('[BOOKS]', new Date().toISOString(), '- 开始初始化书籍');
    const booksDir = path.join(__dirname, 'books');
    const outputDir = path.join(__dirname, 'public', 'generated');

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.readdir(booksDir, async (err, files) => {
        if (err) {
            console.error('[BOOKS]', new Date().toISOString(), '- 扫描书籍目录失败:', err.message);
            return res.status(500).json({ error: '扫描书籍目录失败' });
        }

        const epubFiles = files.filter(file => file.endsWith('.epub'));
        if (epubFiles.length === 0) {
            console.log('[BOOKS]', new Date().toISOString(), '- 未发现新书籍');
            return res.json({ message: '未发现新书籍', added: 0, chapters: 0, covers: 0 });
        }

        console.log('[BOOKS]', new Date().toISOString(), '- 发现', epubFiles.length, '本epub书籍');

        let added = 0;
        let updated = 0;
        let totalChaptersGenerated = 0;
        let totalCoversExtracted = 0;

        for (const file of epubFiles) {
            const title = generateBookTitle(file);

            const filePath = path.join(booksDir, file);
            
            const existingByTitle = await new Promise((resolve) => {
                db.get('SELECT id, file_path FROM books WHERE title = ?', [title], (err, row) => {
                    resolve(row);
                });
            });

            if (existingByTitle && existingByTitle.file_path !== file) {
                console.log('[BOOKS]', new Date().toISOString(), '- 库中已存在相同书名，删除新增文件:', file);
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error('[BOOKS]', new Date().toISOString(), '- 删除重复书籍文件失败:', e.message);
                }
                continue;
            }

            const epubData = parseEpubForChapters(filePath);
            const totalChapters = epubData ? epubData.chapters.length : 0;

            const coverPath = epubData ? await extractCoverImage(file, epubData, outputDir) : null;

            await new Promise((resolve) => {
                db.get('SELECT id, cover_path FROM books WHERE file_path = ?', [file], (err, row) => {
                    if (!row) {
                        db.run('INSERT INTO books (title, file_path, cover_path, total_chapters) VALUES (?, ?, ?, ?)',
                            [title, file, coverPath, totalChapters], function(err) {
                                if (!err) {
                                    added++;
                                    console.log('[BOOKS]', new Date().toISOString(), '- 新增书籍:', title);
                                }
                                resolve();
                            });
                    } else {
                        db.run('UPDATE books SET title = ?, cover_path = ?, total_chapters = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?',
                            [title, coverPath, totalChapters, file], function(err) {
                                if (!err && this.changes > 0) {
                                    updated++;
                                    console.log('[BOOKS]', new Date().toISOString(), '- 更新书籍:', title);
                                }
                                resolve();
                            });
                    }
                });
            });

            if (coverPath) totalCoversExtracted++;

            if (epubData) {
                const bookDir = path.join(outputDir, sanitizeFilename(file.replace('.epub', '')));
                if (!fs.existsSync(bookDir)) {
                    fs.mkdirSync(bookDir, { recursive: true });
                }

                for (const chapter of epubData.chapters) {
                    const result = await generateChapterHtml(file, chapter, epubData, outputDir);
                    if (result) totalChaptersGenerated++;
                }

                await generateBookTocHtml(file, epubData.chapters, outputDir);
            }
        }

        console.log('[BOOKS]', new Date().toISOString(), '- 初始化完成: 新增', added, '本, 更新', updated, '本, 生成', totalChaptersGenerated, '个章节, 提取', totalCoversExtracted, '个封面');
        res.json({
            message: '初始化完成',
            added,
            updated,
            chapters: totalChaptersGenerated,
            covers: totalCoversExtracted
        });
    });
});

app.put('/api/db/books/:id/progress', (req, res) => {
    const { id } = req.params;
    const { current_page, total_chapters } = req.body;

    if (current_page === undefined) {
        return res.status(400).json({ error: '缺少current_page参数' });
    }

    const sql = total_chapters !== undefined
        ? "UPDATE books SET current_page = ?, total_chapters = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        : "UPDATE books SET current_page = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";

    const params = total_chapters !== undefined ? [current_page, total_chapters, id] : [current_page, id];

    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ error: '更新进度失败' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: '书籍不存在' });
        }
        res.json({ message: '更新成功' });
    });
});

app.get('/api/db/books/by-filename', (req, res) => {
    const { filename } = req.query;

    if (!filename) {
        return res.status(400).json({ error: '缺少filename参数' });
    }

    const title = generateBookTitle(filename);

    db.get('SELECT * FROM books WHERE file_path = ?', [filename], (err, row) => {
        if (err) {
            return res.status(500).json({ error: '查询失败' });
        }

        if (row) {
            return res.json(row);
        }

        db.run('INSERT INTO books (title, file_path, cover_path, total_chapters) VALUES (?, ?, NULL, 0)', [title, filename], function(err) {
            if (err) {
                return res.status(500).json({ error: '创建书籍记录失败' });
            }
            res.json({
                id: this.lastID,
                title,
                file_path: filename,
                cover_path: null,
                total_chapters: 0,
                current_page: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        });
    });
});

app.put('/api/db/books/by-filename/progress', (req, res) => {
    const { filename, current_page, total_chapters } = req.body;

    if (!filename || current_page === undefined) {
        return res.status(400).json({ error: '缺少必要参数' });
    }

    const sql = total_chapters !== undefined
        ? "UPDATE books SET current_page = ?, total_chapters = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?"
        : "UPDATE books SET current_page = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?";

    const params = total_chapters !== undefined ? [current_page, total_chapters, filename] : [current_page, filename];

    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ error: '更新进度失败' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: '书籍不存在' });
        }
        res.json({ message: '更新成功' });
    });
});

app.put('/api/db/books/:id/click', (req, res) => {
    const { id } = req.params;

    db.run('UPDATE books SET click_count = click_count + 1 WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('[BOOKS]', new Date().toISOString(), '- 更新点击次数失败:', err.message);
            return res.status(500).json({ error: '更新点击次数失败' });
        }
        console.log('[BOOKS]', new Date().toISOString(), '- 书籍点击次数+1 - ID:', id);
        res.json({ message: '更新成功' });
    });
});

app.post('/api/admin/books/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        console.log('[ADMIN]', new Date().toISOString(), '- 上传书籍失败: 未选择文件');
        return res.status(400).json({ error: '请选择要上传的文件' });
    }

    const filename = req.file.filename;
    console.log('[ADMIN]', new Date().toISOString(), '- 上传文件原始名:', req.file.originalname, '- 保存文件名:', filename);

    if (!filename.toLowerCase().endsWith('.epub')) {
        console.log('[ADMIN]', new Date().toISOString(), '- 上传书籍失败: 不是epub文件 -', filename);
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: '只支持上传epub格式文件' });
    }

    console.log('[ADMIN]', new Date().toISOString(), '- 上传书籍:', filename);

    const filePath = req.file.path;
    const epubData = parseEpubForChapters(filePath);
    const totalChapters = epubData ? epubData.chapters.length : 0;
    const outputDir = path.join(__dirname, 'public', 'generated');
    const coverPath = epubData ? await extractCoverImage(filename, epubData, outputDir) : null;

    const title = generateBookTitle(filename);

    db.get('SELECT id FROM books WHERE file_path = ?', [filename], (err, row) => {
        if (row) {
            db.run('UPDATE books SET title = ?, cover_path = ?, total_chapters = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?',
                [title, coverPath, totalChapters, filename], function(err) {
                    if (err) {
                        console.error('[ADMIN]', new Date().toISOString(), '- 更新上传书籍失败:', err.message);
                        return res.status(500).json({ error: '更新书籍信息失败' });
                    }
                    initBookChapters(filename, epubData, outputDir);
                    console.log('[ADMIN]', new Date().toISOString(), '- 上传并更新书籍成功:', title);
                    res.json({ message: '上传并更新成功', title, chapters: totalChapters, cover: coverPath });
                });
        } else {
            db.run('INSERT INTO books (title, file_path, cover_path, total_chapters) VALUES (?, ?, ?, ?)',
                [title, filename, coverPath, totalChapters], function(err) {
                    if (err) {
                        console.error('[ADMIN]', new Date().toISOString(), '- 新增上传书籍失败:', err.message);
                        return res.status(500).json({ error: '创建书籍记录失败' });
                    }
                    initBookChapters(filename, epubData, outputDir);
                    console.log('[ADMIN]', new Date().toISOString(), '- 上传并新增书籍成功:', title);
                    res.json({ message: '上传并初始化成功', title, chapters: totalChapters, cover: coverPath });
                });
        }
    });
});

app.post('/api/admin/books/:id/init', async (req, res) => {
    const { id } = req.params;

    db.get('SELECT * FROM books WHERE id = ?', [id], async (err, book) => {
        if (err) {
            return res.status(500).json({ error: '查询书籍失败' });
        }
        if (!book) {
            return res.status(404).json({ error: '书籍不存在' });
        }

        const filePath = path.join(__dirname, 'books', book.file_path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'epub文件不存在' });
        }

        const epubData = parseEpubForChapters(filePath);
        if (!epubData) {
            return res.status(500).json({ error: '解析epub失败' });
        }

        const outputDir = path.join(__dirname, 'public', 'generated');
        const bookDir = path.join(outputDir, sanitizeFilename(book.file_path.replace('.epub', '')));
        if (!fs.existsSync(bookDir)) {
            fs.mkdirSync(bookDir, { recursive: true });
        }

        let chaptersGenerated = 0;
        for (const chapter of epubData.chapters) {
            const result = await generateChapterHtml(book.file_path, chapter, epubData, outputDir);
            if (result) chaptersGenerated++;
        }
        await generateBookTocHtml(book.file_path, epubData.chapters, outputDir);

        const coverPath = await extractCoverImage(book.file_path, epubData, outputDir);

        db.run('UPDATE books SET total_chapters = ?, cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [epubData.chapters.length, coverPath, id], (err) => {
                if (err) {
                    console.error('[ADMIN]', new Date().toISOString(), '- 更新书籍信息失败:', err.message);
                }
            });

        console.log('[ADMIN]', new Date().toISOString(), '- 初始化书籍成功:', book.title, '- 生成章节:', chaptersGenerated);
        res.json({ message: '初始化成功', chapters: chaptersGenerated, cover: coverPath });
    });
});

function initBookChapters(filename, epubData, outputDir) {
    if (!epubData) return;

    const bookDir = path.join(outputDir, sanitizeFilename(filename.replace('.epub', '')));
    if (!fs.existsSync(bookDir)) {
        fs.mkdirSync(bookDir, { recursive: true });
    }

    for (const chapter of epubData.chapters) {
        generateChapterHtml(filename, chapter, epubData, outputDir);
    }
    generateBookTocHtml(filename, epubData.chapters, outputDir);
}

app.get('/api/admin/users', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    db.get('SELECT COUNT(*) as total FROM users', (err, countResult) => {
        if (err) {
            return res.status(500).json({ error: '获取用户数量失败' });
        }

        const total = countResult.total;

        db.all('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?', [pageSize, offset], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: '获取用户列表失败' });
            }
            res.json({
                data: rows,
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.ceil(total / pageSize)
                }
            });
        });
    });
});

app.put('/api/admin/users/:id', (req, res) => {
    const { id } = req.params;
    const { is_admin, is_allowed } = req.body;

    const updates = [];
    const params = [];

    if (is_admin !== undefined) {
        updates.push('is_admin = ?');
        params.push(is_admin);
    }
    if (is_allowed !== undefined) {
        updates.push('is_allowed = ?');
        params.push(is_allowed);
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: '没有要更新的字段' });
    }

    params.push(id);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
        if (err) {
            console.error('[ADMIN]', new Date().toISOString(), '- 更新用户失败: 数据库错误 -', err.message);
            return res.status(500).json({ error: '更新用户失败' });
        }
        console.log('[ADMIN]', new Date().toISOString(), '- 更新用户 - ID:', id, '更新字段:', updates.join(', '));
        res.json({ message: '更新成功' });
    });
});

app.delete('/api/admin/books/:id', (req, res) => {
    const { id } = req.params;
    const { file_path } = req.body;

    db.get('SELECT * FROM books WHERE id = ?', [id], (err, book) => {
        if (err) {
            console.error('[ADMIN]', new Date().toISOString(), '- 删除书籍失败: 查询错误 -', err.message);
            return res.status(500).json({ error: '查询书籍失败' });
        }
        if (!book) {
            console.log('[ADMIN]', new Date().toISOString(), '- 删除书籍失败: 书籍不存在 - ID:', id);
            return res.status(404).json({ error: '书籍不存在' });
        }

        const bookDir = path.join(__dirname, 'books', sanitizeFilename(book.file_path));

        const bookgeneratedDir = path.join(__dirname, 'public', 'generated', sanitizeFilename(book.file_path.replace('.epub', '')));

        db.run('DELETE FROM books WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('[ADMIN]', new Date().toISOString(), '- 删除书籍失败: 数据库错误 -', err.message);
                return res.status(500).json({ error: '删除数据库记录失败' });
            }

            if (fs.existsSync(bookDir)) {
                fs.rmSync(bookDir, { recursive: true, force: true });
                console.log('[ADMIN]', new Date().toISOString(), '- 删除书籍成功 - 书籍:', book.title, '文件:', book.file_path);
            } else {
                console.log('[ADMIN]', new Date().toISOString(), '- 删除书籍成功 - 书籍:', book.title, '文件:', bookDir, '(文件目录不存在)');
            }

            if (fs.existsSync(bookgeneratedDir)) {
                fs.rmSync(bookgeneratedDir, { recursive: true, force: true });
                console.log('[ADMIN]', new Date().toISOString(), '- 删除书籍成功 - 书籍:', book.title, '文件:', bookgeneratedDir);
            } else {
                console.log('[ADMIN]', new Date().toISOString(), '- 删除书籍成功 - 书籍:', book.title, '文件:', bookgeneratedDir, '(文件目录不存在)');
            }

            res.json({ message: '删除成功' });
        });
    });
});

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: '用户名长度需在3-20个字符之间' });
    }

    if (password.length < 6 || password.length > 50) {
        return res.status(400).json({ error: '密码长度需在6-50个字符之间' });
    }

    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    stmt.run(username, password, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                console.log('[AUTH]', new Date().toISOString(), '- 注册失败: 用户名已存在 -', username);
                return res.status(409).json({ error: '用户名已存在' });
            }
            console.error('[AUTH]', new Date().toISOString(), '- 注册失败: 数据库错误 -', err.message);
            return res.status(500).json({ error: '注册失败' });
        }
        console.log('[AUTH]', new Date().toISOString(), '- 注册成功 - 用户名:', username, '用户ID:', this.lastID);
        res.json({ message: '注册成功', userId: this.lastID });
    });
    stmt.finalize();
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) {
            console.error('[AUTH]', new Date().toISOString(), '- 登录失败: 数据库错误 -', err.message);
            return res.status(500).json({ error: '登录失败' });
        }
        if (row) {
            if (row.is_allowed === 0) {
                console.log('[AUTH]', new Date().toISOString(), '- 登录被拒绝: 账号已禁用 - 用户名:', username);
                return res.status(403).json({ error: '账号已被禁用' });
            }
            db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
            console.log('[AUTH]', new Date().toISOString(), '- 登录成功 - 用户名:', username, '用户ID:', row.id, '是否为管理员:', row.is_admin ? '是' : '否');
            res.json({ message: '登录成功', user: { id: row.id, username: row.username, is_admin: row.is_admin } });
        } else {
            console.log('[AUTH]', new Date().toISOString(), '- 登录失败: 用户名或密码错误 - 用户名:', username);
            res.status(401).json({ error: '用户名或密码错误' });
        }
    });
});

app.post('/api/reading-history', (req, res) => {
    const { user_id, book_id, current_page } = req.body;

    if (!user_id || !book_id || current_page === undefined) {
        return res.status(400).json({ error: '缺少必要参数' });
    }

    db.run(`INSERT INTO reading_history (user_id, book_id, current_page)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, book_id) DO UPDATE SET
            current_page = excluded.current_page,
            updated_at = CURRENT_TIMESTAMP`,
        [user_id, book_id, current_page],
        function(err) {
            if (err) {
                return res.status(500).json({ error: '保存阅读历史失败' });
            }
            res.json({ message: '保存成功' });
        }
    );
});

app.get('/api/reading-history/:user_id', (req, res) => {
    const user_id = req.params.user_id;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    db.get('SELECT COUNT(*) as total FROM reading_history WHERE user_id = ?', [user_id], (err, countResult) => {
        if (err) {
            return res.status(500).json({ error: '获取阅读历史失败' });
        }

        const total = countResult.total;

        db.all(`SELECT rh.*, b.title, b.cover_path, b.total_chapters, b.file_path
                FROM reading_history rh
                JOIN books b ON rh.book_id = b.id
                WHERE rh.user_id = ?
                ORDER BY rh.updated_at DESC
                LIMIT ? OFFSET ?`, [user_id, pageSize, offset], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: '获取阅读历史失败' });
            }
            res.json({
                data: rows,
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.ceil(total / pageSize)
                }
            });
        });
    });
});

app.get('/api/reading-history/:user_id/:book_id', (req, res) => {
    const user_id = req.params.user_id;
    const book_id = req.params.book_id;

    db.get(`SELECT * FROM reading_history WHERE user_id = ? AND book_id = ?`, [user_id, book_id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: '获取阅读历史失败' });
        }
        res.json(row || null);
    });
});

app.listen(PORT, () => {
    console.log('[SERVER]', new Date().toISOString(), `- 服务启动成功，监听端口 ${PORT}`);
    console.log('[SERVER]', new Date().toISOString(), `- 书籍目录: ${path.join(__dirname, 'books')}`);
    console.log('[SERVER]', new Date().toISOString(), `- 数据目录: ${path.join(__dirname, 'data')}`);
});