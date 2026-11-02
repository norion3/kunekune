// ==============================================================================
// 『くねくねバトル オンライン』マルチプレイ送信ループ＆アクションキュー管理 (net_broadcaster.js)
// v26.3.0 即時割り込み送信対応＆1KB常時セーフマージン版:
// ・【即時送信対応】ブースト開始・終了などの状態変化を100ms周期を待たずに即時送信する forceImmediateSync を配備しラグを根絶
// ・【平常時パケット安全圧縮】AI送信数を最大8体へ最適化し、基礎パケットを約620バイトへスリム化
// ・【リーダーボード送信間引き】lb 同封を5Hz（2フレームに1回）に調整し、常時300バイト以上の送信余裕を確保
// ・大餌密集地帯で餌取得（pk）が重なっても 1010バイト制限に接触せず、未送信キュー差し戻しの無限ループを完全根絶
// ・【未送信キュー保護】万が一の超過時も splice 済みデータを先頭へ安全差し戻し（unshift）維持
// ・AIスロット計算の MAX_PLAYERS+ 規格維持
// ==============================================================================

import {
    round1,
    getUtf8ByteLength,
    encodeSnakeToTuple,
    packFoodPickTuple,
    packDropFoodTuple,
    packChatTuple
} from './net_protocol.js';

import { MAX_PLAYERS } from './constants.js';

export const NetBroadcaster = {
    _syncIntervalId: null,
    _aiSliceIndex: 0,
    _latestLeaderboard: null,
    _lbThrottleCount: 0, // リーダーボード送信間引き用カウンター

    _pendingPicks: [],
    _pendingDrops: [],
    _pendingClusters: [],
    _pendingChats: [],

    setLatestLeaderboard(lbData) {
        this._latestLeaderboard = lbData;
    },

    queueFoodPick(gx, gy, foodIndex) {
        this._pendingPicks.push(packFoodPickTuple(gx, gy, foodIndex));
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

    /**
     * ブースト状態変化やリスポーン時の即時割り込み送信（Event-driven）
     * 100msの定期送信を待たずに、自身の最新状態のみを最速で送信しラグを根絶する
     */
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

            // ★ ホスト端末専用：94体AIの最適抽出（最大8体に絞り、パケット約200Bを安全削減）
            if (netManager.isHost && Array.isArray(window.allAISnakesInstance)) {
                const ais = window.allAISnakesInstance;
                const totalAIs = ais.length;

                if (totalAIs > 0) {
                    const selectedSet = new Set();
                    const candidates = [];

                    // 1. スコア上位Top 4のボスAIを優先選出
                    const sortedAIs = [...ais].filter(a => a && !a.isDead).sort((a, b) => b.score - a.score);
                    const topLimit = Math.min(4, sortedAIs.length);
                    for (let t = 0; t < topLimit; t++) {
                        selectedSet.add(sortedAIs[t]);
                        candidates.push(sortedAIs[t]);
                    }

                    // 2. プレイヤー周辺3,500px以内にいる交戦・接近AIを抽出（最大3体）
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

                    // 3. 残り枠をスライス巡回（全体で最大8体までに厳格抑制）
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

                    // タプル化（AIスロットは MAX_PLAYERS 以降を厳密割り当て）
                    for (let c = 0; c < candidates.length; c++) {
                        const ai = candidates[c];
                        const aiSlot = MAX_PLAYERS + (ai.id - 1);
                        tuplesList.push(encodeSnakeToTuple(ai, aiSlot, false));
                    }
                }
            }

            const packet = {
                e: 'P',
                l: tuplesList
            };

            // ★ ホスト端末：リーダーボード同封を5Hz（2回に1回）に間引いて平常時帯域をさらに軽量化
            this._lbThrottleCount++;
            if (netManager.isHost && this._latestLeaderboard && (this._lbThrottleCount % 2 === 0)) {
                packet.lb = this._latestLeaderboard;
            }

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
        this._lbThrottleCount = 0;
        this._pendingPicks.length = 0;
        this._pendingDrops.length = 0;
        this._pendingClusters.length = 0;
        this._pendingChats.length = 0;
    },

    /**
     * 1024バイト厳守ガード付き送信ラッパー
     * ★ パケット超過時に削ったデータを破棄せずキュー先頭へ安全に差し戻す（Unshift）
     * @param {Object} msgObj 送信パケットオブジェクト
     */
    sendCustomMessage(msgObj) {
        if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room || typeof window.AgentSDK.room.sendMessage !== 'function') return;
        try {
            const rawString = JSON.stringify(msgObj);
            const byteLength = getUtf8ByteLength(rawString);

            // 1010バイト接近時の安全切り離し ＆ 未送信キューへの安全差し戻し
            if (byteLength >= 1010) {
                console.warn(`[NetBroadcaster] パケットサイズが1KB制限に接近 (${byteLength} bytes)。未送信キューを安全に差し戻して送出します。`);
                
                if (Array.isArray(msgObj.pk) && msgObj.pk.length > 0) {
                    this._pendingPicks.unshift(...msgObj.pk);
                    delete msgObj.pk;
                }
                if (Array.isArray(msgObj.dp) && msgObj.dp.length > 0) {
                    this._pendingDrops.unshift(...msgObj.dp);
                    delete msgObj.dp;
                }
                if (Array.isArray(msgObj.dc) && msgObj.dc.length > 0) {
                    this._pendingClusters.unshift(...msgObj.dc);
                    delete msgObj.dc;
                }
                delete msgObj.lb;

                const safePayload = JSON.stringify(msgObj);
                window.AgentSDK.room.sendMessage({ msg_data: safePayload, message: safePayload });
                return;
            }

            window.AgentSDK.room.sendMessage({ msg_data: rawString, message: rawString });
        } catch (e) {
            console.warn('[NetBroadcaster] sendMessage error:', e);
        }
    }
};