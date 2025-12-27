// 刘德华解冻动画
const {ipcRenderer} = require('electron');

// 尝试加载配置文件
let UNFREEZE_START_TIME = '2025-12-29 00:00:00';
let UNFREEZE_END_TIME = '2026-01-01 00:00:00';

let startLayer = null;
let animationFrame = null;

function parseTime(timeString) {
    return new Date(timeString).getTime();
}

function getUnfreezeProgress() {
    const now = Date.now();
    const startTime = parseTime(UNFREEZE_START_TIME);
    const endTime = parseTime(UNFREEZE_END_TIME);

    if (now < startTime) {
        return 0; // 还没开始，完全显示 start
    } else if (now >= endTime) {
        return 1; // 已结束，完全隐藏 start
    } else {
        // 计算进度 0-1
        return (now - startTime) / (endTime - startTime);
    }
}

function updateAnimation() {
    const progress = getUnfreezeProgress();

    // 从上到下逐渐隐藏：使用 clip-path
    // 当 progress = 0 时，显示全部（clip-path: inset(0 0 0 0)）
    // 当 progress = 1 时，完全隐藏（clip-path: inset(100% 0 0 0)）
    const clipValue = progress * 100;
    startLayer.style.clipPath = `inset(${clipValue}% 0 0 0)`;

    animationFrame = requestAnimationFrame(updateAnimation);
}

// 初始化
function init() {
    startLayer = document.getElementById('startLayer');

    if (!startLayer) {
        console.error('[Unfreeze] startLayer not found');
        return;
    }

    // 开始动画循环
    updateAnimation();

    console.log('[Unfreeze] Animation started');
    console.log('[Unfreeze] Start time:', UNFREEZE_START_TIME);
    console.log('[Unfreeze] End time:', UNFREEZE_END_TIME);
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', init);

// 监听来自主进程的配置更新
ipcRenderer.on('update-unfreeze-config', (e, config) => {
    if (config.startTime) {
        // 更新开始时间（需要重新加载页面或更新全局变量）
        console.log('[Unfreeze] Config updated:', config);
    }
});
