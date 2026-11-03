// ==============================================================================
// 『くねくねバトル オンライン』Phase 7 マスター統合オーケストレーター (main.js)
// v28.7.0 ゲスト退出時ダミーAI即時補充＆生態系完全保護版:
// ・【ゲスト退出時ダミーAI即時補充】onUserExited 内で、人間ゲストが退出した際に
// 　空き枠となったスロットへ即座にダミーAI（ID: MAX_AIS + slotIdx + 1）を生成・配備。
// 　入退室の繰り返しによるスネーク数減少（過疎化・定員割れ）を完全根絶し100体を死守
// ・【ホスト昇格時ダミーAI完全継承】onHostPromoted において、空き枠AI（ID: 95〜100）の
// 　スナップショット保持・引き継ぎロジックを配備。ホスト切断・昇格時でも空き枠AIが
// 　初期スコア50ptでリセット（記憶喪失）されず、育ったスコア・位置を完全維持
// ・【デッドレコニング shiftHistory 公式統合】ゲームループ内の大距離ワープ補正時、
// 　snake.js の公式カプセル化API `remote.shiftHistory(shiftX, shiftY)` を統一適用。
// 　生の配列書き換えを根絶し、通常ラグによる胴体消滅・点滅を完全に解消
// ・【空き枠AIダミーID適正化維持】initGame および onHostPromoted 内で、
// 　既存AI（1〜94）と衝突しない正の専用ID空間 `MAX_AIS + i + 1`（95〜100）へ統一維持
// ・【リセットボタン動的表示連動】updateResetButtonVisibility により、
// 　ソロプレイ対戦中のみ #btn-world-reset を表示し、マルチプレイ時は安全に非表示維持
// ・【CPUキルログ完全排除】プレイヤー（自機）または人間の参加者が関与した撃破のみ通知表示
// ・【スコア単位短縮フォーマッター】formatScore 配備（10k / 1M 短縮表示）
// ・【ゴースト完全パージ】切断スロット残留エンティティの即時消去
// ・【餌同期の絶対座標化】checkFoodConsumption のコールバックを絶対座標 (x, y) に適応
// ==============================================================================

import { injectStyles } from './style.js';
injectStyles();

import { mountDOM, EntryShield, updateLobbyGreeting } from './dom.js';
mountDOM();

import {
    MAP_SIZE,
    TOTAL_SNAKES,
    MAX_PLAYERS,
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
import { CameraManager } from './camera.js';
import { NetworkManager } from './network.js';
import { NetBroadcaster } from './net_broadcaster.js';
import { initUIBindings, updateZoomButtonsState } from './ui_binder.js';
import { setupNetworkHandlers } from './net_handlers.js';
import { hookLobbyNetworkEvents } from './net_lobby_hooks.js';

// --- スコア表示用単位短縮ヘルパー（10万・100万時のUIオーバーフロー防止） ---
export function formatScore(val) {
    const s = Math.floor(val || 0);
    if (s >= 1000000) {
        return (s / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (s >= 10000) {
        return (s / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return s.toLocaleString();
}

// --- ワールドリセットボタンの表示/非表示動的制御ヘルパー ---
export function updateResetButtonVisibility() {
    const btnReset = document.getElementById('btn-world-reset');
    if (!btnReset) return;

    // ソロプレイ対戦中（playing）のみ表示、マルチプレイ中やロビー/待機室/ゲームオーバー時は非表示
    const shouldShow = (gameState === 'playing') && (!NetworkManager || !NetworkManager.isMultiplayerActive);
    btnReset.style.display = shouldShow ? 'flex' : 'none';
}

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
const camera = new CameraManager();

window.currentWorldInstance = world;

let player = new Snake(true, 0, 'あなた', SNAKE_COLORS[0], 'normal');
let remoteSnakes = new Map();
let allSnakes = [];
let sortedSnakes = [];

let gameState = 'lobby'; 
window.currentGameState = gameState;

let gameStartTime = Date.now();
let frameCount = 0;
let animFrameId = null;
let lastFrameTime = Date.now();
let killerTargetSnake = null;

window.localPlayerInstance = player;
window.allAISnakesInstance = aiManager.ais;

export const UIController = {
    showLobby() {
        gameState = 'lobby';
        window.currentGameState = gameState;
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const over = document.getElementById('over-screen');
        const stats = document.getElementById('stats-box');

        if (lobby) lobby.style.display = 'flex';
        if (waiting) waiting.style.display = 'none';
        if (over) over.style.display = 'none';
        if (stats) stats.style.display = 'none';
        
        updateResetButtonVisibility();
        this.refreshLobbyGreeting();
    },

    showWaitingRoom(roomId) {
        if (gameState === 'playing') return;

        gameState = 'waiting';
        window.currentGameState = gameState;
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
        
        updateResetButtonVisibility();
        this.updateWaitingMembersList();
    },

    showGame() {
        gameState = 'playing';
        window.currentGameState = gameState;
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const over = document.getElementById('over-screen');

        if (lobby) lobby.style.display = 'none';
        if (waiting) waiting.style.display = 'none';
        if (over) over.style.display = 'none';

        updateResetButtonVisibility();
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
        listEl.innerHTML = NetworkManager.slots.slice(0, MAX_PLAYERS).map(s => {
            const isMe = s.slot === NetworkManager.mySlot;
            
            let isCurrentHost = false;
            if (!s.isAI) {
                if (isMe) {
                    isCurrentHost = Boolean(NetworkManager.isHost);
                } else if (s.isHost !== undefined) {
                    isCurrentHost = Boolean(s.isHost);
                } else {
                    isCurrentHost = (s.slot === 0 && !NetworkManager.isHost);
                }
            }

            const badgeText = isMe ? 'YOU' : (s.isAI ? 'CPU' : `P${s.slot + 1}`);
            
            const avatarHtml = (s.portrait && !s.isAI)
                ? `<img src="${s.portrait}" alt="avatar" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1.5px solid ${s.color};">`
                : `<div class="waiting-slot-badge" style="background-color: ${s.color};">${badgeText}</div>`;

            return `
                <div class="waiting-slot">
                    <div class="waiting-slot-left">
                        ${avatarHtml}
                        <div class="waiting-slot-name">${s.name} ${isMe ? '(あなた)' : ''}</div>
                    </div>
                    ${isCurrentHost ? '<div class="waiting-slot-host">HOST</div>' : ''}
                </div>
            `;
        }).join('');
    }
};

if (typeof window !== 'undefined') {
    window.UIController = UIController;
}

export function initGame(isRespawn = false) {
    if (!isRespawn && animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }

    UIController.showGame();

    gameStartTime = Date.now();
    frameCount = 0;
    lastFrameTime = Date.now();
    killerTargetSnake = null;

    const spawnX = MAP_SIZE / 2 + (Math.random() - 0.5) * 8000;
    const spawnY = MAP_SIZE / 2 + (Math.random() - 0.5) * 8000;
    player.reset(spawnX, spawnY);
    camera.reset(spawnX, spawnY);

    const resolvedPlayerName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
        ? window.GRAVITY_USER_NAME
        : (NetworkManager.myUser && NetworkManager.myUser.name !== 'あなた' ? NetworkManager.myUser.name : 'あなた');

    player.name = resolvedPlayerName;
    player.color = SNAKE_COLORS[NetworkManager.mySlot % SNAKE_COLORS.length];

    if (!NetworkManager.isMultiplayerActive) {
        NetworkManager.slots[0].userId = NetworkManager.myUser.user_id;
        NetworkManager.slots[0].name = resolvedPlayerName;
        NetworkManager.slots[0].portrait = NetworkManager.myUser.portrait || '';
        NetworkManager.slots[0].isAI = false;
    }

    if (!isRespawn) {
        remoteSnakes.clear();
        world.clear();
        collisionEngine.clear();

        const isGuest = NetworkManager.isMultiplayerActive && !NetworkManager.isHost;
        if (!isGuest) {
            aiManager.init(MAX_AIS, player.x, player.y);

            for (let i = 0; i < MAX_PLAYERS; i++) {
                if (i === NetworkManager.mySlot) continue;
                const slotData = NetworkManager.slots[i];
                if (slotData && slotData.isAI) {
                    const dummyId = MAX_AIS + i + 1;
                    const aiSnake = new Snake(false, dummyId, slotData.name || `CPU ${i + 1}`, slotData.color, 'normal');
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 1500 + Math.random() * 22000;
                    const sx = Math.max(400, Math.min(MAP_SIZE - 400, player.x + Math.cos(angle) * dist));
                    const sy = Math.max(400, Math.min(MAP_SIZE - 400, player.y + Math.sin(angle) * dist));
                    aiSnake.reset(sx, sy);
                    
                    aiManager.ais.push(aiSnake);
                    aiManager.aiMeta.push({
                        state: 0,
                        persona: 'forager',
                        targetFoodPos: null,
                        stateTimer: 40 + Math.floor(Math.random() * 60),
                        scavengeTarget: null,
                        cruiseDirection: Math.random() < 0.5 ? 1 : -1,
                        harassSubtype: 0,
                        harassCooldown: Math.floor(Math.random() * 60),
                        deadTimer: 0
                    });
                }
            }

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
    } else {
        if (!allSnakes.includes(player)) {
            allSnakes.unshift(player);
        }
        sortedSnakes = [...allSnakes];
    }

    updateResetButtonVisibility();
}

if (typeof window !== 'undefined') {
    window.initGameInstance = initGame;
}

setupNetworkHandlers({
    remoteSnakes,
    allSnakes,
    getSortedSnakes: () => sortedSnakes,
    setSortedSnakes: (list) => { sortedSnakes = list; },
    world,
    initGame
});

NetworkManager.setCallbacks({
    onHostPromoted() {
        console.log('[HostMigration] ホストに昇格しました。世界線を引き継ぎシミュレーションを開始します。');
        
        const oldHost = remoteSnakes.get(0);
        if (oldHost) {
            if (!oldHost.isDead && oldHost.score > 60) {
                const colorIdx = SNAKE_COLORS.indexOf(oldHost.color);
                const safeColorIdx = colorIdx >= 0 ? colorIdx : 0;
                const dropCount = Math.min(30, Math.max(12, Math.floor((oldHost.historyLength || 16) / 2)));
                const totalVal = Math.min(3000, Math.max(150, Math.floor(oldHost.score * 0.28)));
                NetworkManager.queueDropCluster(oldHost.x, oldHost.y, totalVal, dropCount, safeColorIdx);
            }
            remoteSnakes.delete(0);
            const aIdx = allSnakes.indexOf(oldHost);
            if (aIdx !== -1) allSnakes.splice(aIdx, 1);
            const sIdx = sortedSnakes.indexOf(oldHost);
            if (sIdx !== -1) sortedSnakes.splice(sIdx, 1);
        }

        const oldAiSnapshots = new Map();
        for (const [slot, remote] of remoteSnakes.entries()) {
            if (slot >= MAX_PLAYERS && remote && !remote.isDead) {
                oldAiSnapshots.set(slot - MAX_PLAYERS + 1, {
                    x: remote.x,
                    y: remote.y,
                    score: remote.score,
                    angle: remote.angle,
                    color: remote.color,
                    face: remote.face
                });
            }
        }

        for (const [slot, remote] of remoteSnakes.entries()) {
            if (slot >= MAX_PLAYERS) {
                remoteSnakes.delete(slot);
                const aIdx = allSnakes.indexOf(remote);
                if (aIdx !== -1) allSnakes.splice(aIdx, 1);
            }
        }

        aiManager.init(MAX_AIS, player.x, player.y);
        for (let i = 0; i < aiManager.ais.length; i++) {
            const ai = aiManager.ais[i];
            const snap = oldAiSnapshots.get(ai.id);
            if (snap) {
                ai.x = snap.x;
                ai.y = snap.y;
                ai.score = snap.score;
                ai.angle = snap.angle;
                ai.targetAngle = snap.angle;
                ai.color = snap.color || ai.color;
                ai.face = snap.face || ai.face;
                ai.recalculateSize();
            }
        }

        for (let i = 0; i < MAX_PLAYERS; i++) {
            if (i === NetworkManager.mySlot) continue;
            const slotData = NetworkManager.slots[i];
            if (slotData && slotData.isAI) {
                const dummyId = MAX_AIS + i + 1;
                const aiSnake = new Snake(false, dummyId, slotData.name || `CPU ${i + 1}`, slotData.color, 'normal');
                
                const existingRemote = remoteSnakes.get(i);
                if (existingRemote && !existingRemote.isDead) {
                    aiSnake.x = existingRemote.x;
                    aiSnake.y = existingRemote.y;
                    aiSnake.score = existingRemote.score;
                    aiSnake.angle = existingRemote.angle;
                    aiSnake.targetAngle = existingRemote.angle;
                    aiSnake.color = existingRemote.color || aiSnake.color;
                    aiSnake.face = existingRemote.face || aiSnake.face;
                    aiSnake.recalculateSize();
                    remoteSnakes.delete(i);
                } else {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 1500 + Math.random() * 22000;
                    const sx = Math.max(400, Math.min(MAP_SIZE - 400, player.x + Math.cos(angle) * dist));
                    const sy = Math.max(400, Math.min(MAP_SIZE - 400, player.y + Math.sin(angle) * dist));
                    aiSnake.reset(sx, sy);
                }
                
                aiManager.ais.push(aiSnake);
                aiManager.aiMeta.push({
                    state: 0,
                    persona: 'forager',
                    targetFoodPos: null,
                    stateTimer: 40 + Math.floor(Math.random() * 60),
                    scavengeTarget: null,
                    cruiseDirection: Math.random() < 0.5 ? 1 : -1,
                    harassSubtype: 0,
                    harassCooldown: Math.floor(Math.random() * 60),
                    deadTimer: 0
                });
            }
        }

        window.allAISnakesInstance = aiManager.ais;
        
        const currentPlayers = allSnakes.filter(s => s.isPlayer || (s.id !== undefined && s.id < MAX_PLAYERS));
        allSnakes = [...currentPlayers, ...aiManager.ais];
        sortedSnakes = [...allSnakes];

        updateResetButtonVisibility();
    },

    onSurrenderedAsHost() {
        console.warn('[HostMigration] ゲストへサレンダーしたため、ローカルAIシミュレーションを破棄しリモート同期に戻します。');
        aiManager.ais = [];
        aiManager.aiMeta = [];
        window.allAISnakesInstance = [];
        const currentRemotes = Array.from(remoteSnakes.values());
        allSnakes = [player, ...currentRemotes];
        sortedSnakes = [...allSnakes];

        updateResetButtonVisibility();
    },

    onUserExited(slotIdx) {
        const remote = remoteSnakes.get(slotIdx);
        if (remote) {
            remoteSnakes.delete(slotIdx);
            const aIdx = allSnakes.indexOf(remote);
            if (aIdx !== -1) allSnakes.splice(aIdx, 1);
            const sIdx = sortedSnakes.indexOf(remote);
            if (sIdx !== -1) sortedSnakes.splice(sIdx, 1);
        }

        if (NetworkManager.isHost && NetworkManager.isMultiplayerActive && slotIdx < MAX_PLAYERS && slotIdx !== NetworkManager.mySlot) {
            const dummyId = MAX_AIS + slotIdx + 1;
            const existingFake = allSnakes.find(s => !s.isPlayer && s.id === dummyId);
            if (!existingFake) {
                const slotData = NetworkManager.slots[slotIdx];
                const aiColor = (slotData && slotData.color) ? slotData.color : SNAKE_COLORS[slotIdx % SNAKE_COLORS.length];
                const aiName = (slotData && slotData.name) ? slotData.name : `CPU ${slotIdx + 1}`;
                
                const newDummyAI = new Snake(false, dummyId, aiName, aiColor, 'normal');
                const angle = Math.random() * Math.PI * 2;
                const dist = 2500 + Math.random() * 15000;
                const sx = Math.max(400, Math.min(MAP_SIZE - 400, player.x + Math.cos(angle) * dist));
                const sy = Math.max(400, Math.min(MAP_SIZE - 400, player.y + Math.sin(angle) * dist));
                newDummyAI.reset(sx, sy);

                aiManager.ais.push(newDummyAI);
                aiManager.aiMeta.push({
                    state: 0,
                    persona: 'forager',
                    targetFoodPos: null,
                    stateTimer: 40 + Math.floor(Math.random() * 60),
                    scavengeTarget: null,
                    cruiseDirection: Math.random() < 0.5 ? 1 : -1,
                    harassSubtype: 0,
                    harassCooldown: Math.floor(Math.random() * 60),
                    deadTimer: 0
                });

                if (!allSnakes.includes(newDummyAI)) {
                    allSnakes.push(newDummyAI);
                }
                sortedSnakes = [...allSnakes];
                window.allAISnakesInstance = aiManager.ais;
            }
        }
    }
});

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

function handleGameOver(killer) {
    gameState = 'gameover';
    window.currentGameState = gameState;
    Sound.stopBoostSound();
    Sound.playCrash();

    updateResetButtonVisibility();

    killerTargetSnake = (killer && !killer.isDead) ? killer : null;
    camera.spectatorCamX = player.x;
    camera.spectatorCamY = player.y;

    const finalScore = Math.floor(player.score);

    try {
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

    const higherCount = allSnakes.filter(s => s !== player && s.score > finalScore).length;
    const exactRank = higherCount + 1;
    const duration = Math.floor((Date.now() - gameStartTime) / 1000);

    document.getElementById('res-rank').innerText = `${exactRank} 位`;
    document.getElementById('res-score').innerText = formatScore(finalScore);
    document.getElementById('res-kills').innerText = player.kills;
    document.getElementById('res-time').innerText = `${duration} 秒`;
    document.getElementById('res-size').innerText = Math.floor(player.maxSize);

    overScreen.style.display = 'flex';
}

async function bootSequence() {
    try {
        const userInfo = await NetworkManager.init();
        if (userInfo && userInfo.name && userInfo.name !== 'あなた') {
            player.name = userInfo.name;
        }
        UIController.refreshLobbyGreeting();
        hookLobbyNetworkEvents();

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
                    if (gameState !== 'playing') {
                        UIController.showWaitingRoom(targetRoomId);
                    }
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
    const dtSec = Math.min(Math.max((now - lastFrameTime) / 1000, 0.001), 0.1);
    lastFrameTime = now;

    if (gameState === 'playing' || gameState === 'gameover') {
        if (gameState === 'playing' && !player.isDead) {
            let inputAngle = null;
            if (input.active && (input.x !== 0 || input.y !== 0)) {
                inputAngle = Math.atan2(input.y, input.x);
            }
            player.updatePhysics(dtSec, inputAngle, input.boost);
        }

        remoteSnakes.forEach((remote, slotIdx) => {
            if (remote.isDead) return;

            if (NetworkManager.isMultiplayerActive) {
                const slotData = NetworkManager.slots[slotIdx];
                if (!slotData || slotData.isAI) {
                    console.warn(`[Sync] ゴースト検知: 切断されたスロット ${slotIdx} の残留エンティティを完全パージします。`);
                    remoteSnakes.delete(slotIdx);
                    const aIdx = allSnakes.indexOf(remote);
                    if (aIdx !== -1) allSnakes.splice(aIdx, 1);
                    const sIdx = sortedSnakes.indexOf(remote);
                    if (sIdx !== -1) sortedSnakes.splice(sIdx, 1);
                    return;
                }
            }

            const timeSinceLastPacket = performance.now() - (remote.lastPacketTime || performance.now());
            if (timeSinceLastPacket > 5000) {
                remote.die();
                return;
            }

            if (remote.targetNetX !== undefined && remote.targetNetY !== undefined) {
                const timeScale = Math.max(0.1, Math.min(3.0, dtSec * 60));
                
                remote.targetNetX += Math.cos(remote.targetAngle) * (remote.speed * timeScale);
                remote.targetNetY += Math.sin(remote.targetAngle) * (remote.speed * timeScale);

                const distSq = (remote.targetNetX - remote.x) ** 2 + (remote.targetNetY - remote.y) ** 2;
                
                if (distSq > 1000000) {
                    const shiftX = remote.targetNetX - remote.x;
                    const shiftY = remote.targetNetY - remote.y;
                    
                    remote.shiftHistory(shiftX, shiftY);
                    remote.x = remote.targetNetX;
                    remote.y = remote.targetNetY;
                } else {
                    const lerpFactor = 1.0 - Math.exp(-15.0 * dtSec);
                    remote.x += (remote.targetNetX - remote.x) * lerpFactor;
                    remote.y += (remote.targetNetY - remote.y) * lerpFactor;
                }
                
                remote.x -= Math.cos(remote.targetAngle) * (remote.speed * timeScale);
                remote.y -= Math.sin(remote.targetAngle) * (remote.speed * timeScale);
            }
            
            remote.updatePhysics(dtSec, remote.targetAngle, remote.isBoosting);
        });

        if (!NetworkManager.isMultiplayerActive || NetworkManager.isHost) {
            if (NetworkManager.isHost && NetworkManager.isMultiplayerActive) {
                for (let sIdx = 1; sIdx < MAX_PLAYERS; sIdx++) {
                    const slotData = NetworkManager.slots[sIdx];
                    if (slotData && !slotData.isAI) {
                        const dummyId = MAX_AIS + sIdx + 1;
                        const fakeIdx = allSnakes.findIndex(s => !s.isPlayer && s.id === dummyId);
                        if (fakeIdx !== -1) {
                            allSnakes.splice(fakeIdx, 1);
                        }
                        const aiManagerIdx = aiManager.ais.findIndex(s => s.id === dummyId);
                        if (aiManagerIdx !== -1) {
                            aiManager.ais.splice(aiManagerIdx, 1);
                            aiManager.aiMeta.splice(aiManagerIdx, 1);
                        }

                        const realRemote = remoteSnakes.get(sIdx);
                        if (realRemote && !allSnakes.includes(realRemote)) {
                            allSnakes.push(realRemote);
                        }
                    }
                }
            }

            aiManager.update(player, allSnakes, frameCount, dtSec);
        }

        camera.update(player, killerTargetSnake, input.zoomMultiplier, dtSec);
        const camCenter = camera.getCenter(player);

        const viewW = canvas.width / camera.scale;
        const viewH = canvas.height / camera.scale;
        const viewRange = Math.max(viewW, viewH) * 1.5;

        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s === player && !player.isDead) continue;
            const dx = s.x - camCenter.x;
            const dy = s.y - camCenter.y;
            s.isVisible = (dx * dx + dy * dy) < (viewRange * viewRange);
        }

        world.updateChunks(camCenter.x, camCenter.y, viewRange);
        world.updateParticles();

        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s.isDead || !s.isVisible) continue;
            
            world.checkFoodConsumption(s, (eater, food, x, y) => {
                if (eater.isPlayer) {
                    if (food.isBig) Sound.playEatBig();
                    else Sound.playEatSmall();

                    if (x !== undefined && y !== undefined) {
                        NetworkManager.queueFoodPick(x, y);
                    }
                }
            });
        }

        collisionEngine.registerBodies(allSnakes);
        collisionEngine.checkHeadCollisions(allSnakes, (killer, victim) => {
            if (NetworkManager.isMultiplayerActive && !NetworkManager.isHost && !victim.isPlayer) {
                return;
            }

            if (!NetworkManager.isMultiplayerActive) {
                world.spawnDeathDrop(victim);
            } else if (NetworkManager.isHost) {
                const colorIdx = SNAKE_COLORS.indexOf(victim.color);
                const safeColorIdx = colorIdx >= 0 ? colorIdx : 0;
                const dropCount = Math.min(30, Math.max(10, Math.floor((victim.historyLength || 16) / 2)));
                const totalVal = Math.min(2500, Math.max(100, Math.floor(victim.score * 0.25)));

                NetworkManager.queueDropCluster(
                    victim.x,
                    victim.y,
                    totalVal,
                    dropCount,
                    safeColorIdx
                );
            }

            if (killer && !killer.isDead) {
                const absorbedScore = Math.max(120, Math.floor(victim.score * 0.18));
                killer.addScore(absorbedScore);

                const isKillerHuman = killer.isPlayer || (NetworkManager.isMultiplayerActive && killer.id !== undefined && killer.id < MAX_PLAYERS && NetworkManager.slots[killer.id] && !NetworkManager.slots[killer.id].isAI);
                const isVictimHuman = victim.isPlayer || (NetworkManager.isMultiplayerActive && victim.id !== undefined && victim.id < MAX_PLAYERS && NetworkManager.slots[victim.id] && !NetworkManager.slots[victim.id].isAI);

                if (isKillerHuman || isVictimHuman) {
                    Danmaku.push(killer.name, `${victim.name} を撃破！`, killer.color || '#ff3366');
                }
            }

            if (victim.isPlayer) {
                handleGameOver(killer);
            } else if (killer.isPlayer) {
                Sound.playCrash();
            }
        });

        if (frameCount % 10 === 0) {
            sortedSnakes = [...allSnakes].sort((a, b) => b.score - a.score);
            const myScore = player.score;
            const higher = allSnakes.filter(s => s !== player && s.score > myScore).length;
            const myRank = higher + 1;
            const totalAlive = sortedSnakes.filter(s => !s.isDead).length;

            if (!NetworkManager.isMultiplayerActive || NetworkManager.isHost) {
                hud.updateStats(myRank, totalAlive, player.score);

                const topList = sortedSnakes.filter(s => !s.isDead).slice(0, 8);

                if (NetworkManager.isHost && NetworkManager.isMultiplayerActive) {
                    const slotRanks = {};
                    for (let sIdx = 0; sIdx < MAX_PLAYERS; sIdx++) {
                        let targetSnake = null;
                        if (sIdx === NetworkManager.mySlot) {
                            targetSnake = player;
                        } else {
                            targetSnake = remoteSnakes.get(sIdx);
                            if (!targetSnake) {
                                const dummyId = MAX_AIS + sIdx + 1;
                                targetSnake = allSnakes.find(s => s.id === dummyId);
                            }
                        }

                        if (targetSnake && !targetSnake.isDead) {
                            const exactHigher = allSnakes.filter(s => s !== targetSnake && !s.isDead && s.score > targetSnake.score).length;
                            slotRanks[sIdx] = exactHigher + 1;
                        } else {
                            slotRanks[sIdx] = totalAlive;
                        }
                    }

                    NetBroadcaster.setLatestLeaderboard({
                        totalAlive: totalAlive,
                        ranks: slotRanks,
                        top: topList.map(s => {
                            let slotNum = s.id;
                            if (s === player) slotNum = NetworkManager.mySlot;
                            return {
                                slot: slotNum,
                                name: s.name,
                                score: Math.floor(s.score)
                            };
                        })
                    });
                }

                const listEl = document.getElementById('leaderboard-list');
                if (listEl && listEl.parentElement && listEl.parentElement.style.display !== 'none') {
                    listEl.innerHTML = topList.map((s, idx) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; color:${s === player ? '#ffdd00' : '#ffffff'}; font-weight:${s === player ? 'bold' : 'normal'}; font-size:12px; gap:6px;">
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:88px;">${idx + 1}. ${s.name}</span>
                            <span style="font-feature-settings:'tnum'; text-align:right; font-weight:700;">${formatScore(s.score)}</span>
                        </div>
                    `).join('');
                }
            }
        }
    }

    ctx.fillStyle = '#0b051a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing' || gameState === 'gameover') {
        const camCenter = camera.getCenter(player);
        const viewW = canvas.width / camera.scale;
        const viewH = canvas.height / camera.scale;
        const cameraLeft = camCenter.x - viewW / 2;
        const cameraTop = camCenter.y - viewH / 2;

        camera.begin(ctx, canvas, camCenter.x, camCenter.y);
        camera.drawGrid(ctx, cameraLeft, cameraTop, viewW, viewH);

        world.draw(ctx, cameraLeft, cameraTop, viewW, viewH, frameCount);

        for (let i = sortedSnakes.length - 1; i >= 0; i--) {
            const s = sortedSnakes[i];
            if ((s === player && !player.isDead) || s.isVisible) {
                s.draw(ctx, frameCount, camera.scale);
            }
        }

        camera.end(ctx);

        const safeTop = PlatformDetector.inGravity ? SAFE_INSET_TOP_GRAVITY : SAFE_INSET_TOP_WEB;
        hud.drawRadar(ctx, canvas.width, safeTop, player.isDead ? { x: camCenter.x, y: camCenter.y, score: player.score } : player, sortedSnakes, camera.scale);
    }
}

bootSequence();