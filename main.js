// ==============================================================================
// 『くねくねバトル オンライン』Phase 5 マスター統合オーケストレーター (main.js)
// v21.2.0 撃破肉片クラスタ同期＆ゲーム開始完全結合版:
// ・スネーク撃破時の大量肉片クラスタ同期（queueDropCluster）完全接続
// ・setupNetworkHandlers への initGame 確実引き渡し（待機室一斉始動）
// ・招待URL（DMリンク）検知時の先行待機室起動（画面フリーズ・無反応を完全解消）
// ・net_handlers.js によるリモートパケット処理の完全外注化
// ・net_lobby_hooks.js との連携による連打クラッシュ防止
// ・画面回転（resize）時の100ms遅延二重計測ガード
// ・自律生態系AI連携用ワールドインスタンス参照バインド
// ・二重ループ起動防止 (animFrameId) ＆ EntryShield 通信ロック
// ==============================================================================

import { injectStyles } from './style.js';
injectStyles();

import { mountDOM, EntryShield, updateLobbyGreeting } from './dom.js';
mountDOM();

import {
    MAP_SIZE,
    TOTAL_SNAKES,
    MAX_AIS,
    SAFE_INSET_TOP_GRAVITY,
    SAFE_INSET_TOP_WEB,
    SNAKE_COLORS
} from './constants.js';

import { Sound } from './audio.js';
import { InputManager } from './input.js';
import { HUDManager } from './hud.js';
import { Danmaku } from './danmaku.js';
import { Menu } from './menu.js';

import { Snake } from './snake.js';
import { SpatialCollisionEngine } from './combat.js';
import { WorldManager } from './world.js';
import { AIManager } from './ai.js';
import { NetworkManager } from './network.js';
import { initUIBindings, updateZoomButtonsState } from './ui_binder.js';
import { setupNetworkHandlers } from './net_handlers.js';
import './net_lobby_hooks.js';

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

// 画面回転・リサイズ時の二重計測ガード（iOS WebView対策）
let resizeDebounceTimer = null;
window.addEventListener('resize', () => {
    updateLayout();
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
        updateLayout();
    }, 100);
});
updateLayout();

document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d', { alpha: false });

const input = new InputManager();
input.init(canvas, (isBoosting) => {
    if (isBoosting) Sound.startBoostSound();
    else Sound.stopBoostSound();
});

const hud = new HUDManager();
hud.init();

Danmaku.init();

const collisionEngine = new SpatialCollisionEngine();
const world = new WorldManager();
const aiManager = new AIManager();

// 自律生態系AIが肉片ドロップ（ハイエナモード）を検知するためのグローバル参照
window.currentWorldInstance = world;

let player = new Snake(true, 0, 'あなた', SNAKE_COLORS[0], 'normal');
let remoteSnakes = new Map();
let allSnakes = [];
let sortedSnakes = [];

let gameState = 'lobby'; 
let gameStartTime = Date.now();
let frameCount = 0;
let cameraScale = 1.0;
let animFrameId = null; // 二重ループ防止用
let lastFrameTime = Date.now(); // DeltaTime計算用

window.localPlayerInstance = player;
window.allAISnakesInstance = aiManager.ais;

export const UIController = {
    showLobby() {
        gameState = 'lobby';
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const over = document.getElementById('over-screen');
        const stats = document.getElementById('stats-box');

        if (lobby) lobby.style.display = 'flex';
        if (waiting) waiting.style.display = 'none';
        if (over) over.style.display = 'none';
        if (stats) stats.style.display = 'none';
        this.refreshLobbyGreeting();
    },

    showWaitingRoom(roomId) {
        gameState = 'waiting';
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const over = document.getElementById('over-screen');
        const tag = document.getElementById('waiting-room-tag');
        const startBtn = document.getElementById('btn-waiting-start');

        if (lobby) lobby.style.display = 'none';
        if (waiting) waiting.style.display = 'flex';
        if (over) over.style.display = 'none';
        if (tag) tag.innerText = `ROOM #${String(roomId).slice(-5)}`;
        if (startBtn) startBtn.style.display = NetworkManager.isHost ? 'block' : 'none';
        this.updateWaitingMembersList();
    },

    showGame() {
        gameState = 'playing';
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const over = document.getElementById('over-screen');

        if (lobby) lobby.style.display = 'none';
        if (waiting) waiting.style.display = 'none';
        if (over) over.style.display = 'none';
    },

    refreshLobbyGreeting() {
        const resolvedName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
            ? window.GRAVITY_USER_NAME
            : (NetworkManager.myUser && NetworkManager.myUser.name !== 'あなた' ? NetworkManager.myUser.name : '');
        
        if (resolvedName) {
            updateLobbyGreeting(resolvedName);
            if (player) {
                player.name = resolvedName;
            }
        }
    },

    updateWaitingMembersList() {
        const listEl = document.getElementById('waiting-members-list');
        if (!listEl) return;
        listEl.innerHTML = NetworkManager.slots.slice(0, 4).map(s => {
            const isMe = s.slot === NetworkManager.mySlot;
            const isHost = s.slot === 0;
            const badgeText = isMe ? 'YOU' : (s.isAI ? 'CPU' : `P${s.slot + 1}`);
            return `
                <div class="waiting-slot">
                    <div class="waiting-slot-left">
                        <div class="waiting-slot-badge" style="background-color: ${s.color};">${badgeText}</div>
                        <div class="waiting-slot-name">${s.name} ${isMe ? '(あなた)' : ''}</div>
                    </div>
                    ${isHost ? '<div class="waiting-slot-host">HOST</div>' : ''}
                </div>
            `;
        }).join('');
    }
};

if (typeof window !== 'undefined') {
    window.UIController = UIController;
}

// --- ゲーム初期化 ---
export function initGame() {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }

    UIController.showGame();

    gameStartTime = Date.now();
    frameCount = 0;
    lastFrameTime = Date.now();

    const spawnX = MAP_SIZE / 2 + (Math.random() - 0.5) * 4000;
    const spawnY = MAP_SIZE / 2 + (Math.random() - 0.5) * 4000;
    player.reset(spawnX, spawnY);

    const resolvedPlayerName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
        ? window.GRAVITY_USER_NAME
        : (NetworkManager.myUser && NetworkManager.myUser.name !== 'あなた' ? NetworkManager.myUser.name : 'あなた');

    player.name = resolvedPlayerName;
    player.color = SNAKE_COLORS[NetworkManager.mySlot % SNAKE_COLORS.length];

    remoteSnakes.clear();
    world.clear();
    collisionEngine.clear();

    const isGuest = NetworkManager.isMultiplayerActive && !NetworkManager.isHost;
    if (!isGuest) {
        aiManager.init(MAX_AIS, player.x, player.y);
        window.allAISnakesInstance = aiManager.ais;
        allSnakes = [player, ...aiManager.ais];
    } else {
        aiManager.ais = [];
        window.allAISnakesInstance = [];
        allSnakes = [player];
    }

    sortedSnakes = [...allSnakes];
    Menu.updateParticipants(NetworkManager.slots.filter(s => !s.isAI));
    updateZoomButtonsState(input.zoomMultiplier);
    
    animFrameId = requestAnimationFrame(gameLoop);
}

if (typeof window !== 'undefined') {
    window.initGameInstance = initGame;
}

// 受信ハンドラモジュール（net_handlers.js）へコールバック処理および initGame を接続
setupNetworkHandlers({
    remoteSnakes,
    allSnakes,
    getSortedSnakes: () => sortedSnakes,
    setSortedSnakes: (list) => { sortedSnakes = list; },
    world,
    initGame
});

// UIイベントバインダーの初期化
initUIBindings({
    input,
    hud,
    Sound,
    NetworkManager,
    initGame,
    UIController,
    EntryShield,
    getPlayer: () => player
});

// ゲームオーバー処理 ＆ スコア完全自動送信
function handleGameOver() {
    gameState = 'gameover';
    Sound.stopBoostSound();
    Sound.playCrash();

    try {
        const finalScore = Math.floor(player.score);
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'gameOver',
                score: finalScore
            }, '*');
            console.log(`[Score] Auto submitted score to GRAVITY: ${finalScore}`);
        }
    } catch (err) {
        console.warn('Auto score submission error:', err);
    }

    const overScreen = document.getElementById('over-screen');
    if (!overScreen) return;

    const rank = sortedSnakes.filter(s => !s.isDead).findIndex(s => s === player) + 1 || sortedSnakes.length;
    const duration = Math.floor((Date.now() - gameStartTime) / 1000);

    document.getElementById('res-rank').innerText = `${rank} 位`;
    document.getElementById('res-score').innerText = Math.floor(player.score);
    document.getElementById('res-kills').innerText = player.kills;
    document.getElementById('res-time').innerText = `${duration} 秒`;
    document.getElementById('res-size').innerText = Math.floor(player.maxSize);

    overScreen.style.display = 'flex';
}

/**
 * 起動シーケンス：参考ゲーム（『階段を架けろ！』）準拠
 * DM招待リンク検知時は先行待機室起動 ＆ joinRoom 連携
 */
async function bootSequence() {
    try {
        const userInfo = await NetworkManager.init();
        if (userInfo && userInfo.name && userInfo.name !== 'あなた') {
            player.name = userInfo.name;
        }
        UIController.refreshLobbyGreeting();

        if (window.AgentSDK && window.AgentSDK.room && typeof window.AgentSDK.room.getRoomId === 'function') {
            const res = await window.AgentSDK.room.getRoomId();
            const targetRoomId = (res && typeof res.room_id === 'string')
                ? res.room_id
                : (res && res.data && typeof res.data.room_id === 'string' ? res.data.room_id : '');

            if (targetRoomId && targetRoomId !== '') {
                const shortId = targetRoomId.length > 5 ? targetRoomId.slice(-5) : targetRoomId;
                console.log(`[AutoJoin] DM招待リンク検知: Room #${targetRoomId} へ自動合流開始`);

                EntryShield.show(`ROOM #${shortId}`, '招待ルームへ合流中...');
                UIController.showWaitingRoom(targetRoomId);

                const joinRes = await NetworkManager.joinRoom(targetRoomId);
                EntryShield.hide();

                if (joinRes.success) {
                    UIController.showWaitingRoom(targetRoomId);
                    return;
                } else {
                    console.warn('[AutoJoin] 自動入室に失敗しました。ロビーへ戻します。');
                    Danmaku.push('エラー', joinRes.msg || '入室できませんでした', '#f43f5e', true);
                    UIController.showLobby();
                    return;
                }
            }
        }
    } catch (err) {
        console.warn('[BootSequence] エラー:', err);
        EntryShield.hide();
    }
    UIController.showLobby();
}

function gameLoop() {
    animFrameId = requestAnimationFrame(gameLoop);
    frameCount++;

    const now = Date.now();
    const dtSec = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    if (gameState === 'playing') {
        let inputAngle = null;
        if (input.active && (input.x !== 0 || input.y !== 0)) {
            inputAngle = Math.atan2(input.y, input.x);
        }
        player.updatePhysics(inputAngle, input.boost);

        remoteSnakes.forEach(remote => {
            if (remote.isDead) return;

            const timeSinceLastPacket = performance.now() - (remote.lastPacketTime || performance.now());
            if (timeSinceLastPacket > 5000) {
                remote.die();
                return;
            }

            if (remote.targetNetX !== undefined && remote.targetNetY !== undefined) {
                const distSq = (remote.targetNetX - remote.x) ** 2 + (remote.targetNetY - remote.y) ** 2;
                if (distSq > 160000) {
                    remote.x = remote.targetNetX;
                    remote.y = remote.targetNetY;
                } else {
                    const lerpFactor = 1.0 - Math.exp(-15.0 * dtSec);
                    remote.x += (remote.targetNetX - remote.x) * lerpFactor;
                    remote.y += (remote.targetNetY - remote.y) * lerpFactor;
                }
            }
            remote.updatePhysics(remote.targetAngle, remote.isBoosting);
        });

        if (!NetworkManager.isMultiplayerActive || NetworkManager.isHost) {
            aiManager.update(player, allSnakes, frameCount);
        }

        const viewW = canvas.width / cameraScale;
        const viewH = canvas.height / cameraScale;
        const viewRange = Math.max(viewW, viewH) * 1.5;

        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s === player) continue;
            const dx = s.x - player.x;
            const dy = s.y - player.y;
            s.isVisible = (dx * dx + dy * dy) < (viewRange * viewRange);
        }

        world.updateChunks(player.x, player.y, viewRange);
        world.updateParticles();

        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s.isDead || !s.isVisible) continue;
            world.checkFoodConsumption(s, (eater, food, gx, gy, foodIndex) => {
                if (eater.isPlayer) {
                    if (food.isBig) Sound.playEatBig();
                    else Sound.playEatSmall();

                    if (gx !== null && gy !== null && foodIndex !== undefined) {
                        NetworkManager.queueFoodPick(gx, gy, foodIndex);
                    }
                }
            });
        }

        collisionEngine.registerBodies(allSnakes);
        collisionEngine.checkHeadCollisions(allSnakes, (killer, victim) => {
            // ローカル（ホスト・ソロ）での肉片生成
            world.spawnDeathDrop(victim);

            // ホスト端末：スネーク撃破時に極小クラスタタプル（約20バイト）で全端末へ同期
            if (NetworkManager.isMultiplayerActive && NetworkManager.isHost) {
                const colorIdx = SNAKE_COLORS.indexOf(victim.color);
                const safeColorIdx = colorIdx >= 0 ? colorIdx : 0;
                const dropCount = Math.min(35, Math.max(10, Math.floor((victim.historyLength || 16) / 2)));
                const totalVal = Math.max(100, Math.floor(victim.score * 0.4));

                NetworkManager.queueDropCluster(
                    victim.x,
                    victim.y,
                    totalVal,
                    dropCount,
                    safeColorIdx
                );
            }

            if (victim.isPlayer) {
                handleGameOver();
            } else if (killer.isPlayer) {
                Sound.playCrash();
                Danmaku.push('撃破！', `${victim.name} を倒した！ (+150)`, '#ff3366');
            }
        });

        if (frameCount % 10 === 0) {
            sortedSnakes = [...allSnakes].sort((a, b) => b.score - a.score);
            const myRank = sortedSnakes.filter(s => !s.isDead).findIndex(s => s === player) + 1;
            const totalAlive = sortedSnakes.filter(s => !s.isDead).length;
            hud.updateStats(myRank || 1, totalAlive, player.score);

            const listEl = document.getElementById('leaderboard-list');
            if (listEl && listEl.parentElement && listEl.parentElement.style.display !== 'none') {
                const topList = sortedSnakes.filter(s => !s.isDead).slice(0, 8);
                listEl.innerHTML = topList.map((s, idx) => `
                    <div style="display:flex; justify-content:space-between; color:${s === player ? '#ffdd00' : '#ffffff'}; font-weight:${s === player ? 'bold' : 'normal'}; font-size:12px;">
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:85px;">${idx + 1}. ${s.name}</span>
                        <span>${Math.floor(s.score)}</span>
                    </div>
                `).join('');
            }
        }
    }

    const baseTargetScale = 60.0 / (60.0 + (player.size - 12) * 0.85);
    const finalTargetScale = baseTargetScale * input.zoomMultiplier;
    cameraScale += (finalTargetScale - cameraScale) * 0.05;

    ctx.fillStyle = '#0b051a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing' || gameState === 'gameover') {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(cameraScale, cameraScale);
        ctx.translate(-player.x, -player.y);

        const viewW = canvas.width / cameraScale;
        const viewH = canvas.height / cameraScale;
        const cameraLeft = player.x - viewW / 2;
        const cameraTop = player.y - viewH / 2;

        const step = 200;
        const startX = Math.floor(cameraLeft / step) * step;
        const endX = startX + viewW + step * 2;
        const startY = Math.floor(cameraTop / step) * step;
        const endY = startY + viewH + step * 2;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let x = startX; x < endX; x += step) {
            ctx.moveTo(x, startY); ctx.lineTo(x, endY);
        }
        for (let y = startY; y < endY; y += step) {
            ctx.moveTo(startX, y); ctx.lineTo(endX, y);
        }
        ctx.stroke();

        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

        world.draw(ctx, cameraLeft, cameraTop, viewW, viewH, frameCount);

        for (let i = sortedSnakes.length - 1; i >= 0; i--) {
            const s = sortedSnakes[i];
            if (s === player || s.isVisible) {
                s.draw(ctx, frameCount, cameraScale);
            }
        }

        ctx.restore();

        const safeTop = PlatformDetector.inGravity ? SAFE_INSET_TOP_GRAVITY : SAFE_INSET_TOP_WEB;
        hud.drawRadar(ctx, canvas.width, safeTop, player, sortedSnakes, cameraScale);
    }
}

bootSequence();