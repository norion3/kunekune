// ==============================================================================
// 『くねくねバトル オンライン』マルチプレイ送信ループ＆アクションキュー管理 (net_broadcaster.js)
// v21.3.0 完全分離モジュール版:
// ・10Hzブロードキャスト送信ループの独立管理
// ・アクション蓄積キュー（餌取得・散布肉片・撃破クラスタ・チャット）の専任管理
// ・ホスト端末におけるAI46体のスライスマネージメント（平常時約500バイトに圧縮）
// ・1024バイト上限厳格ガード（超過データ自動切り離し送出）
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

            // ホスト端末の場合：管理下のAIスネーク46体を1回あたり10体にスマート縮小送出
            if (netManager.isHost && Array.isArray(window.allAISnakesInstance)) {
                const ais = window.allAISnakesInstance;
                const BATCH_SIZE = 10;
                const startIndex = (this._aiSliceIndex * BATCH_SIZE) % ais.length;
                this._aiSliceIndex = (this._aiSliceIndex + 1) % 5;

                for (let i = startIndex; i < startIndex + BATCH_SIZE && i < ais.length; i++) {
                    const ai = ais[i];
                    if (ai && !ai.isDead) {
                        const aiTuple = encodeSnakeToTuple(ai, 4 + i, false);
                        tuplesList.push(aiTuple);
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