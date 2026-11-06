// ==============================================================================
// 『くねくねバトル オンライン』Phase 7 マスター統合オーケストレーター (main.js)
// v54.0.0 長大ネーム・絵文字通信バジェット防護＆待機室レイアウト保護版:
// ・【リーダーボード送信前の長大ネーム・絵文字安全クランプ（通信バジェット防護）】
// 　NetBroadcaster.setLatestLeaderboard にて送信する上位走者名を Array.from() により
// 　最大10文字でサロゲートペア安全にクランプ！長大な日本語・漢字・絵文字ネームが複数人並んでも
// 　パケット容量（1,000B）を圧迫せず、突発的なパケット超過・AI点滅消失を100%未然に防護
// ・【待機室スロットでの長大ネームによるHOSTバッジ押し出し完全防止】
// 　updateWaitingMembersList において、waiting-slot-left に min-width: 0; flex: 1; を配備し、
// 　waiting-slot-name に overflow: hidden; text-overflow: ellipsis; white-space: nowrap; を適用！
// 　長大なユーザー名でも右端の「HOST」バッジを画面外へ押し出さず美しく収容
// ・【ホスト側 onAIKilledByGuest 内の重複 Danmaku.push 撤廃維持】
// ・【対人戦（PvP）撃破同報（broadcastKill）の被害者自己判定一本化維持】
// ・【リモート走者のバックステップ二重減算撤廃（他プレイヤー痙攣完全根絶）維持】
// ・【直近キル座標キャッシュ（recentlyKilledPositions）配備維持】
// ・【ゲストキルAIホスト即時確定RPC（sendAIKill）連携維持】
// ・【直近キルAIの遅延ゾンビ復活完全ブロックガード（recentlyKilledAISlots）維持】
// ・【ホスト端末側 onAIKilledByGuest 受信ハンドラ配備維持】
// ・【リモート人間走者の代理処刑完全遮断（クライアント自己判定主義）維持】
// ・【被害者スロット（victimSlot）送信の自機限定化維持】
// ・【リトライ時のカスタムカラー・顔の完全維持】
// ・【ホスト撃破肉片のローカルワールド生成完全復元維持】
// ・【新入室プレイヤーの身代わり即死（誤爆キル）完全根絶維持】
// ・【ゴーストAI視界保証同期の完全復元維持】
// ・【人間撃破判定の厳格化による誤チャット完全根絶維持】
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

// ★ ゲスト端末での直近キルAI遅延ゾンビ復活ガード用キャッシュ (slot -> expireTime)
const recentlyKilledAISlots = new Map();

// ★ ゲスト端末での直近キル座標キャッシュ（ホストからの二重肉片クラスタ重複排除用: { x, y, expire }）
const recentlyKilledPositions = [];

/**
 * ホストから届いた撃破肉片クラスタが自機の直近キル（ローカル先行生成済み）であるかを照合するAPI
 */
if (typeof window !== 'undefined') {
    window.checkIsRecentLocalKill = function(x, y) {
        const now = performance.now();
        for (let i = recentlyKilledPositions.length - 1; i >= 0; i--) {
            const item = recentlyKilledPositions[i];
            if (now > item.expire) {
                recentlyKilledPositions.splice(i, 1);
                continue;
            }
            const dx = item.x - x;
            const dy = item.y - y;
            if (dx * dx + dy * dy < 90000) { // 半径300px以内（300^2 = 90,000）
                return true;
            }
        }
        return false;
    };
}

window.localPlayerInstance = player;
window.allAISnakesInstance = aiManager.ais;
window.allSnakesInstance = allSnakes;

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

            const badgeText = isMe ? 'YOU' : (s.isAI ? '+' : `P${s.slot + 1}`);
            const displayName = s.isAI ? `プレイヤ ${s.slot + 1} (空き枠)` : (s.name || `プレイヤ ${s.slot + 1}`);
            
            const avatarHtml = (s.portrait && !s.isAI)
                ? `<img src="${s.portrait}" alt="avatar" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1.5px solid ${s.color};">`
                : `<div class="waiting-slot-badge" style="background-color: ${s.isAI ? 'rgba(56, 189, 248, 0.2)' : s.color}; border: 1.5px solid ${s.isAI ? 'rgba(56, 189, 248, 0.4)' : s.color}; color: ${s.isAI ? '#38bdf8' : '#ffffff'}; font-size: ${s.isAI ? '14px' : '10px'}; font-weight: 800;">${badgeText}</div>`;

            return `
                <div class="waiting-slot" style="${s.isAI ? 'opacity: 0.65;' : ''}">
                    <div class="waiting-slot-left" style="min-width: 0; flex: 1; overflow: hidden;">
                        ${avatarHtml}
                        <div class="waiting-slot-name" style="color: ${s.isAI ? '#94a3b8' : '#ffffff'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName} ${isMe ? '(あなた)' : ''}</div>
                    </div>
                    ${isCurrentHost ? '<div class="waiting-slot-host" style="flex-shrink: 0;">HOST</div>' : ''}
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
    recentlyKilledAISlots.clear();
    recentlyKilledPositions.length = 0;

    const spawnX = MAP_SIZE / 2 + (Math.random() - 0.5) * 8000;
    const spawnY = MAP_SIZE / 2 + (Math.random() - 0.5) * 8000;
    player.reset(spawnX, spawnY);
    player._hasBeenKilled = false;
    camera.reset(spawnX, spawnY);

    const resolvedPlayerName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
        ? window.GRAVITY_USER_NAME
        : (NetworkManager.myUser && NetworkManager.myUser.name !== 'あなた' ? NetworkManager.myUser.name : 'あなた');

    player.name = resolvedPlayerName;

    const customColor = (Menu && Menu.selectedColor) 
        ? Menu.selectedColor 
        : (player.color || SNAKE_COLORS[NetworkManager.mySlot % SNAKE_COLORS.length]);
    const customFace = (Menu && Menu.selectedFace) 
        ? Menu.selectedFace 
        : (player.face || 'normal');

    player.color = customColor;
    player.face = customFace;
    player.id = NetworkManager.mySlot;

    if (NetworkManager.slots && NetworkManager.slots[NetworkManager.mySlot]) {
        NetworkManager.slots[NetworkManager.mySlot].color = customColor;
        NetworkManager.slots[NetworkManager.mySlot].face = customFace;
    }

    if (!NetworkManager.isMultiplayerActive) {
        NetworkManager.slots[0].userId = NetworkManager.myUser.user_id;
        NetworkManager.slots[0].name = resolvedPlayerName;
        NetworkManager.slots[0].portrait = NetworkManager.myUser.portrait || '';
        NetworkManager.slots[0].isAI = false;
        NetworkManager.slots[0].color = customColor;
        NetworkManager.slots[0].face = customFace;
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
        window.allSnakesInstance = allSnakes;
        Menu.updateParticipants(NetworkManager.slots.filter(s => !s.isAI));
        updateZoomButtonsState(input.zoomMultiplier);
        
        animFrameId = requestAnimationFrame(gameLoop);
    } else {
        if (!allSnakes.includes(player)) {
            allSnakes.unshift(player);
        }
        sortedSnakes = [...allSnakes];
        window.allSnakesInstance = allSnakes;
    }

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
                window.allSnakesInstance = allSnakes;
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
        window.allSnakesInstance = allSnakes;

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
                window.allSnakesInstance = allSnakes;
            }
        }
    },

    onWorldPurged() {
        remoteSnakes.clear();
        recentlyKilledAISlots.clear();
        recentlyKilledPositions.length = 0;
        if (allSnakes && player) {
            allSnakes.length = 0;
            allSnakes.push(player, ...(aiManager && Array.isArray(aiManager.ais) ? aiManager.ais : []));
            sortedSnakes = [...allSnakes];
            window.allSnakesInstance = allSnakes;
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
    },

    // =========================================================================
    // ★ 【ゲスト端末によるAI撃破確定ハンドラ（ホスト専用）】
    // ゲスト端末が敵AIを撃破した確定通知を受信し、ホスト側の該当AIを即死確定させて
    // 正規肉片クラスタを発行。ゲスト画面での頭だけ無敵ゾンビ復活を完全防止
    // ※ 重複していた Danmaku.push を削除し、KILL_ALERT 側の通知に一本化
    // =========================================================================
    onAIKilledByGuest(aiSlot, killerName) {
        if (!NetworkManager.isHost || !NetworkManager.isMultiplayerActive) return;

        let targetAI = null;
        if (aiSlot < MAX_PLAYERS) {
            const dummyId = MAX_AIS + aiSlot + 1;
            targetAI = allSnakes.find(s => !s.isPlayer && s.id === dummyId);
        } else {
            const originalId = aiSlot - MAX_PLAYERS + 1;
            targetAI = aiManager.ais.find(s => s.id === originalId);
        }

        if (targetAI && !targetAI.isDead) {
            console.log(`[HostSync] ゲスト「${killerName}」によるAI撃破確定を受信: ${targetAI.name} (Slot: ${aiSlot}) を即死処理します`);
            targetAI.die();
            targetAI._hasBeenKilled = true;
            world.spawnDeathDrop(targetAI);

            const colorIdx = SNAKE_COLORS.indexOf(targetAI.color);
            const safeColorIdx = colorIdx >= 0 ? colorIdx : 0;
            const dropCount = Math.min(30, Math.max(10, Math.floor((targetAI.historyLength || 16) / 2)));
            const totalVal = Math.min(2500, Math.max(100, Math.floor(targetAI.score * 0.25)));

            NetworkManager.queueDropCluster(
                targetAI.x,
                targetAI.y,
                totalVal,
                dropCount,
                safeColorIdx
            );
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

            if (player.isDead) {
                handleGameOver({ name: '外壁 (MAP境界)', isDead: false });
            }
        }

        remoteSnakes.forEach((remote, slotIdx) => {
            const killExpire = recentlyKilledAISlots.get(slotIdx);
            if (killExpire) {
                if (performance.now() < killExpire) {
                    remote.isDead = true;
                    remote.invulnerableTimer = 0;
                } else {
                    recentlyKilledAISlots.delete(slotIdx);
                }
            }

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

            // =========================================================================
            // ★ 【リモート走者位置更新：バックステップ二重減算の撤廃】
            // 未来予測位置へのLerp補正後に前進量を二重減算していたコードを撤廃し、
            // カクつき・痙攣振動のない滑らかな走行描画を実現
            // =========================================================================
            if (remote.targetNetX !== undefined && remote.targetNetY !== undefined) {
                const timeScale = Math.max(0.1, Math.min(3.0, dtSec * 60));
                
                remote.targetNetX += Math.cos(remote.targetAngle) * (remote.speed * timeScale);
                remote.targetNetY += Math.sin(remote.targetAngle) * (remote.speed * timeScale);

                const distSq = (remote.targetNetX - remote.x) ** 2 + (remote.targetNetY - remote.y) ** 2;
                
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
            if (!victim || victim._hasBeenKilled) {
                return;
            }

            const isVictimRemoteHuman = Boolean(victim.isHumanPlayer && !victim.isPlayer);
            if (NetworkManager.isMultiplayerActive && isVictimRemoteHuman) {
                return;
            }

            victim._hasBeenKilled = true;

            const isGuestLocalKill = NetworkManager.isMultiplayerActive && !NetworkManager.isHost && killer && killer.isPlayer;
            if (NetworkManager.isMultiplayerActive && !NetworkManager.isHost && !victim.isPlayer && !isGuestLocalKill) {
                return;
            }

            // =========================================================================
            // ★ 【撃破肉片ドロップ ＆ ゲストキル座標キャッシュ登録】
            // =========================================================================
            if (!NetworkManager.isMultiplayerActive) {
                world.spawnDeathDrop(victim);
            } else if (NetworkManager.isHost) {
                world.spawnDeathDrop(victim);

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
            } else if (isGuestLocalKill) {
                world.spawnDeathDrop(victim); // ゲスト自機キルの先行ローカルドロップ！

                // 直近キル座標をキャッシュへ記録（1.8秒間保持し、ホストからの重複クラスタを破棄）
                recentlyKilledPositions.push({
                    x: victim.x,
                    y: victim.y,
                    expire: performance.now() + 1800
                });

                if (victim.id !== undefined) {
                    recentlyKilledAISlots.set(victim.id, performance.now() + 3000);
                    if (typeof NetworkManager.sendAIKill === 'function') {
                        NetworkManager.sendAIKill(victim.id, killer.name);
                    }
                }
            }

            if (killer && !killer.isDead) {
                const absorbedScore = Math.max(120, Math.floor(victim.score * 0.18));
                killer.addScore(absorbedScore);

                const isKillerHuman = Boolean(killer.isPlayer || killer.isHumanPlayer === true);
                const isVictimHuman = Boolean(victim.isPlayer || victim.isHumanPlayer === true);

                if (isKillerHuman || isVictimHuman) {
                    const killColor = killer.color || '#ff3366';

                    // =========================================================================
                    // ★ 【撃破同報の多重発火防止：被撃破側（自己判定）一本化】
                    // 対人戦において勝者・敗者双方が broadcastKill を送り合ってチャットが二重に
                    // 流れるのを防ぐため、被撃破側（victim.isPlayer）または被害者がAIの場合のみ送信
                    // =========================================================================
                    const shouldBroadcast = NetworkManager.isMultiplayerActive && 
                        typeof NetworkManager.broadcastKill === 'function' &&
                        (victim.isPlayer || !isVictimHuman);

                    if (shouldBroadcast) {
                        let victimSlot = victim.isPlayer ? NetworkManager.mySlot : null;
                        NetworkManager.broadcastKill(killer.name, victim.name, killColor, victimSlot !== null ? Number(victimSlot) : null);
                    }

                    // 弾幕表示：自機が被害者、または自機がAIを倒したローカル先行時のみ即時表示（PvPの他者通知はKILL_ALERT経由）
                    if (!NetworkManager.isMultiplayerActive || victim.isPlayer || (killer.isPlayer && !isVictimHuman)) {
                        Danmaku.push(killer.name, `${victim.name} を撃破！`, killColor);
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
                            // ★ 長大ユーザー名・絵文字のサロゲートペア安全クランプ（最大10文字）
                            const rawNameChars = Array.from(s.name || '');
                            const clampedName = rawNameChars.length > 10 ? rawNameChars.slice(0, 10).join('') : (s.name || '');

                            return {
                                slot: slotNum,
                                name: clampedName,
                                score: Math.floor(s.score || 0)
                            };
                        })
                    });
                }

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

runBootSequence({
    NetworkManager,
    player,
    UIController,
    EntryShield,
    Danmaku,
    getGameState: () => gameState
});