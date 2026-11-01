// ==============================================================================
// 『くねくねバトル オンライン』マルチプレイ送信ループ＆アクションキュー管理 (net_broadcaster.js)
// v23.0.0 100体AI対応 3層インテリジェントLoD通信＆1KB防衛版:
// ・10Hzブロードキャスト送信ループの独立管理
// ・アクション蓄積キュー（餌取得・散布肉片・撃破クラスタ・チャット）の専任管理
// ・最大96体AI対応：スコア上位Top 5ボス ＋ プレイヤー近接AIを動的抽出して送信
// ・非同期・遠隔AIの送信間引きにより、100体規模でも平常時パケットを約450〜550バイトに圧縮
// ・1024バイト上限厳格ガード（1010バイト接近時の超過データ自動切り離し送出）
// ==============================================================================

import {
    round1,
    getUtf8ByteLength,
    encodeSnakeToTuple,
    packFoodPickTuple,
    packDropFoodTuple,
    packChatTuple
} from './net_protocol.js';

export const NetBroadcaster = {
    _syncIntervalId: null,
    _aiSliceIndex: 0,

    _pendingPicks: [],
    _pendingDrops: [],
    _pendingClusters: [],
    _pendingChats: [],

    queueFoodPick(gx, gy, foodIndex) {
        this._pendingPicks.push(packFoodPickTuple(gx, gy, foodIndex));
    },

    queueDropFood(x, y, val, colorIdx) {
        this._pendingDrops.push(packDropFoodTuple(x, y, val, colorIdx));
    },

    queueDropCluster(x, y, totalVal, count, colorIdx) {
        this._pendingClusters.push([
            round1(x),
            round1(y),
            Math.floor(totalVal),
            Math.floor(count),
            colorIdx
        ]);
    },

    queueChat(slot, text) {
        this._pendingChats.push(packChatTuple(slot, text));
    },

    /**
     * 10Hz（100ms周期）定期ブロードキャストループの開始
     * @param {Object} netManager NetworkManager インスタンス参照
     */
    start(netManager) {
        this.stop();

        this._syncIntervalId = setInterval(() => {
            if (!netManager.isMultiplayerActive || !netManager.isSDKAvailable) return;
            if (typeof window.localPlayerInstance === 'undefined' || !window.localPlayerInstance) return;

            const mySnake = window.localPlayerInstance;
            const myTuple = encodeSnakeToTuple(mySnake, netManager.mySlot, netManager.isHost);
            const tuplesList = [myTuple];

            // ★ ホスト端末専用：96体AIの3層インテリジェントLoD抽出送出
            if (netManager.isHost && Array.isArray(window.allAISnakesInstance)) {
                const ais = window.allAISnakesInstance;
                const totalAIs = ais.length;

                if (totalAIs > 0) {
                    const selectedSet = new Set();
                    const candidates = [];

                    // 1. スコア上位Top 5のボスAIを優先選出（マップ全体の覇者として全端末同期）
                    const sortedAIs = [...ais].filter(a => a && !a.isDead).sort((a, b) => b.score - a.score);
                    const topLimit = Math.min(5, sortedAIs.length);
                    for (let t = 0; t < topLimit; t++) {
                        selectedSet.add(sortedAIs[t]);
                        candidates.push(sortedAIs[t]);
                    }

                    // 2. プレイヤー周辺3,500px以内にいる交戦・接近AIを抽出（最大4体）
                    const px = mySnake.x;
                    const py = mySnake.y;
                    const nearDistSq = 3500 * 3500;
                    let nearCount = 0;

                    for (let i = 0; i < totalAIs && nearCount < 4; i++) {
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

                    // 3. 残り枠を全体スライス（ローテーション）で巡回補完（合計最大12体までに制限）
                    const BATCH_SIZE = 4;
                    const startIndex = (this._aiSliceIndex * BATCH_SIZE) % totalAIs;
                    this._aiSliceIndex = (this._aiSliceIndex + 1) % Math.ceil(totalAIs / BATCH_SIZE);

                    for (let i = startIndex; i < startIndex + BATCH_SIZE && candidates.length < 12; i++) {
                        const targetIdx = i % totalAIs;
                        const ai = ais[targetIdx];
                        if (ai && !ai.isDead && !selectedSet.has(ai)) {
                            selectedSet.add(ai);
                            candidates.push(ai);
                        }
                    }

                    // タプル化（1体あたり約32バイト × 最大12体 ＝ 約380バイト）
                    for (let c = 0; c < candidates.length; c++) {
                        const ai = candidates[c];
                        const aiSlot = 4 + (ai.id - 1); // 人間4名以降のスロット
                        tuplesList.push(encodeSnakeToTuple(ai, aiSlot, false));
                    }
                }
            }

            const packet = {
                e: 'P',
                l: tuplesList
            };

            // チャットの同封
            if (this._pendingChats.length > 0) {
                packet.ch = this._pendingChats.splice(0, 3);
            }

            // 餌取得の同封
            if (this._pendingPicks.length > 0) {
                packet.pk = this._pendingPicks.splice(0, 8);
            }

            // 単発散布肉片の同封
            if (this._pendingDrops.length > 0) {
                packet.dp = this._pendingDrops.splice(0, 6);
            }

            // 撃破肉片クラスタの同封
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
        this._pendingPicks.length = 0;
        this._pendingDrops.length = 0;
        this._pendingClusters.length = 0;
        this._pendingChats.length = 0;
    },

    /**
     * 1024バイト厳守ガード付き送信ラッパー
     * @param {Object} msgObj 送信パケットオブジェクト
     */
    sendCustomMessage(msgObj) {
        if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room || typeof window.AgentSDK.room.sendMessage !== 'function') return;
        try {
            const rawString = JSON.stringify(msgObj);
            const byteLength = getUtf8ByteLength(rawString);

            // 1010バイト接近時の安全切り離しガード
            if (byteLength >= 1010) {
                console.warn(`[NetBroadcaster] パケットサイズが1KB制限に接近 (${byteLength} bytes)。過剰データを切り離して送出します。`);
                delete msgObj.dp;
                delete msgObj.pk;
                delete msgObj.dc;
                window.AgentSDK.room.sendMessage({ message: JSON.stringify(msgObj) });
                return;
            }

            window.AgentSDK.room.sendMessage({ message: rawString });
        } catch (e) {
            console.warn('[NetBroadcaster] sendMessage error:', e);
        }
    }
};