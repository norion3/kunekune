// ==============================================================================
// 『くねくねバトル オンライン』Phase 5 マスター統合オーケストレーター (main.js)
// v24.0.0 最終順位厳格判定＆最大6人待機室・バックグラウンド世界維持版:
// ・死亡時の最終順位計算バグを根絶（自分よりスコアが高いスネーク数＋1による厳格算出）
// ・待機室スロットを最大6名（0〜5）対応へ拡張＆アバター画像表示
// ・ゲームオーバー時もホスト端末のAI演算・他走者同期・物理判定を100%継続（世界停止完全防止）
// ・死者端末のリアルタイム観戦カメラ（キラーまたは死亡地点をスムーズ追従）
// ・撃破時スコア吸収（相手スコアの30%即時吸収＋基本点加算）による納得のスコアリング
// ・スネーク撃破時の大量肉片クラスタ同期（queueDropCluster）完全接続
// ・招待URL（DMリンク）検知時の先行待機室起動 ＆ hookLobbyNetworkEvents 確実バインド
// ・二重ループ起動防止 (animFrameId) ＆ EntryShield 通信ロック
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

// 観戦カメラ座標（ゲームオーバー時のスムーズ追従用）
let spectatorCamX = MAP_SIZE / 2;
let spectatorCamY = MAP_SIZE / 2;
let killerTargetSnake = null;

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

    /**
     * 最大6名スロット対応待機室メンバー描画
     */
    updateWaitingMembersList() {
        const listEl = document.getElementById('waiting-members-list');
        if (!listEl) return;
        listEl.innerHTML = NetworkManager.slots.slice(0, MAX_PLAYERS).map(s => {
            const isMe = s.slot === NetworkManager.mySlot;
            const isHost = s.slot === 0;
            const badgeText = isMe ? 'YOU' : (s.isAI ? 'CPU' : `P${s.slot + 1}`);
            
            // アバター画像がある場合は円形サムネイル、ない場合は頭文字バッジ
            const avatarHtml = (s.portrait && !s.isAI)
                ? `<img src="${s.portrait}" alt="avatar" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1.5px solid ${s.color};">`
                : `<div class="waiting-slot-badge" style="background-color: ${s.color};">${badgeText}</div>`;

            return `
                <div class="waiting-slot">
                    <div class="waiting-slot-left">
                        ${avatarHtml}
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

    // 安全圏スポーン計算（外周安全ゾーンまたは中心から離れた場所）
    const spawnX = MAP_SIZE / 2 + (Math.random() - 0.5) * 8000;
    const spawnY = MAP_SIZE / 2 + (Math.random() - 0.5) * 8000;
    player.reset(spawnX, spawnY);
    spectatorCamX = spawnX;
    spectatorCamY = spawnY;

    const resolvedPlayerName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
        ? window.GRAVITY_USER_NAME
        : (NetworkManager.myUser && NetworkManager.myUser.name !== 'あなた' ? NetworkManager.myUser.name : 'あなた');

    player.name = resolvedPlayerName;
    player.color = SNAKE_COLORS[NetworkManager.mySlot % SNAKE_COLORS.length];

    // ★ ソロプレイ時でもスロット0に自身のユーザーIDとアバターを確実にバインド（プロフ遷移連携）
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
        // リスポーン時：既存の allSnakes 内のプレイヤーインスタンスを即座に再登録
        if (!allSnakes.includes(player)) {
            allSnakes.unshift(player);
        }
        sortedSnakes = [...allSnakes];
    }
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
function handleGameOver(killer) {
    gameState = 'gameover';
    Sound.stopBoostSound();
    Sound.playCrash();

    killerTargetSnake = (killer && !killer.isDead) ? killer : null;
    spectatorCamX = player.x;
    spectatorCamY = player.y;

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

    // ★ 最終順位計算バグの完全根絶：
    //   死亡フラグ（isDead）でフィルタすると自分が除外されて findIndex が -1 になり、
    //   47位（生存総数）と誤判定されていた。
    //   死亡直前の自分のスコアより高いスコアを持つスネークの数＋1で厳密に正規順位を算出。
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

/**
 * 起動シーケンス：参考ゲーム準拠
 */
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

    // 世界シミュレーション：playing および gameover（リトライ待ち）のいずれでもバックグラウンド継続
    if (gameState === 'playing' || gameState === 'gameover') {
        // 自機操作は生きている場合のみ更新
        if (gameState === 'playing' && !player.isDead) {
            let inputAngle = null;
            if (input.active && (input.x !== 0 || input.y !== 0)) {
                inputAngle = Math.atan2(input.y, input.x);
            }
            player.updatePhysics(inputAngle, input.boost);
        }

        // リモート他走者の座標補間（死んでいてもリアルタイムに滑らか追従）
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

        // ホスト端末：自分が死んでいてもAIシミュレーション・生態系思考を100%継続
        if (!NetworkManager.isMultiplayerActive || NetworkManager.isHost) {
            aiManager.update(player, allSnakes, frameCount);
        }

        // 観戦カメラ座標の更新（生存時は自機、死亡時はキラーまたは死亡地点をスムーズ追従）
        let activeCamX = player.x;
        let activeCamY = player.y;

        if (player.isDead) {
            if (killerTargetSnake && !killerTargetSnake.isDead) {
                spectatorCamX += (killerTargetSnake.x - spectatorCamX) * 0.08;
                spectatorCamY += (killerTargetSnake.y - spectatorCamY) * 0.08;
            }
            activeCamX = spectatorCamX;
            activeCamY = spectatorCamY;
        }

        const viewW = canvas.width / cameraScale;
        const viewH = canvas.height / cameraScale;
        const viewRange = Math.max(viewW, viewH) * 1.5;

        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s === player && !player.isDead) continue;
            const dx = s.x - activeCamX;
            const dy = s.y - activeCamY;
            s.isVisible = (dx * dx + dy * dy) < (viewRange * viewRange);
        }

        world.updateChunks(activeCamX, activeCamY, viewRange);
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
            world.spawnDeathDrop(victim);

            // 撃破クラスタ同期
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

            // スコア得点計算：相手の所持スコアの30%を即時吸収＋撃破基本点
            if (killer && !killer.isDead) {
                const absorbedScore = Math.max(150, Math.floor(victim.score * 0.3));
                killer.addScore(absorbedScore);
            }

            if (victim.isPlayer) {
                handleGameOver(killer);
            } else if (killer.isPlayer) {
                Sound.playCrash();
                const absorbed = Math.max(150, Math.floor(victim.score * 0.3));
                Danmaku.push('撃破！', `${victim.name} を撃破！ (+${absorbed} pt)`, '#ff3366');
            }
        });

        // 統計・リーダーボードの定期更新
        if (frameCount % 10 === 0) {
            sortedSnakes = [...allSnakes].sort((a, b) => b.score - a.score);
            const myScore = player.score;
            const higher = allSnakes.filter(s => s !== player && s.score > myScore).length;
            const myRank = higher + 1;
            const totalAlive = sortedSnakes.filter(s => !s.isDead).length;
            hud.updateStats(myRank, totalAlive, player.score);

            const topList = sortedSnakes.filter(s => !s.isDead).slice(0, 8);

            // ★ ホスト端末：全端末同期用に最新リーダーボードパケットをキャッシュ登録
            if (NetworkManager.isHost && NetworkManager.isMultiplayerActive) {
                NetBroadcaster.setLatestLeaderboard({
                    totalAlive: totalAlive,
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

    // 視野スケーリング
    const effectiveSize = player.isDead ? 16 : player.size;
    const baseTargetScale = 60.0 / (60.0 + (effectiveSize - 12) * 0.85);
    const finalTargetScale = baseTargetScale * input.zoomMultiplier;
    cameraScale += (finalTargetScale - cameraScale) * 0.05;

    ctx.fillStyle = '#0b051a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing' || gameState === 'gameover') {
        const renderCamX = player.isDead ? spectatorCamX : player.x;
        const renderCamY = player.isDead ? spectatorCamY : player.y;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(cameraScale, cameraScale);
        ctx.translate(-renderCamX, -renderCamY);

        const viewW = canvas.width / cameraScale;
        const viewH = canvas.height / cameraScale;
        const cameraLeft = renderCamX - viewW / 2;
        const cameraTop = renderCamY - viewH / 2;

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
            if ((s === player && !player.isDead) || s.isVisible) {
                s.draw(ctx, frameCount, cameraScale);
            }
        }

        ctx.restore();

        const safeTop = PlatformDetector.inGravity ? SAFE_INSET_TOP_GRAVITY : SAFE_INSET_TOP_WEB;
        hud.drawRadar(ctx, canvas.width, safeTop, player.isDead ? { x: spectatorCamX, y: spectatorCamY, score: player.score } : player, sortedSnakes, cameraScale);
    }
}

bootSequence();