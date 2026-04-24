async function initHeader() {
    try {
        const response = await fetch('/header.html');
        const data = await response.text();
        document.getElementById('header').innerHTML = data;

        const user = getCurrentUser();
        const headerUser = document.getElementById('header-user');
        const btnInit = document.getElementById('btn-init');
        const btnAdmin = document.getElementById('btn-admin');

        if (btnInit) {
            btnInit.style.display = (user && user.is_admin === 1) ? '' : 'none';
            btnInit.addEventListener('click', initBooks);
        }
        if (btnAdmin) {
            btnAdmin.style.display = (user && user.is_admin === 1) ? '' : 'none';
        }

        if (user) {
            headerUser.innerHTML = `
                <span class="welcome-msg">欢迎 <a href="/history.html" style="color: #007bff; font-weight: 500; text-decoration: none;">${user.username}</a></span>
                <button class="header-btn btn-logout" id="btn-logout">退出</button>
            `;
            document.getElementById('btn-logout').addEventListener('click', logout);
        }
    } catch (err) {
        console.error('加载头部失败:', err);
    }
}

function getCurrentUser() {
    const userStr = localStorage.getItem('currentUser');
    return userStr ? JSON.parse(userStr) : null;
}

function logout() {
    localStorage.removeItem('currentUser');
    alert('已退出登录');
    location.reload();
}

async function initBooks() {
    try {
        const response = await fetch('/api/db/books/init', { method: 'POST' });
        const result = await response.json();
        alert(result.message);
        document.getElementById('warning-banner').style.display = 'none';
        location.reload();
    } catch (err) {
        alert('初始化失败');
    }
}