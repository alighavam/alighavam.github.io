const AUTH_KEY = 'labCameraAuth';

function getConfig() {
    if (!window.CAMERA_CONFIG) {
        throw new Error('Missing camera-config.js — copy camera-config.example.js first.');
    }
    return window.CAMERA_CONFIG;
}

async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function buildStreamUrl(config) {
    const base = config.streamBaseUrl.replace(/\/$/, '');
    const token = encodeURIComponent(config.streamToken);
    return `${base}/stream?token=${token}`;
}

function showLogin() {
    document.getElementById('camera-login').hidden = false;
    document.getElementById('camera-viewer').classList.remove('is-active');
    sessionStorage.removeItem(AUTH_KEY);
}

function showViewer(streamUrl) {
    document.getElementById('camera-login').hidden = true;
    const viewer = document.getElementById('camera-viewer');
    const stream = document.getElementById('camera-stream');
    const status = document.getElementById('stream-status');

    viewer.classList.add('is-active');
    status.textContent = 'Connecting to live stream...';

    stream.onload = () => {
        status.textContent = 'Live';
    };
    stream.onerror = () => {
        status.textContent = 'Stream unavailable — check ESP32, WiFi, and Cloudflare tunnel.';
    };

    stream.src = streamUrl;
}

async function initCameraPage() {
    const loginForm = document.getElementById('login-form');
    const errorEl = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');
    const reloadBtn = document.getElementById('reload-stream-btn');

    let config;
    try {
        config = getConfig();
    } catch (err) {
        errorEl.textContent = err.message;
        loginForm.querySelector('button').disabled = true;
        return;
    }

    const streamUrl = buildStreamUrl(config);

    if (sessionStorage.getItem(AUTH_KEY) === '1') {
        showViewer(streamUrl);
    }

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorEl.textContent = '';

        const password = document.getElementById('viewer-password').value;
        const hash = await sha256Hex(password);

        if (hash === config.viewerPasswordHash) {
            sessionStorage.setItem(AUTH_KEY, '1');
            showViewer(streamUrl);
            return;
        }

        errorEl.textContent = 'Incorrect password.';
    });

    logoutBtn.addEventListener('click', () => {
        document.getElementById('camera-stream').src = '';
        showLogin();
    });

    reloadBtn.addEventListener('click', () => {
        const stream = document.getElementById('camera-stream');
        stream.src = '';
        setTimeout(() => {
            stream.src = streamUrl;
        }, 100);
    });
}

document.addEventListener('DOMContentLoaded', initCameraPage);
