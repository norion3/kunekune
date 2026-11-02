// ==============================================================================
// 『くねくねバトル オンライン』Phase 5 マスター統合オーケストレーター (main.js)
// v26.4.0 空き枠AI実体化＆ホスト昇格時幽霊パージ・途中参加整合版:
// ・【AI欠損根絶】待機室の空きスロット（スロット1〜5のisAI枠）を自律AI実体として完全生成し、100体規模を完全維持
// ・【旧ホスト幽霊パージ】ホスト昇格時、切断した旧ホスト（スロット0）を remoteSnakes / allSnakes から完全パージ
// ・【待機室HOST表示動的化】updateWaitingMembersList の s.slot === 0 ハードコードを撤廃し、昇格した新ホストへ正確にHOSTバッジを表示
// ・AI物理DeltaTime完全同期＆ホスト昇格時旧AIスロット完全パージ維持
// ・DM招待合流時、ゲーム画面開始後に bootSequence が待機室を上書き表示する競合バグを根絶
// ・退室したプレイヤーを remoteSnakes / allSnakes / sortedSnakes から完全パージ（メモリリーク根絶）
// ・ホストから全人間スロット（0〜5）の確定順位マップ（ranks）を同封し、ゲスト順位9位固定バグを解消維持
// ・カメラ追従・視野スケーリング・グリッド描画を camera.js へ完全委譲
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

// 自律生態系AIが肉片ドロップ（ハイエナモード）を検知するためのグローバル参照
window.currentWorldInstance = world;

let player = new Snake(true, 0, 'あなた', SNAKE_COLORS[0], 'normal');
let remoteSnakes = new Map();
let allSnakes = [];
let sortedSnakes = [];

let gameState = 'lobby'; 
window.currentGameState = gameState; // NetworkManager 同期判定用グローバル参照

let gameStartTime = Date.now();
let frameCount = 0;
let animFrameId = null; // 二重ループ防止用
let lastFrameTime = Date.now(); // DeltaTime計算用
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
        this.refreshLobbyGreeting();
    },

    showWaitingRoom(roomId) {
        // 対戦プレイ中の場合は待機室の強制上書きを安全にスキップ
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

    /**
     * 待機室メンバー描画（★動的HOSTバッジ判定完全対応）
     */
    updateWaitingMembersList() {
        const listEl = document.getElementById('waiting-members-list');
        if (!listEl) return;
        listEl.innerHTML = NetworkManager.slots.slice(0, MAX_PLAYERS).map(s => {
            const isMe = s.slot === NetworkManager.mySlot;
            
            // ★ 動的HOST判定：スロット0固定を廃止し、自機なら isHost、他スロットなら同期フラグ・AI有無を参照
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

// --- ゲーム初期化 ＆ 即時リスポーン対応 ---
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

            // ★ AI欠損問題の修正：空きスロット（isAI: true）の枠を自律AI実体として完全生成
            // NetBroadcaster の MAX_PLAYERS + (ai.id - 1) 規格と整合させ、スロット 0〜5 の空き枠として通信同期させる
            for (let i = 0; i < MAX_PLAYERS; i++) {
                if (i === NetworkManager.mySlot) continue;
                const slotData = NetworkManager.slots[i];
                if (slotData && slotData.isAI) {
                    const dummyId = i - MAX_PLAYERS + 1; // 逆算スロットID
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
                        harassCooldown: Math.floor(Math.random() * 60)
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

// 自律ホスト昇格時のAI完全引き継ぎ（旧AIスロット完全パージによる194体増殖根絶）
NetworkManager.setCallbacks({
    onHostPromoted() {
        console.log('[HostMigration] ホストに昇格しました。旧AIスロットを完全パージしシミュレーションを引き継ぎます。');
        
        // ★ 旧ホスト（スロット0）のエンティティも完全パージする（幽霊化・メモリリーク防止）
        const oldHost = remoteSnakes.get(0);
        if (oldHost) {
            remoteSnakes.delete(0);
            const aIdx = allSnakes.indexOf(oldHost);
            if (aIdx !== -1) allSnakes.splice(aIdx, 1);
            const sIdx = sortedSnakes.indexOf(oldHost);
            if (sIdx !== -1) sortedSnakes.splice(sIdx, 1);
        }

        // 旧ホストから受信していたAIスロット（スロット6以降）を remoteSnakes から完全除去
        for (const [slot, remote] of remoteSnakes.entries()) {
            if (slot >= MAX_PLAYERS) {
                remoteSnakes.delete(slot);
                const aIdx = allSnakes.indexOf(remote);
                if (aIdx !== -1) allSnakes.splice(aIdx, 1);
            }
        }

        // 自前の自律生態系AIを初期化して統合
        aiManager.init(MAX_AIS, player.x, player.y);
        
        // ★ 空きスロットAIの補填（ホスト昇格時）
        for (let i = 0; i < MAX_PLAYERS; i++) {
            if (i === NetworkManager.mySlot) continue;
            const slotData = NetworkManager.slots[i];
            if (slotData && slotData.isAI) {
                const dummyId = i - MAX_PLAYERS + 1; // 逆算ID
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
                    harassCooldown: Math.floor(Math.random() * 60)
                });
            }
        }

        window.allAISnakesInstance = aiManager.ais;
        
        // 生存している人間プレイヤーを残しつつ新AIを統合
        const currentPlayers = allSnakes.filter(s => s.isPlayer || (s.id !== undefined && s.id < MAX_PLAYERS));
        allSnakes = [...currentPlayers, ...aiManager.ais];
        sortedSnakes = [...allSnakes];
    },
    // 退室したプレイヤーをワールドの配列から完全パージ（ゾンビ化・メモリリーク防止）
    onUserExited(slotIdx) {
        const remote = remoteSnakes.get(slotIdx);
        if (remote) {
            remoteSnakes.delete(slotIdx);
            const aIdx = allSnakes.indexOf(remote);
            if (aIdx !== -1) allSnakes.splice(aIdx, 1);
            const sIdx = sortedSnakes.indexOf(remote);
            if (sIdx !== -1) sortedSnakes.splice(sIdx, 1);
        }
    }
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

function handleGameOver(killer) {
    gameState = 'gameover';
    window.currentGameState = gameState;
    Sound.stopBoostSound();
    Sound.playCrash();

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
    document.getElementById('res-score').innerText = finalScore;
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
    // 実経過秒数（DeltaTime: 0.001〜0.1秒の間で安全クランプ）
    const dtSec = Math.min(Math.max((now - lastFrameTime) / 1000, 0.001), 0.1);
    lastFrameTime = now;

    if (gameState === 'playing' || gameState === 'gameover') {
        // 自機物理演算への dtSec 完全引き渡し（フレームレート非依存化）
        if (gameState === 'playing' && !player.isDead) {
            let inputAngle = null;
            if (input.active && (input.x !== 0 || input.y !== 0)) {
                inputAngle = Math.atan2(input.y, input.x);
            }
            player.updatePhysics(dtSec, inputAngle, input.boost);
        }

        // リモート他走者への dtSec 完全引き渡し
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
            remote.updatePhysics(dtSec, remote.targetAngle, remote.isBoosting);
        });

        // ホスト端末：AIシミュレーション・生態系思考を dtSec 基準で100%継続
        if (!NetworkManager.isMultiplayerActive || NetworkManager.isHost) {
            aiManager.update(player, allSnakes, frameCount, dtSec);
        }

        camera.update(player, killerTargetSnake, input.zoomMultiplier);
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

        // 餌捕食判定の継続
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

        // 空間衝突判定
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

                Danmaku.push(killer.name, `${victim.name} を撃破！`, killer.color || '#ff3366');
            }

            if (victim.isPlayer) {
                handleGameOver(killer);
            } else if (killer.isPlayer) {
                Sound.playCrash();
            }
        });

        // 統計・リーダーボードの定期更新
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
                        const targetSnake = allSnakes.find(s => s.id === sIdx);
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
                        top: topList.map(s => ({
                            slot: s.id,
                            name: s.name,
                            score: Math.floor(s.score)
                        }))
                    });
                }

                const listEl = document.getElementById('leaderboard-list');
                if (listEl && listEl.parentElement && listEl.parentElement.style.display !== 'none') {
                    listEl.innerHTML = topList.map((s, idx) => `
                        <div style="display:flex; justify-content:space-between; color:${s === player ? '#ffdd00' : '#ffffff'}; font-weight:${s === player ? 'bold' : 'normal'}; font-size:12px;">
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:85px;">${idx + 1}. ${s.name}</span>
                            <span>${Math.floor(s.score)}</span>
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