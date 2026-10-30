/**
 * ==============================================================================
 * 『くねくねバトル オンライン』Phase 2: メインオーケストレーター (main.js)
 * ・input.js: 2本指ピンチズーム連動 ＆ BOOST誤爆根絶
 * ・audio.js: Web Audio API音響（小餌/大餌/加速ハム音）
 * ・hud.js: Canvas直接描画ミニマップ ＆ ランキング
 * ==============================================================================
 */

import { injectStyles } from './style.js';
injectStyles();

import { mountDOM } from './dom.js';
mountDOM();

import {
    MAP_SIZE,
    GRID_SIZE,
    BASE_SPEED,
    BOOST_SPEED_MULT,
    TURN_SPEED_PLAYER,
    SAFE_INSET_TOP_GRAVITY,
    SAFE_INSET_TOP_WEB,
    SNAKE_COLORS,
    FOOD_COLORS
} from './constants.js';

import { Sound } from './audio.js';
import { InputManager } from './input.js';
import { HUDManager } from './hud.js';

// --- プラットフォーム環境検知 ---
export const PlatformDetector = {
    inGravity: false,
    hasAgentSDK: false,
    check() {
        this.hasAgentSDK = typeof window.AgentSDK !== 'undefined';
        this.inGravity = this.hasAgentSDK || (window.parent && window.parent !== window) || /gravity/i.test(navigator.userAgent);
    }
};
PlatformDetector.check();

// --- 画面リサイズとセーフエリア管理 ---
function updateLayout() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const root = document.documentElement;
    if (PlatformDetector.inGravity) {
        root.style.setProperty('--safe-top', `${SAFE_INSET_TOP_GRAVITY}px`);
        root.style.setProperty('--safe-bottom', '24px');
    } else {
        root.style.setProperty('--safe-top', `${SAFE_INSET_TOP_WEB}px`);
        root.style.setProperty('--safe-bottom', '20px');
    }
}
window.addEventListener('resize', updateLayout);
updateLayout();

// --- iOS WebKit ピンチズーム＆バウンスのブラウザデフォルト挙動を遮断 ---
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

// --- モジュール初期化 ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d', { alpha: false });

const input = new InputManager();
input.init(canvas, (isBoosting) => {
    if (isBoosting) {
        Sound.startBoostSound();
    } else {
        Sound.stopBoostSound();
    }
});

const hud = new HUDManager();
hud.init();

// --- サウンドボタンのイベントバインド（左下） ---
const soundBtn = document.getElementById('btn-sound');
if (soundBtn) {
    soundBtn.onclick = (e) => {
        e.stopPropagation();
        const isMuted = Sound.toggleMute();
        soundBtn.classList.toggle('sound-on', !isMuted);
        const iconOff = document.getElementById('icon-sound-off');
        const iconOn = document.getElementById('icon-sound-on');
        if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
        if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
    };
}

// --- 餌（Food）の初期生成 ---
const foods = [];
for (let i = 0; i < 400; i++) {
    foods.push({
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        size: Math.random() < 0.08 ? 8 : 3.5,
        isBig: Math.random() < 0.08,
        color: FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)]
    });
}

// --- スネークエンティティ ---
class SnakeEntity {
    constructor(isPlayer, name, color) {
        this.isPlayer = isPlayer;
        this.name = name;
        this.color = color;
        this.x = MAP_SIZE / 2;
        this.y = MAP_SIZE / 2;
        this.angle = 0;
        this.targetAngle = 0;
        this.speed = BASE_SPEED;
        this.score = 50;
        this.size = 14;
        this.targetLength = 16;
        this.history = [];
        this.distCounter = 0;
        this.isDead = false;
    }

    update() {
        if (this.isPlayer) {
            if (input.active && (input.x !== 0 || input.y !== 0)) {
                this.targetAngle = Math.atan2(input.y, input.x);
            }
            this.speed = input.boost ? BASE_SPEED * BOOST_SPEED_MULT : BASE_SPEED;

            // ブースト消費（少しずつ体を消費）
            if (input.boost && this.score > 60) {
                this.score -= 0.08;
                this.size = Math.max(12, 12 + Math.pow(this.score, 0.45) * 0.35);
                this.targetLength = Math.max(10, 10 + Math.floor(Math.pow(this.score, 0.55) * 0.4));
            }
        }

        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED_PLAYER);

        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        // 壁の衝突リミッター
        this.x = Math.max(this.size, Math.min(MAP_SIZE - this.size, this.x));
        this.y = Math.max(this.size, Math.min(MAP_SIZE - this.size, this.y));

        this.distCounter += this.speed;
        if (this.distCounter > this.size * 0.55) {
            this.history.unshift({ x: this.x, y: this.y });
            this.distCounter = 0;
            while (this.history.length > this.targetLength) {
                this.history.pop();
            }
        }

        // 餌の捕食判定
        if (this.isPlayer) {
            for (let i = foods.length - 1; i >= 0; i--) {
                const f = foods[i];
                const dx = this.x - f.x;
                const dy = this.y - f.y;
                if (dx * dx + dy * dy < (this.size + f.size) ** 2) {
                    if (f.isBig) {
                        this.score += 25;
                        Sound.playEatBig();
                    } else {
                        this.score += 5;
                        Sound.playEatSmall();
                    }
                    this.size = 12 + Math.pow(this.score, 0.45) * 0.35;
                    this.targetLength = 10 + Math.floor(Math.pow(this.score, 0.55) * 0.4);

                    // 餌のリスポーン
                    f.x = this.x + (Math.random() - 0.5) * 3000;
                    f.y = this.y + (Math.random() - 0.5) * 3000;
                    f.x = Math.max(100, Math.min(MAP_SIZE - 100, f.x));
                    f.y = Math.max(100, Math.min(MAP_SIZE - 100, f.y));
                }
            }
        }
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        for (let i = this.history.length - 1; i >= 0; i--) {
            const pt = this.history[i];
            const scale = 1 - (i / this.history.length) * 0.45;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, this.size * scale, 0, Math.PI * 2);
            ctx.fill();
        }

        // 頭部
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();

        // 目
        const eyeR = this.size * 0.35;
        const eyeX = this.size * 0.3;
        const eyeY = this.size * 0.4;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#000000';
        ctx.beginPath(); ctx.arc(eyeX + 2, -eyeY, eyeR * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(eyeX + 2, eyeY, eyeR * 0.5, 0, Math.PI * 2); ctx.fill();

        ctx.restore();

        // ネームプレート
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - this.size - 6);
    }
}

const player = new SnakeEntity(true, 'あなた', SNAKE_COLORS[0]);

// --- メインループ ---
let cameraScale = 1.0;

function gameLoop() {
    requestAnimationFrame(gameLoop);

    player.update();
    hud.updateStats(1, 50, player.score);

    // ピンチズームと自機サイズに応じた動的カメラズームの合成
    const baseTargetScale = 60.0 / (60.0 + (player.size - 12) * 0.85);
    const finalTargetScale = baseTargetScale * input.zoomMultiplier;
    cameraScale += (finalTargetScale - cameraScale) * 0.05;

    ctx.fillStyle = '#0b051a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // カメラの中心をプレイヤーに合わせ、ピンチズーム倍率を適用
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(cameraScale, cameraScale);
    ctx.translate(-player.x, -player.y);

    // グリッド線描画
    const step = 150;
    const viewW = canvas.width / cameraScale;
    const viewH = canvas.height / cameraScale;
    const startX = Math.floor((player.x - viewW / 2) / step) * step;
    const endX = startX + viewW + step * 2;
    const startY = Math.floor((player.y - viewH / 2) / step) * step;
    const endY = startY + viewH + step * 2;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x < endX; x += step) {
        ctx.moveTo(x, startY); ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += step) {
        ctx.moveTo(startX, y); ctx.lineTo(endX, y);
    }
    ctx.stroke();

    // 餌の描画
    for (let f of foods) {
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fill();
    }

    // プレイヤー描画
    player.draw(ctx);
    ctx.restore();

    // 一体型HUDミニマップ描画（右上に直接描画）
    const safeTop = PlatformDetector.inGravity ? SAFE_INSET_TOP_GRAVITY : SAFE_INSET_TOP_WEB;
    hud.drawRadar(ctx, canvas.width, safeTop, player, [], MAP_SIZE);
}

requestAnimationFrame(gameLoop);