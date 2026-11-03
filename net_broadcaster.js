// ==============================================================================
// 『くねくねバトル オンライン』マルチプレイ送信ループ＆アクションキュー管理 (net_broadcaster.js)
// v28.0.0 ダミーAI空き枠偽装スロット適正化版:
// ・【ダミーAIの偽装解除バグ（CPU 95現象）を完全解決】
// 　ホストが空き枠ダミーAI（ID: 95〜100）の座標を送信する際、スロット番号を
// 　そのまま 100〜105 にするのではなく、IDから逆算して本来の空きプレイヤースロット
// 　（0〜5）へ偽装変換して送信。ゲスト画面で「CPU 95」と表示される不整合を根絶。
// ・【餌同期データ最優先保護】パケットサイズが1KBに近づいた際の段階的フォールバック維持
// ・【餌同期の絶対座標化】queueFoodPick のシグネチャを (x, y) で完全運用
// ・【データ蒸発完全根絶】25ms レートリミッター接触時も全未送信データを安全に先頭へ差し戻し
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
            l: [myTuple]
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
                        // ★ CPU 95 現象の完全修正
                        // 空き枠に補充されたダミーAI (ID: 95〜100) は、ゲスト側で人間プレイヤー枠 (0〜5) 
                        // として自然に偽装認識されるよう、スロット番号を対応するプレイヤー枠へ変換して送信する
                        if (ai.id > MAX_AIS) {
                            aiSlot = ai.id - MAX_AIS - 1; // 95 -> 0, 96 -> 1 ...
                        } else {
                            // 通常AI (ID: 1〜94) は スロット 6〜99 へマッピング
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

        const now = performance.now();
        // レートリミットによる送信スキップ時のキュー安全差し戻し
        if (now - this._lastSentTime < 25) {
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
                // 1. リーダーボード情報（lb）の削除（次回送信時に再送可能）
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
                // 5. 餌取得（pk）は同期破綻を防ぐため最後まで保持。万一それでも超える場合のみ半分退避
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