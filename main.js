// ==============================================================================
// 『くねくねバトル オンライン』Phase 7 マスター統合オーケストレーター (main.js)
// v45.0.0 人間撃破判定厳格化＆AIキル誤チャット・誤爆即死完全根絶版:
// ・【人間撃破判定の厳格化による誤チャット完全根絶】
// 　撃破判定部における人間判定（isKillerHuman / isVictimHuman）を、スネーク自身の
// 　実体属性（isPlayer または isHumanPlayer === true）による直接判定へ刷新！
// 　通常AI（CPU 1〜5）のIDが人間スロット（1〜5）と重複している場合でも、
// 　AI同士の撃破を人間と誤認してチャット送信してしまう不具合を100%物理根絶
// ・【AI撃破時の他プレイヤー誤爆即死（身代わりキル）完全根絶】
// 　キル同報パケットの被害者スロット（victimSlot）送信において、被害者が実際に
// 　人間プレイヤー（自機または isHumanPlayer）である場合のみスロット番号を渡し、
// 　通常AI撃破時は null を送信することで無関係な人間ゲストが即死するバグを完全解消
// ・【リーダーボードパケットのリモート人間プレイヤースロット番号死守維持】
// ・【リモート追従ワープ判定閾値の適正化維持】250px（62,500）
// ・【ホスト端末側ランキング表示：人間プレイヤーはカスタムカラー / AIは白維持】
// ・【ホスト端末側ランキング非表示デッドロックの完全解消維持】
// ・【空き枠ダミーAIフォールバック名のCPU統一（名前重複完全根絶）維持】
// ・【待機室(マッチング画面)空き枠表記の統一維持】
// ・【撃破判定(isDead)の論理的矛盾完全解決維持】
// ・【リザルト画面強制消去の完全遮断維持】
// ・【外壁激突死のゲームオーバー連携維持】
// ・【リザルト画面表示例外完全防護維持】
// ・【被撃破宣告(onPlayerKilled)確実発火維持】
// ・【撃破重複判定多重発火完全根絶維持】
// ・【リザルト画面前の即時パケットフラッシュ維持】forceImmediateSync()
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
import { handleHostMigration } from './host_migration.js';
import { runBootSequence } from './boot.js';

// --- スコア表示用単位短縮ヘルパー（6桁フル表示 ＆ 7桁目から小数3桁固定 X.XXXM） ---
export function formatScore(val) {
    const s = Math.floor(val || 0);
    if (s >= 1000000) {
        return (s / 1000000).toFixed(3) + 'M';
    }
    return s.toLocaleString();
}

// --- ワールドリセットボタンの表示/非表示動的制御ヘルパー ---
export function updateResetButtonVisibility() {
    const btnReset = document.getElementById('btn-world-reset');
    if (!btnReset) return;

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

            // ★ 待機枠表記の統一：空き枠は「+」バッジ、名前は「プレイヤ X (空き枠)」
            const badgeText = isMe ? 'YOU' : (s.isAI ? '+' : `P${s.slot + 1}`);
            const displayName = s.isAI ? `プレイヤ ${s.slot + 1} (空き枠)` : (s.name || `プレイヤ ${s.slot + 1}`);
            
            const avatarHtml = (s.portrait && !s.isAI)
                ? `<img src="${s.portrait}" alt="avatar" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1.5px solid ${s.color};">`
                : `<div class="waiting-slot-badge" style="background-color: ${s.isAI ? 'rgba(56, 189, 248, 0.2)' : s.color}; border: 1.5px solid ${s.isAI ? 'rgba(56, 189, 248, 0.4)' : s.color}; color: ${s.isAI ? '#38bdf8' : '#ffffff'}; font-size: ${s.isAI ? '14px' : '10px'}; font-weight: 800;">${badgeText}</div>`;

            return `
                <div class="waiting-slot" style="${s.isAI ? 'opacity: 0.65;' : ''}">
                    <div class="waiting-slot-left">
                        ${avatarHtml}
                        <div class="waiting-slot-name" style="color: ${s.isAI ? '#94a3b8' : '#ffffff'};">${displayName} ${isMe ? '(あなた)' : ''}</div>
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

/**
 * ゲームセッションの初期化＆開始
 * @param {boolean} [isRespawn=false] リスポーンフラグ
 * @param {boolean} [isExplicitRetry=false] ユーザーの手動リトライボタン押下による明示的な再開フラグ
 */
export function initGame(isRespawn = false, isExplicitRetry = false) {
    // =========================================================================
    // ★ 【ゲームオーバー中の外部自動リセット完全遮断】
    // リザルトモーダル（#over-screen）が表示中、または gameState === 'gameover' の場合、
    // ユーザー自身の手動リトライ（isExplicitRetry = true）以外による
    // 通信パケット経由の自動 initGame を物理遮断し、リザルト画面の消失を100%防止！
    // =========================================================================
    const overScreenEl = document.getElementById('over-screen');
    const isModalVisible = overScreenEl && overScreenEl.style.display === 'flex';

    if ((gameState === 'gameover' || isModalVisible) && !isExplicitRetry) {
        console.warn('[initGame] リザルト画面表示中のため、外部パケットや自動同期による再開を物理遮断します。');
        return;
    }

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
    player._hasBeenKilled = false;
    camera.reset(spawnX, spawnY);

    const resolvedPlayerName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
        ? window.GRAVITY_USER_NAME
        : (NetworkManager.myUser && NetworkManager.myUser.name !== 'あなた' ? NetworkManager.myUser.name : 'あなた');

    player.name = resolvedPlayerName;
    player.color = SNAKE_COLORS[NetworkManager.mySlot % SNAKE_COLORS.length];
    player.id = NetworkManager.mySlot;

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

        allSnakes.length = 0;
        allSnakes.push(player);

        const isGuest = NetworkManager.isMultiplayerActive && !NetworkManager.isHost;
        if (!isGuest) {
            aiManager.init(MAX_AIS, player.x, player.y);

            for (let i = 0; i < MAX_PLAYERS; i++) {
                if (i === NetworkManager.mySlot) continue;
                const slotData = NetworkManager.slots[i];
                if (slotData && slotData.isAI) {
                    const dummyId = MAX_AIS + i + 1;
                    // ★ 空き枠ダミーAIの名前を通常AIと完全統一された CPU ${dummyId}（例: CPU 96〜100）へ安全フォールバック
                    const dummyName = (slotData.name && slotData.name.startsWith('CPU ')) ? slotData.name : `CPU ${dummyId}`;
                    const aiSnake = new Snake(false, dummyId, dummyName, slotData.color, 'normal');
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 1500 + Math.random() * 22000;
                    const sx = Math.max(400, Math.min(MAP_SIZE - 400, player.x + Math.cos(angle) * dist));
                    const sy = Math.max(400, Math.min(MAP_SIZE - 400, player.y + Math.sin(angle) * dist));
                    aiSnake.reset(sx, sy);
                    aiSnake._hasBeenKilled = false;
                    
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
            allSnakes.push(...aiManager.ais);
        } else {
            aiManager.ais = [];
            window.allAISnakesInstance = [];
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

    // =========================================================================
    // ★ 【描画ループ未起動ブラックアウト完全防止フェイルセーフ】
    // =========================================================================
    if (!animFrameId) {
        animFrameId = requestAnimationFrame(gameLoop);
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
        handleHostMigration({
            remoteSnakes,
            allSnakes,
            sortedSnakesRef: {
                get list() { return sortedSnakes; },
                set list(v) { sortedSnakes = v; }
            },
            setAllSnakes: (list) => {
                allSnakes.length = 0;
                allSnakes.push(...list);
            },
            aiManager,
            player,
            NetworkManager,
            updateResetButtonVisibility
        });
    },

    onSurrenderedAsHost() {
        console.warn('[HostMigration] ゲストへサレンダーしたため、ローカルAIシミュレーションを破棄しリモート同期に戻します。');
        aiManager.ais = [];
        aiManager.aiMeta = [];
        window.allAISnakesInstance = [];
        const currentRemotes = Array.from(remoteSnakes.values());
        allSnakes.length = 0;
        allSnakes.push(player, ...currentRemotes);
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
                // ★ 途中退室時のダミーAIも通常AIと完全統一された CPU ${dummyId}（例: CPU 96〜100）へ命名
                const aiName = (slotData && slotData.name && slotData.name.startsWith('CPU ')) ? slotData.name : `CPU ${dummyId}`;
                
                const newDummyAI = new Snake(false, dummyId, aiName, aiColor, 'normal');
                const angle = Math.random() * Math.PI * 2;
                const dist = 2500 + Math.random() * 15000;
                const sx = Math.max(400, Math.min(MAP_SIZE - 400, player.x + Math.cos(angle) * dist));
                const sy = Math.max(400, Math.min(MAP_SIZE - 400, player.y + Math.sin(angle) * dist));
                newDummyAI.reset(sx, sy);
                newDummyAI._hasBeenKilled = false;

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
    },

    onWorldPurged() {
        remoteSnakes.clear();
        if (allSnakes && player) {
            allSnakes.length = 0;
            allSnakes.push(player, ...(aiManager && Array.isArray(aiManager.ais) ? aiManager.ais : []));
            sortedSnakes = [...allSnakes];
        }
    },

    // =========================================================================
    // ★ 【相手端末からの被撃破宣告(onPlayerKilled)受信ハンドラ】
    // =========================================================================
    onPlayerKilled(killerName) {
        if (gameState !== 'gameover') {
            console.warn(`[Sync] 相手端末からの死亡通告を受信: キラー「${killerName || '敵スネーク'}」により撃破確定。リトライ画面を表示します。`);
            handleGameOver({ name: killerName || '敵スネーク', isDead: false });
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
    if (gameState === 'gameover') return;

    gameState = 'gameover';
    window.currentGameState = gameState;
    player.isDead = true;
    player._hasBeenKilled = true;
    Sound.stopBoostSound();
    Sound.playCrash();

    // =========================================================================
    // ★ 【リザルト画面前の即時パケットフラッシュ】
    // =========================================================================
    if (NetworkManager && NetworkManager.isMultiplayerActive) {
        NetworkManager.forceImmediateSync();
    }

    updateResetButtonVisibility();

    killerTargetSnake = (killer && !killer.isDead) ? killer : null;
    camera.spectatorCamX = player.x;
    camera.spectatorCamY = player.y;

    const finalScore = Math.floor(player.score || 0);

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

    // =========================================================================
    // ★ 【リザルト表示の例外完全防護（100%点灯保証）】
    // =========================================================================
    try {
        const higherCount = allSnakes.filter(s => s && s !== player && (s.score || 0) > finalScore).length;
        const exactRank = higherCount + 1;
        const duration = Math.floor((Date.now() - gameStartTime) / 1000);

        const elRank = document.getElementById('res-rank');
        if (elRank) elRank.innerText = `${exactRank} 位`;

        const elScore = document.getElementById('res-score');
        if (elScore) elScore.innerText = formatScore(finalScore);

        const elKills = document.getElementById('res-kills');
        if (elKills) elKills.innerText = player.kills || 0;

        const elTime = document.getElementById('res-time');
        if (elTime) elTime.innerText = `${duration} 秒`;

        const elSize = document.getElementById('res-size');
        if (elSize) elSize.innerText = Math.floor(player.size || 0);
    } catch (calcErr) {
        console.warn('[GameOver] Stats calculation fallback:', calcErr);
    }

    overScreen.style.display = 'flex';
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

            // =========================================================================
            // ★ 【外壁激突死のゲームオーバー連携】
            // updatePhysics 内で外壁境界接触により player.isDead が立った場合、即座に起動
            // =========================================================================
            if (player.isDead) {
                handleGameOver({ name: '外壁 (MAP境界)', isDead: false });
            }
        }

        remoteSnakes.forEach((remote, slotIdx) => {
            if (remote.isDead) return;

            if (NetworkManager.isMultiplayerActive) {
                if (slotIdx < MAX_PLAYERS) {
                    const isHostSlot = (slotIdx === 0);
                    const slotData = NetworkManager.slots[slotIdx];
                    
                    if (!isHostSlot && (!slotData || slotData.isAI)) {
                        console.warn(`[Sync] 退出検知: スロット ${slotIdx} の残留エンティティをパージ`);
                        remoteSnakes.delete(slotIdx);
                        const aIdx = allSnakes.indexOf(remote);
                        if (aIdx !== -1) allSnakes.splice(aIdx, 1);
                        const sIdx = sortedSnakes.indexOf(remote);
                        if (sIdx !== -1) sortedSnakes.splice(sIdx, 1);
                        return;
                    }
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
                
                // ★ 250px（62500）へ適正化（旧 1,000,000）し、急変時の無理なlerp引き裂きを抑止
                if (distSq > 62500) {
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

        if (NetworkManager.isMultiplayerActive) {
            remoteSnakes.forEach((remote) => {
                if (!remote.isDead && !allSnakes.includes(remote)) {
                    allSnakes.push(remote);
                }
            });
        }

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
            // =========================================================================
            // ★ 【撃破判定の多重発火防止ガード（論理矛盾修正）】
            // =========================================================================
            if (!victim || victim._hasBeenKilled) {
                return;
            }
            victim._hasBeenKilled = true;

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

                // =========================================================================
                // ★ 【人間撃破判定の厳格化（実体属性による直接判定）】
                // 通常AI（CPU 1〜5）のID数値（1〜5）が人間スロットと一致していても、
                // AIである限り人間と誤判定しないようスネークの実体属性で完全識別
                // =========================================================================
                const isKillerHuman = Boolean(killer.isPlayer || killer.isHumanPlayer === true);
                const isVictimHuman = Boolean(victim.isPlayer || victim.isHumanPlayer === true);

                // 人間参加者が関与する撃破のみ通知
                if (isKillerHuman || isVictimHuman) {
                    const killColor = killer.color || '#ff3366';
                    Danmaku.push(killer.name, `${victim.name} を撃破！`, killColor);

                    // =========================================================================
                    // ★ 【撃破同報への被害者スロット(victimSlot)数値同期＆誤爆即死完全防止】
                    // 被害者が人間プレイヤーである場合のみ確実なスロット番号を送信し、
                    // 通常AI撃破時に無関係な人間ゲストが即死するバグを物理根絶
                    // =========================================================================
                    if (NetworkManager.isMultiplayerActive && typeof NetworkManager.broadcastKill === 'function') {
                        let victimSlot = null;
                        if (victim.isPlayer) {
                            victimSlot = NetworkManager.mySlot;
                        } else if (victim.isHumanPlayer === true) {
                            victimSlot = victim.id;
                        } else if (victim.id !== undefined && victim.id > MAX_AIS) {
                            // 空き枠ダミーAI
                            victimSlot = victim.id - MAX_AIS - 1;
                        }
                        NetworkManager.broadcastKill(killer.name, victim.name, killColor, victimSlot !== null ? Number(victimSlot) : null);
                    }
                }
            }

            if (victim.isPlayer) {
                handleGameOver(killer);
            } else {
                victim.die();
                if (killer && killer.isPlayer) {
                    Sound.playCrash();
                }
            }
        });

        if (frameCount % 10 === 0) {
            sortedSnakes = [...allSnakes].sort((a, b) => b.score - a.score);
            const myScore = player.score;
            const higher = allSnakes.filter(s => s && s !== player && s.score > myScore).length;
            const myRank = higher + 1;
            const totalAlive = sortedSnakes.filter(s => s && !s.isDead).length;

            if (!NetworkManager.isMultiplayerActive || NetworkManager.isHost) {
                hud.updateStats(myRank, totalAlive, player.score);

                const topList = sortedSnakes.filter(s => s && !s.isDead).slice(0, 8);

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
                                targetSnake = allSnakes.find(s => s && !s.isPlayer && s.id === dummyId);
                            }
                        }

                        if (targetSnake && !targetSnake.isDead) {
                            const exactHigher = allSnakes.filter(s => s && s !== targetSnake && !s.isDead && s.score > targetSnake.score).length;
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
                            if (s === player) {
                                slotNum = NetworkManager.mySlot;
                            } else if (!s.isPlayer && s.id !== undefined) {
                                // ★ 【リモート人間プレイヤーのスロット番号保護】
                                // 人間走者の場合は本来のスロット番号（0〜5）を維持し、AIスロットへの誤変換を遮断
                                const isRemoteHuman = Boolean(
                                    s.isHumanPlayer ||
                                    (s.id < MAX_PLAYERS && NetworkManager.slots[s.id] && !NetworkManager.slots[s.id].isAI)
                                );

                                if (!isRemoteHuman) {
                                    if (s.id > MAX_AIS) {
                                        slotNum = s.id - MAX_AIS - 1;
                                    } else {
                                        slotNum = MAX_PLAYERS + (s.id - 1);
                                    }
                                }
                            }
                            return {
                                slot: slotNum,
                                name: s.name,
                                score: Math.floor(s.score || 0)
                            };
                        })
                    });
                }

                // =========================================================================
                // ★ 【ホスト端末側ランキング表示：人間プレイヤーはカスタムカラー / AIは白】
                // 非表示中であっても常に最新の innerHTML を構築しておくことで、
                // トロフィーボタンを押した瞬間にホスト側でも100%確実にリストが表示される！
                // =========================================================================
                const listEl = document.getElementById('leaderboard-list');
                if (listEl) {
                    listEl.innerHTML = topList.map((s, idx) => {
                        let textColor = '#ffffff';
                        if (s === player) {
                            textColor = player.color || '#ffdd00';
                        } else {
                            const isRemoteHuman = Boolean(
                                s.isHumanPlayer ||
                                (NetworkManager.isMultiplayerActive && s.id !== undefined && s.id < MAX_PLAYERS && NetworkManager.slots[s.id] && !NetworkManager.slots[s.id].isAI)
                            );
                            if (isRemoteHuman) {
                                textColor = s.color || '#ffffff';
                            }
                        }

                        return `
                        <div style="display:flex; justify-content:space-between; align-items:center; color:${textColor}; font-weight:${s === player ? 'bold' : 'normal'}; font-size:12px; gap:6px;">
                            <div style="display:flex; align-items:center; min-width:0; flex:1; overflow:hidden;">
                                <span style="display:inline-block; width:18px; flex-shrink:0; font-feature-settings:'tnum'; text-align:left;">${idx + 1}.</span>
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${s.name}</span>
                            </div>
                            <span style="font-feature-settings:'tnum'; text-align:right; font-weight:700; flex-shrink:0; margin-left:6px;">${formatScore(s.score)}</span>
                        </div>
                    `;
                    }).join('');
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
            if (s && ((s === player && !player.isDead) || s.isVisible)) {
                s.draw(ctx, frameCount, camera.scale);
            }
        }

        camera.end(ctx);

        const safeTop = PlatformDetector.inGravity ? SAFE_INSET_TOP_GRAVITY : SAFE_INSET_TOP_WEB;
        hud.drawRadar(ctx, canvas.width, safeTop, player.isDead ? { x: camCenter.x, y: camCenter.y, score: player.score } : player, sortedSnakes, camera.scale);
    }
}

// 独立モジュール化した起動シーケンスを実行
runBootSequence({
    NetworkManager,
    player,
    UIController,
    EntryShield,
    Danmaku,
    getGameState: () => gameState
});