/**
 * ==============================================================================
 * 『くねくねバトル オンライン』Phase 1: メインオーケストレーター (main.js)
 * 厳密な実行順序：スタイル注入 -> DOM自律生成 -> Canvas取得 -> スネーク起動
 * ==============================================================================
 */

// Step 1: スタイルを動的注入（CSSを確実に先行適用）
import { injectStyles } from './style.js';
injectStyles();

// Step 2: DOMを自律生成（Canvas・HUD・右下ボタンを一瞬で展開）
import { mountDOM } from './dom.js';
mountDOM();

import {
    MAP_SIZE,
    BASE_SPEED,
    BOOST_SPEED_MULT,
    TURN_SPEED_PLAYER,
    SAFE_INSET_TOP_GRAVITY,
    SAFE_INSET_TOP_WEB,
    SNAKE_COLORS
} from './constants.js';

// --- プラットフォーム環境検知 (GRAVITY実機 vs Webプレビュー) ---
export const PlatformDetector = {
    inGravity: false,
    hasAgentSDK: false,
    check() {
        this.hasAgentSDK = typeof window.AgentSDK !== 'undefined';
        this.inGravity = this.hasAgentSDK || (window.parent && window.parent !== window) || /gravity/i.test(navigator.userAgent);
        console.log(`[PlatformDetector] inGravity: ${this.inGravity}, hasAgentSDK: ${this.hasAgentSDK}`);
    }
};
PlatformDetector.check();

// --- セーフエリア動的適応 ---
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

// --- iOS WebKit ピンチズーム＆オーバースクロール完全遮断 ---
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
window.addEventListener('touchmove', (e) => {
    if (e.scale !== 1) e.preventDefault();
}, { passive: false });

// --- サウンド管理（初期MUTE・Web Audio API基盤） ---
const SoundManager = {
    isMuted: true,
    ctx: null,
    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) this.ctx = new AudioContext();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },
    toggle() {
        this.init();
        this.isMuted = !this.isMuted;
        const btn = document.getElementById('btn-sound');
        const iconOff = document.getElementById('icon-sound-off');
        const iconOn = document.getElementById('icon-sound-on');

        if (this.isMuted) {
            btn.classList.remove('sound-on');
            iconOff.style.display = 'block';
            iconOn.style.display = 'none';
        } else {
            btn.classList.add('sound-on');
            iconOff.style.display = 'none';
            iconOn.style.display = 'block';
            this.playTone(587.33, 0.08); // 起動音
        }
    },
    playTone(freq, duration) {
        if (this.isMuted || !this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {}
    }
};

const soundBtn = document.getElementById('btn-sound');
if (soundBtn) {
    soundBtn.onclick = (e) => {
        e.stopPropagation();
        SoundManager.toggle();
    };
}

// --- 入力制御（ジョイスティック ＆ 右手ブースト） ---
const InputController = {
    x: 0,
    y: 0,
    active: false,
    boost: false,
    touchId: null,
    baseEl: null,
    knobEl: null,
    center: { x: 0, y: 0 },
    maxRadius: 28,

    init() {
        this.baseEl = document.getElementById('joystick-base');
        this.knobEl = document.getElementById('joystick-knob');
        const canvas = document.getElementById('game-canvas');
        if (!canvas) return;

        canvas.addEventListener('touchstart', (e) => this.handleStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this.handleMove(e), { passive: false });
        canvas.addEventListener('touchend', (e) => this.handleEnd(e), { passive: false });
        canvas.addEventListener('touchcancel', (e) => this.handleEnd(e), { passive: false });

        let mouseDown = false;
        canvas.addEventListener('mousedown', (e) => {
            mouseDown = true;
            this.startJoystick(e.clientX, e.clientY);
        });
        window.addEventListener('mousemove', (e) => {
            if (mouseDown) this.moveJoystick(e.clientX, e.clientY);
        });
        window.addEventListener('mouseup', () => {
            if (mouseDown) {
                mouseDown = false;
                this.endJoystick();
            }
        });

        const boostBtn = document.getElementById('btn-boost');
        if (boostBtn) {
            const setBoost = (on) => {
                this.boost = on;
                boostBtn.classList.toggle('active', on);
            };
            boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); setBoost(true); }, { passive: false });
            boostBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); setBoost(false); }, { passive: false });
            boostBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); e.stopPropagation(); setBoost(false); }, { passive: false });
            boostBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); setBoost(true); });
            window.addEventListener('mouseup', () => setBoost(false));
        }
    },

    handleStart(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.clientX > window.innerWidth * 0.55 && !this.boost) {
                this.boost = true;
                const b = document.getElementById('btn-boost');
                if (b) b.classList.add('active');
            } else if (!this.active) {
                this.touchId = t.identifier;
                this.startJoystick(t.clientX, t.clientY);
            }
        }
    },

    handleMove(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === this.touchId) {
                this.moveJoystick(t.clientX, t.clientY);
            }
        }
    },

    handleEnd(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === this.touchId) {
                this.endJoystick();
            }
            if (t.clientX > window.innerWidth * 0.55) {
                this.boost = false;
                const b = document.getElementById('btn-boost');
                if (b) b.classList.remove('active');
            }
        }
    },

    startJoystick(x, y) {
        this.active = true;
        this.center = { x, y };
        if (this.baseEl) {
            this.baseEl.style.display = 'block';
            this.baseEl.style.left = `${x}px`;
            this.baseEl.style.top = `${y}px`;
        }
        if (this.knobEl) {
            this.knobEl.style.transform = 'translate(-50%, -50%)';
        }
        this.x = 0;
        this.y = 0;
    },

    moveJoystick(cx, cy) {
        let dx = cx - this.center.x;
        let dy = cy - this.center.y;
        const dist = Math.hypot(dx, dy);
        if (dist > this.maxRadius) {
            dx = (dx / dist) * this.maxRadius;
            dy = (dy / dist) * this.maxRadius;
        }
        if (this.knobEl) {
            this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }
        this.x = dx;
        this.y = dy;
    },

    endJoystick() {
        this.active = false;
        this.touchId = null;
        if (this.baseEl) this.baseEl.style.display = 'none';
        this.x = 0;
        this.y = 0;
    }
};
InputController.init();

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
    }

    update() {
        if (this.isPlayer) {
            if (InputController.active && (InputController.x !== 0 || InputController.y !== 0)) {
                this.targetAngle = Math.atan2(InputController.y, InputController.x);
            }
            this.speed = InputController.boost ? BASE_SPEED * BOOST_SPEED_MULT : BASE_SPEED;
        }

        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED_PLAYER);

        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        this.distCounter += this.speed;
        if (this.distCounter > this.size * 0.55) {
            this.history.unshift({ x: this.x, y: this.y });
            this.distCounter = 0;
            while (this.history.length > this.targetLength) {
                this.history.pop();
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

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();

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

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - this.size - 6);
    }
}

// --- メイン描画ループ ---
const player = new SnakeEntity(true, 'あなた', SNAKE_COLORS[0]);
let showRadar = true;

const btnRank = document.getElementById('btn-rank');
const statsBox = document.getElementById('stats-box');
if (btnRank && statsBox) {
    btnRank.onclick = (e) => {
        e.stopPropagation();
        statsBox.style.display = statsBox.style.display === 'none' ? 'block' : 'none';
    };
}

const btnMap = document.getElementById('btn-map');
if (btnMap) {
    btnMap.onclick = (e) => {
        e.stopPropagation();
        showRadar = !showRadar;
        btnMap.innerText = showRadar ? 'MAP: ON' : 'MAP: OFF';
    };
}

const canvas = document.getElementById('game-canvas');
const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;

function gameLoop() {
    requestAnimationFrame(gameLoop);
    if (!ctx || !canvas) return;

    player.update();

    ctx.fillStyle = '#0b051a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2 - player.x, canvas.height / 2 - player.y);

    // グリッド線描画
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const step = 150;
    const startX = Math.floor((player.x - canvas.width) / step) * step;
    const endX = startX + canvas.width * 2;
    const startY = Math.floor((player.y - canvas.height) / step) * step;
    const endY = startY + canvas.height * 2;

    ctx.beginPath();
    for (let x = startX; x < endX; x += step) {
        ctx.moveTo(x, startY); ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += step) {
        ctx.moveTo(startX, y); ctx.lineTo(endX, y);
    }
    ctx.stroke();

    player.draw(ctx);
    ctx.restore();

    // 一体型Canvasミニマップ（右上に直接描画）
    if (showRadar) {
        const radarSize = 75;
        const margin = 16;
        const rx = canvas.width - radarSize - margin;
        const ry = PlatformDetector.inGravity ? SAFE_INSET_TOP_GRAVITY : SAFE_INSET_TOP_WEB;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fillRect(rx, ry, radarSize, radarSize);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, radarSize, radarSize);

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(rx + radarSize / 2, ry + radarSize / 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

requestAnimationFrame(gameLoop);