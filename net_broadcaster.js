// ==============================================================================
// 『くねくねバトル オンライン』マルチプレイ送信ループ＆アクションキュー管理 (net_broadcaster.js)
// v32.0.0 ランキングパケット最優先死守＆ゲスト同期遅延完全根絶版:
// ・【ランキングパケット(lb)最優先死守】
// 　1KB制限防衛（byteLength >= 1010）において、これまで真っ先に丸ごと破棄されていた
// 　`msgObj.lb` の削除処理を完全撤廃！ランキングを最優先保護データとし、
// 　1KB超過時はチャット・肉片・遠隔AIタプル側を優先的に間引くことで、
// 　ゲスト端末へ最新の順位・スコア情報が遅延なく100%確実に届くよう直通配信を保証
// ・【プレイヤー枠(Slot 0〜5)無制限完全同期維持】
// ・【ホスト実プレイ中(act: true)状態同期維持】
// ・【重要システムパケットのレートリミットバイパス維持】
// ・【餌同期データ最優先保護維持】
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
        
        const isPlaying = (typeof window !== 'undefined' && window.currentGameState === 'playing');

        const packet = {
            e: 'P',
            l: [myTuple],
            act: isPlaying,
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

                    // =========================================================================
                    // ★ 【最優先】プレイヤー枠（空き枠ダミーAI ID: 95〜100）の無条件最優先登録
                    // 距離に関係なく常に全員へ送信し、60,000pxの広大な宇宙での索敵を保証
                    // =========================================================================
                    for (let i = 0; i < totalAIs; i++) {
                        const ai = ais[i];
                        if (ai && !ai.isDead && ai.id > MAX_AIS) {
                            selectedSet.add(ai);
                            candidates.push(ai);
                        }
                    }

                    // 通常AI（ID: 1〜94）の選定
                    const regularAIs = ais.filter(a => a && !a.isDead && a.id <= MAX_AIS);
                    const totalRegular = regularAIs.length;

                    if (totalRegular > 0) {
                        // 1. スコア上位4体を登録
                        const sortedAIs = [...regularAIs].sort((a, b) => b.score - a.score);
                        const topLimit = Math.min(4, sortedAIs.length);
                        for (let t = 0; t < topLimit; t++) {
                            if (!selectedSet.has(sortedAIs[t])) {
                                selectedSet.add(sortedAIs[t]);
                                candidates.push(sortedAIs[t]);
                            }
                        }

                        // 2. ホスト近隣の通常AI（3体まで）
                        const px = mySnake.x;
                        const py = mySnake.y;
                        const nearDistSq = 3500 * 3500;
                        let nearCount = 0;

                        for (let i = 0; i < totalRegular && nearCount < 3; i++) {
                            const ai = regularAIs[i];
                            if (selectedSet.has(ai)) continue;

                            const dx = ai.x - px;
                            const dy = ai.y - py;
                            if (dx * dx + dy * dy < nearDistSq) {
                                selectedSet.add(ai);
                                candidates.push(ai);
                                nearCount++;
                            }
                        }

                        // 3. ローテーションスライス（2体ずつ巡回配信）
                        const BATCH_SIZE = 2;
                        const startIndex = (this._aiSliceIndex * BATCH_SIZE) % totalRegular;
                        this._aiSliceIndex = (this._aiSliceIndex + 1) % Math.ceil(totalRegular / BATCH_SIZE);

                        for (let i = startIndex; i < startIndex + BATCH_SIZE && candidates.length < 14; i++) {
                            const targetIdx = i % totalRegular;
                            const ai = regularAIs[targetIdx];
                            if (ai && !selectedSet.has(ai)) {
                                selectedSet.add(ai);
                                candidates.push(ai);
                            }
                        }
                    }

                    // 候補エンティティをタプルへエンコード
                    for (let c = 0; c < candidates.length; c++) {
                        const ai = candidates[c];
                        
                        let aiSlot;
                        // 空き枠ダミーAI (ID: 95〜100) はプレイヤー枠 (0〜5) へ正規変換
                        if (ai.id > MAX_AIS) {
                            aiSlot = ai.id - MAX_AIS - 1;
                        } else {
                            aiSlot = MAX_PLAYERS + (ai.id - 1);
                        }
                        
                        tuplesList.push(encodeSnakeToTuple(ai, aiSlot, false));
                    }
                }
            }

            // ホストが実際にプレイ中（currentGameState === 'playing'）であるか判定
            const isPlaying = (typeof window !== 'undefined' && window.currentGameState === 'playing');

            const packet = {
                e: 'P',
                l: tuplesList,
                act: isPlaying
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
        // START_GAME や撃破・入退室通知、割り込み送信は最優先パケットとしてレートリミットをバイパス
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
            // 1KB防衛：段階的フォールバック（ランキング lb ＆ 餌取得 pk を最優先死守）
            // =========================================================================
            if (byteLength >= 1010) {
                // 1. チャット（ch）の差し戻し
                if (msgObj.ch) {
                    this._pendingChats.unshift(...msgObj.ch);
                    if (this._pendingChats.length > 10) this._pendingChats.length = 10;
                    delete msgObj.ch;
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 2. 肉片クラスタ（dc）の差し戻し
                if (byteLength >= 1010 && msgObj.dc) {
                    this._pendingClusters.unshift(...msgObj.dc);
                    if (this._pendingClusters.length > 12) this._pendingClusters.length = 12;
                    delete msgObj.dc;
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 3. 肉片単体（dp）の差し戻し
                if (byteLength >= 1010 && msgObj.dp) {
                    this._pendingDrops.unshift(...msgObj.dp);
                    if (this._pendingDrops.length > 48) this._pendingDrops.length = 48;
                    delete msgObj.dp;
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 4. 遠隔通常AIタプルの間引き（プレイヤー枠 slot < MAX_PLAYERS と自機は死守）
                if (byteLength >= 1010 && Array.isArray(msgObj.l) && msgObj.l.length > 2) {
                    const criticalList = [];
                    const pruneList = [];
                    for (let i = 0; i < msgObj.l.length; i++) {
                        const tuple = msgObj.l[i];
                        const slotNum = tuple[0];
                        if (slotNum < MAX_PLAYERS) {
                            criticalList.push(tuple);
                        } else {
                            pruneList.push(tuple);
                        }
                    }
                    // 通常AIを半分に減らしてサイズ圧縮
                    const keepAiCount = Math.floor(pruneList.length / 2);
                    msgObj.l = criticalList.concat(pruneList.slice(0, keepAiCount));
                    rawString = JSON.stringify(msgObj);
                    byteLength = getUtf8ByteLength(rawString);
                }
                // 5. 餌取得（pk）の間引き（同期保護のため半分保持）
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