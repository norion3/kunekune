// ==============================================================================
// 『くねくねバトル オンライン』マルチプレイ送信ループ＆アクションキュー管理 (net_broadcaster.js)
// v29.0.0 重要システムパケット優先送信＆レートリミットバイパス完全保証版:
// ・【重要システムパケットのレートリミットバイパス】
// 　START_GAME、KILL_ALERT、SYS_ALERT 等のルーム遷移・重要イベントパケットは、
// 　25ms レートリミッターを完全バイパス（無条件即時送信）。定期送信の直後（25ms以内）に
// 　ホストが「ゲーム開始」を押しても、パケットが破棄（蒸発）される不具合を完全根絶！
// ・【ダミーAI空き枠偽装スロット適正化維持】CPU 95 現象の完全根絶
// ・【餌同期データ最優先保護維持】1KB境界時の段階的フォールバック
// ・【餌同期の絶対座標化維持】queueFoodPick (x, y) 運用
// ・【通常キューの差し戻し保護維持】レートリミット接触時のデータ保護
// ==============================================================================

import {
    round1,
    getUtf8ByteLength,
    encodeSnakeToTuple,
    packFoodPickTuple,
    packDropFoodTuple,
    packChatTuple
} from './net_protocol.js';

import { MAX_PLAYERS, MAX_AIS } from './constants.js';

export const NetBroadcaster = {
    _syncIntervalId: null,
    _aiSliceIndex: 0,
    _latestLeaderboard: null,
    _lbThrottleCount: 0,
    _lastSentTime: 0,

    _pendingPicks: [],
    _pendingDrops: [],
    _pendingClusters: [],
    _pendingChats: [],

    setLatestLeaderboard(lbData) {
        this._latestLeaderboard = lbData;
    },

    // 餌取得のキューイング（絶対座標 x, y）
    queueFoodPick(x, y) {
        this._pendingPicks.push(packFoodPickTuple(x, y));
        if (this._pendingPicks.length > 64) this._pendingPicks.length = 64;
    },

    queueDropFood(x, y, val, colorIdx) {
        this._pendingDrops.push(packDropFoodTuple(x, y, val, colorIdx));
        if (this._pendingDrops.length > 48) this._pendingDrops.length = 48;
    },

    queueDropCluster(x, y, totalVal, count, colorIdx) {
        this._pendingClusters.push([
            round1(x),
            round1(y),
            Math.floor(totalVal),
            Math.floor(count),
            colorIdx
        ]);
        if (this._pendingClusters.length > 12) this._pendingClusters.length = 12;
    },

    queueChat(slot, text) {
        this._pendingChats.push(packChatTuple(slot, text));
        if (this._pendingChats.length > 10) this._pendingChats.length = 10;
    },

    forceImmediateSync(netManager) {
        if (!netManager.isMultiplayerActive || !netManager.isSDKAvailable) return;
        if (typeof window.localPlayerInstance === 'undefined' || !window.localPlayerInstance) return;

        const mySnake = window.localPlayerInstance;
        const myTuple = encodeSnakeToTuple(mySnake, netManager.mySlot, netManager.isHost);
        
        const packet = {
            e: 'P',
            l: [myTuple],
            immediate: true
        };

        this.sendCustomMessage(packet);
    },

    start(netManager) {
        this.stop();

        this._syncIntervalId = setInterval(() => {
            if (!netManager.isMultiplayerActive || !netManager.isSDKAvailable) return;
            if (typeof window.localPlayerInstance === 'undefined' || !window.localPlayerInstance) return;

            const mySnake = window.localPlayerInstance;
            const myTuple = encodeSnakeToTuple(mySnake, netManager.mySlot, netManager.isHost);
            const tuplesList = [myTuple];

            if (netManager.isHost && Array.isArray(window.allAISnakesInstance)) {
                const ais = window.allAISnakesInstance;
                const totalAIs = ais.length;

                if (totalAIs > 0) {
                    const selectedSet = new Set();
                    const candidates = [];

                    const sortedAIs = [...ais].filter(a => a && !a.isDead).sort((a, b) => b.score - a.score);
                    const topLimit = Math.min(4, sortedAIs.length);
                    for (let t = 0; t < topLimit; t++) {
                        selectedSet.add(sortedAIs[t]);
                        candidates.push(sortedAIs[t]);
                    }

                    const px = mySnake.x;
                    const py = mySnake.y;
                    const nearDistSq = 3500 * 3500;
                    let nearCount = 0;

                    for (let i = 0; i < totalAIs && nearCount < 3; i++) {
                        const ai = ais[i];
                        if (!ai || ai.isDead || selectedSet.has(ai)) continue;

                        const dx = ai.x - px;
                        const dy = ai.y - py;
                        if (dx * dx + dy * dy < nearDistSq) {
                            selectedSet.add(ai);
                            candidates.push(ai);
                            nearCount++;
                        }
                    }

                    const BATCH_SIZE = 2;
                    const startIndex = (this._aiSliceIndex * BATCH_SIZE) % totalAIs;
                    this._aiSliceIndex = (this._aiSliceIndex + 1) % Math.ceil(totalAIs / BATCH_SIZE);

                    for (let i = startIndex; i < startIndex + BATCH_SIZE && candidates.length < 8; i++) {
                        const targetIdx = i % totalAIs;
                        const ai = ais[targetIdx];
                        if (ai && !ai.isDead && !selectedSet.has(ai)) {
                            selectedSet.add(ai);
                            candidates.push(ai);
                        }
                    }

                    for (let c = 0; c < candidates.length; c++) {
                        const ai = candidates[c];
                        
                        let aiSlot;
                        // 空き枠ダミーAI (ID: 95〜100) はプレイヤー枠 (0〜5) へ変換して送信
                        if (ai.id > MAX_AIS) {
                            aiSlot = ai.id - MAX_AIS - 1;
                        } else {
                            aiSlot = MAX_PLAYERS + (ai.id - 1);
                        }
                        
                        tuplesList.push(encodeSnakeToTuple(ai, aiSlot, false));
                    }
                }
            }

            const packet = {
                e: 'P',
                l: tuplesList
            };

            this._lbThrottleCount++;
            if (netManager.isHost && this._latestLeaderboard && (this._lbThrottleCount % 2 === 0)) {
                packet.lb = this._latestLeaderboard;
            }

            if (this._pendingChats.length > 0) {
                packet.ch = this._pendingChats.splice(0, 3);
            }

            if (this._pendingPicks.length > 0) {
                packet.pk = this._pendingPicks.splice(0, 8);
            }

            if (this._pendingDrops.length > 0) {
                packet.dp = this._pendingDrops.splice(0, 6);
            }

            if (this._pendingClusters.length > 0) {
                packet.dc = this._pendingClusters.splice(0, 2);
            }

            this.sendCustomMessage(packet);
        }, 100);
    },

    stop() {
        if (this._syncIntervalId) {
            clearInterval(this._syncIntervalId);
            this._syncIntervalId = null;
        }
    },

    purge() {
        this.stop();
        this._aiSliceIndex = 0;
        this._lbThrottleCount = 0;
        this._lastSentTime = 0;
        this._pendingPicks.length = 0;
        this._pendingDrops.length = 0;
        this._pendingClusters.length = 0;
        this._pendingChats.length = 0;
    },

    sendCustomMessage(msgObj) {
        if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room || typeof window.AgentSDK.room.sendMessage !== 'function') return;

        const eventType = msgObj ? (msgObj.e || msgObj.event) : '';
        // ★ START_GAME や撃破・入退室通知、割り込み送信は最優先パケットとしてレートリミットをバイパス
        const isPriorityPacket = Boolean(
            eventType === 'START_GAME' ||
            eventType === 'KILL_ALERT' ||
            eventType === 'SYS_ALERT' ||
            eventType === 'ROOM_MEMBERS_SYNC' ||
            (msgObj && msgObj.immediate)
        );

        const now = performance.now();

        // 通常パケット（定期座標更新等）のみ 25ms レートリミットを適用
        if (!isPriorityPacket && (now - this._lastSentTime < 25)) {
            if (Array.isArray(msgObj.pk) && msgObj.pk.length > 0) {
                this._pendingPicks.unshift(...msgObj.pk);
                if (this._pendingPicks.length > 64) this._pendingPicks.length = 64;
            }
            if (Array.isArray(msgObj.dp) && msgObj.dp.length > 0) {
                this._pendingDrops.unshift(...msgObj.dp);
                if (this._pendingDrops.length > 48) this._pendingDrops.length = 48;
            }
            if (Array.isArray(msgObj.dc) && msgObj.dc.length > 0) {
                this._pendingClusters.unshift(...msgObj.dc);
                if (this._pendingClusters.length > 12) this._pendingClusters.length = 12;
            }
            if (Array.isArray(msgObj.ch) && msgObj.ch.length > 0) {
                this._pendingChats.unshift(...msgObj.ch);
                if (this._pendingChats.length > 10) this._pendingChats.length = 10;
            }
            return;
        }
        this._lastSentTime = now;

        try {
            let rawString = JSON.stringify(msgObj);
            let byteLength = getUtf8ByteLength(rawString);

            // =========================================================================
            // 1KB防衛：段階的フォールバック（餌取得データ pk を最優先死守）
            // =========================================================================
            if (byteLength >= 1010) {
                // 1. リーダーボード情報（lb）の削除
                if (msgObj.lb) {
                    delete msgObj.lb;
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 2. チャット（ch）の差し戻し
                if (byteLength >= 1010 && msgObj.ch) {
                    this._pendingChats.unshift(...msgObj.ch);
                    if (this._pendingChats.length > 10) this._pendingChats.length = 10;
                    delete msgObj.ch;
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 3. 肉片クラスタ（dc）の差し戻し
                if (byteLength >= 1010 && msgObj.dc) {
                    this._pendingClusters.unshift(...msgObj.dc);
                    if (this._pendingClusters.length > 12) this._pendingClusters.length = 12;
                    delete msgObj.dc;
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 4. 肉片単体（dp）の差し戻し
                if (byteLength >= 1010 && msgObj.dp) {
                    this._pendingDrops.unshift(...msgObj.dp);
                    if (this._pendingDrops.length > 48) this._pendingDrops.length = 48;
                    delete msgObj.dp;
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 5. 餌取得（pk）は同期破綻を防ぐため最後まで保持
                if (byteLength >= 1010 && Array.isArray(msgObj.pk) && msgObj.pk.length > 2) {
                    const keepCount = Math.floor(msgObj.pk.length / 2);
                    const overflow = msgObj.pk.splice(keepCount);
                    this._pendingPicks.unshift(...overflow);
                    if (this._pendingPicks.length > 64) this._pendingPicks.length = 64;
                    rawString = JSON.stringify(msgObj);
                }
            }

            window.AgentSDK.room.sendMessage({ msg_data: rawString, message: rawString });
        } catch (e) {
            console.warn('[NetBroadcaster] sendMessage error:', e);
        }
    }
};