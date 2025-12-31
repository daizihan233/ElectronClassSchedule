// 刘德华解冻动画
const {ipcRenderer} = require('electron');

// 时间配置
let UNFREEZE_START_TIME = '2025-12-29 00:00:00';
let UNFREEZE_END_TIME = '2025-12-31 13:00:00';

// 音量配置
const VOLUME_MIN = 0;    // 最小音量（0%）
const VOLUME_MAX = 0.5;  // 最大音量（50%）
const VIDEO_VOLUME = 1.0; // 视频音量（100%）

let startLayer = null;
let endLayer = null;
let animationFrame = null;

// 音频播放相关
let audio = null;
let isPlaying = false;

// 视频播放相关
let video = null;
let isVideoPlaying = false;
let hasUnfreezeCompleted = false;  // 是否已经完成解冻（用于检测解冻完成事件）

function parseTime(timeString) {
    return new Date(timeString).getTime();
}

// 显示所有图片层
function showImageLayers() {
    if (startLayer) startLayer.style.display = 'block';
    if (endLayer) endLayer.style.display = 'block';
}

// 隐藏所有图片层
function hideImageLayers() {
    if (startLayer) startLayer.style.display = 'none';
    if (endLayer) endLayer.style.display = 'none';
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

function updateCountdown() {
    const now = Date.now();
    const endTime = parseTime(UNFREEZE_END_TIME);
    const countdownEl = document.getElementById('countdown');

    if (!countdownEl) return;

    const remaining = endTime - now;

    if (remaining <= 0) {
        countdownEl.style.display = 'none';
        return;
    }

    const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

    // 获取解冻进度百分比（向下取整）
    const progress = getUnfreezeProgress();
    const progressPercent = Math.floor(progress * 100);

    let timeText = '';
    if (days > 0) {
        timeText = `${days}天${hours}时${minutes}分`;
    } else if (hours > 0) {
        timeText = `${hours}时${minutes}分${seconds}秒`;
    } else {
        timeText = `${minutes}分${seconds}秒`;
    }

    countdownEl.textContent = `${timeText} ${progressPercent}%`;
}

function updateAnimation() {
    const progress = getUnfreezeProgress();

    // 从上到下逐渐隐藏：使用 clip-path
    // 当 progress = 0 时，显示全部（clip-path: inset(0 0 0 0)）
    // 当 progress = 1 时，完全隐藏（clip-path: inset(100% 0 0 0)）
    const clipValue = progress * 100;
    startLayer.style.clipPath = `inset(${clipValue}% 0 0 0)`;

    updateCountdown();

    // 根据解冻进度调整音量
    if (audio && isPlaying && progress < 1) {
        audio.volume = VOLUME_MIN + (VOLUME_MAX - VOLUME_MIN) * progress;
    }

    // 检测解冻完成事件
    if (progress >= 1 && !hasUnfreezeCompleted) {
        hasUnfreezeCompleted = true;
        onUnfreezeComplete();
    }

    animationFrame = requestAnimationFrame(updateAnimation);
}

// 初始化音频
function initAudio() {
    audio = new Audio('audio/恭喜发财.mp3');
    audio.loop = true; // 循环播放
    audio.volume = VOLUME_MIN;  // 初始音量
}

// 初始化视频
function initVideo() {
    video = document.getElementById('videoLayer');
}

// 解冻完成处理
function onUnfreezeComplete() {
    console.log('[Unfreeze] Unfreeze complete, switching to video');

    // 停止音频播放
    if (audio && isPlaying) {
        audio.pause();
        audio.currentTime = 0;
        isPlaying = false;
    }

    // 播放视频
    if (video) {
        video.play();
        video.volume = VIDEO_VOLUME;
        isVideoPlaying = true;
        video.classList.add('active');

        // 隐藏图片
        hideImageLayers();
    }

    // 隐藏倒计时
    const countdownEl = document.getElementById('countdown');
    if (countdownEl) {
        countdownEl.style.display = 'none';
    }
}

// 处理图片点击
function handleImageClick(event) {
    console.log('[Unfreeze] handleImageClick, progress:', getUnfreezeProgress(), 'isPlaying:', isPlaying);

    // 切换播放/暂停状态
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
        console.log('[Unfreeze] Audio paused');
    } else {
        audio.play();
        isPlaying = true;
        console.log('[Unfreeze] Audio played');
    }
}

// 处理视频点击
function handleVideoClick(event) {
    console.log('[Unfreeze] Video clicked, isVideoPlaying:', isVideoPlaying);

    if (isVideoPlaying) {
        // 暂停视频，切换回图片
        video.pause();
        isVideoPlaying = false;
        video.classList.remove('active');

        // 显示图片
        showImageLayers();

        console.log('[Unfreeze] Video paused');
    } else {
        // 播放视频
        video.play();
        video.volume = VIDEO_VOLUME;
        isVideoPlaying = true;
        video.classList.add('active');

        // 隐藏图片
        hideImageLayers();

        console.log('[Unfreeze] Video played');
    }
}

// 初始化
function init() {
    startLayer = document.getElementById('startLayer');
    endLayer = document.querySelector('.end-layer');

    if (!startLayer) {
        console.error('[Unfreeze] startLayer not found');
        return;
    }

    // 初始化音频
    initAudio();

    // 初始化视频
    initVideo();

    // 为容器添加点击事件监听
    const container = document.querySelector('.container');
    if (container) {
        container.addEventListener('click', (event) => {
            const progress = getUnfreezeProgress();

            if (progress >= 1) {
                // 解冻完成后，处理视频点击
                handleVideoClick(event);
            } else {
                // 解冻未完成，处理图片点击
                handleImageClick(event);
            }
        });
        container.style.cursor = 'pointer';  // 显示手型光标
    }

    // 检查程序启动时是否已经超过解冻时间
    const progress = getUnfreezeProgress();
    if (progress >= 1) {
        console.log('[Unfreeze] Already completed at startup, showing paused state');
        hasUnfreezeCompleted = true;

        // 隐藏倒计时
        const countdownEl = document.getElementById('countdown');
        if (countdownEl) {
            countdownEl.style.display = 'none';
        }

        // 完全隐藏 startLayer（解冻开始的图片）
        startLayer.style.clipPath = 'inset(100% 0 0 0)';
        // 显示图片（解冻结束的图片会自动显示，因为 startLayer 被隐藏了）
        showImageLayers();
    } else {
        // 开始动画循环
        updateAnimation();
    }

    console.log('[Unfreeze] Animation started');
    console.log('[Unfreeze] Start time:', UNFREEZE_START_TIME);
    console.log('[Unfreeze] End time:', UNFREEZE_END_TIME);
}

// 页面加载完成后初始化
globalThis.addEventListener('DOMContentLoaded', init);

// 监听来自主进程的配置更新
ipcRenderer.on('update-unfreeze-config', (e, config) => {
    if (config.startTime) {
        // 更新开始时间（需要重新加载页面或更新全局变量）
        console.log('[Unfreeze] Config updated:', config);
    }
});
