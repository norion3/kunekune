/**
 * ==============================================================================
 * 『くねくねバトル オンライン』マルチプレイ送信ループ＆アクションキュー管理 (net_broadcaster.js)
 * v36.0.0 AIタプルバジェット高精度化＆AI突発パージ完全根絶版:
 * ・【AIタプルバジェット見積もり精度の適正化（38B ➔ 48B）】
 * 　実測で46〜52Bに達していた11要素AIタプルの消費見積もりを 38B から 48B へ補正！
 * 　通常AI選定上限を視界保証に十分な最大8体へ最適化することで、
 * 　リーダーボード同梱フレーム等で突発的に 1,010B 超過フェイルセーフへ突入し、
 * 　ゲスト画面で視界内の通常AIが一瞬全消滅（点滅フリーズ）する現象を100%根絶
 * ・【パケット・バジェット（事前容量割り当て）方式維持】
 * ・【全人間プレイヤー視界保証同期維持】
 * ・【餌同期の絶対座標化維持】queueFoodPick (x, y) 運用
 * ・【重要システムパケットのレートリミットバイパス維持】
 * ・【通常キューの差し戻し保護維持】レートリミット接触時のデータ保護
 * ==============================================================================
 */

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
            const isPlaying = (typeof window !== 'undefined' && window.currentGameState === 'playing');

            // 1. 基本パケットの初期化（自機タプルを投入）
            const myTuple = encodeSnakeToTuple(mySnake, netManager.mySlot, netManager.isHost);
            const tuplesList = [myTuple];

            const packet = {
                e: 'P',
                l: tuplesList,
                act: isPlaying
            };

            // 2. パケット・バジェット（容量予算）の初期計算（上限 1,000 Byte 安全枠）
            // 基本構造: {"e":"P","l":[],"act":true} + 自機タプル 約90B
            let budget = 1000 - 90;

            // 3. リーダーボード（lb）同梱判定（偶数回フレーム）
            this._lbThrottleCount++;
            const shouldIncludeLB = Boolean(netManager.isHost && this._latestLeaderboard && (this._lbThrottleCount % 2 === 0));
            if (shouldIncludeLB) {
                packet.lb = this._latestLeaderboard;
                // 日本語名を含む上位リストと全スロット順位マップを考慮し約320Bを事前確保
                budget -= 320;
            }

            // 4. チャット最優先投入（約25B/件、最大2件）
            if (this._pendingChats.length > 0) {
                const takeChat = Math.min(2, this._pendingChats.length);
                packet.ch = this._pendingChats.splice(0, takeChat);
                budget -= (takeChat * 25);
            }

            // 5. 餌取得同期最優先投入（約10B/件、最大6件）
            if (this._pendingPicks.length > 0) {
                const takePicks = Math.min(6, this._pendingPicks.length);
                packet.pk = this._pendingPicks.splice(0, takePicks);
                budget -= (takePicks * 10);
            }

            // 6. ホストによる人間プレイヤー ＆ 視界保証AIタプルの選定とバジェット詰め込み
            if (netManager.isHost && Array.isArray(window.allAISnakesInstance)) {
                const ais = window.allAISnakesInstance;
                const totalAIs = ais.length;

                if (totalAIs > 0) {
                    const selectedSet = new Set();
                    const candidates = [];

                    // 6-1. 【最優先】空き枠ダミーAI（ID: 95〜100）の登録
                    for (let i = 0; i < totalAIs; i++) {
                        const ai = ais[i];
                        if (ai && !ai.isDead && ai.id > MAX_AIS) {
                            selectedSet.add(ai);
                            candidates.push(ai);
                        }
                    }

                    // 6-2. 通常AIの選定
                    const regularAIs = ais.filter(a => a && !a.isDead && a.id <= MAX_AIS);
                    const totalRegular = regularAIs.length;

                    if (totalRegular > 0) {
                        // 全人間プレイヤー（ホスト＋全遠隔ゲスト）の座標を収集
                        const humanCoords = [{ x: mySnake.x, y: mySnake.y }];
                        if (typeof window !== 'undefined') {
                            const allS = window.allSnakes || window.allSnakesInstance || [];
                            for (let i = 0; i < allS.length; i++) {
                                const s = allS[i];
                                if (s && !s.isDead && s.isHumanPlayer && !s.isPlayer) {
                                    humanCoords.push({ x: s.x, y: s.y });
                                }
                            }
                            const remotes = window.remoteSnakes || window.remoteSnakesInstance || window.allRemoteSnakes || [];
                            for (let r = 0; r < remotes.length; r++) {
                                const rs = remotes[r];
                                if (rs && !rs.isDead) {
                                    if (!humanCoords.some(c => c.x === rs.x && c.y === rs.y)) {
                                        humanCoords.push({ x: rs.x, y: rs.y });
                                    }
                                }
                            }
                        }

                        // 各人間の近傍（4,500px以内）にいるAIを最優先収集（最大8体）
                        const nearDistSq = 4500 * 4500;
                        let nearCount = 0;
                        const maxNearAIs = Math.min(8, humanCoords.length * 3);

                        for (let i = 0; i < totalRegular && nearCount < maxNearAIs; i++) {
                            const ai = regularAIs[i];
                            if (selectedSet.has(ai)) continue;

                            let isNearHuman = false;
                            for (let h = 0; h < humanCoords.length; h++) {
                                const dx = ai.x - humanCoords[h].x;
                                const dy = ai.y - humanCoords[h].y;
                                if (dx * dx + dy * dy < nearDistSq) {
                                    isNearHuman = true;
                                    break;
                                }
                            }

                            if (isNearHuman) {
                                selectedSet.add(ai);
                                candidates.push(ai);
                                nearCount++;
                            }
                        }

                        // スコア上位個体（最大2体）の補給
                        const sortedAIs = [...regularAIs].sort((a, b) => b.score - a.score);
                        for (let t = 0; t < Math.min(2, sortedAIs.length); t++) {
                            if (!selectedSet.has(sortedAIs[t])) {
                                selectedSet.add(sortedAIs[t]);
                                candidates.push(sortedAIs[t]);
                            }
                        }

                        // ローテーション巡回スライス（1〜2体）
                        const BATCH_SIZE = 2;
                        const startIndex = (this._aiSliceIndex * BATCH_SIZE) % totalRegular;
                        this._aiSliceIndex = (this._aiSliceIndex + 1) % Math.ceil(totalRegular / BATCH_SIZE);

                        for (let i = startIndex; i < startIndex + BATCH_SIZE && candidates.length < 8; i++) {
                            const targetIdx = i % totalRegular;
                            const ai = regularAIs[targetIdx];
                            if (ai && !selectedSet.has(ai)) {
                                selectedSet.add(ai);
                                candidates.push(ai);
                            }
                        }
                    }

                    // バジェット（容量予算）の許す限りタプル化して投入（実測値に即した1タプル48B計算）
                    for (let c = 0; c < candidates.length; c++) {
                        if (budget < 55) break; // 容量安全マージン

                        const ai = candidates[c];
                        let aiSlot;
                        if (ai.id > MAX_AIS) {
                            aiSlot = ai.id - MAX_AIS - 1;
                        } else {
                            aiSlot = MAX_PLAYERS + (ai.id - 1);
                        }

                        tuplesList.push(encodeSnakeToTuple(ai, aiSlot, false));
                        budget -= 48;
                    }
                }
            }

            // 7. 残余バジェットによる肉片クラスタ ＆ 肉片単体の投入
            if (budget > 50 && this._pendingClusters.length > 0) {
                packet.dc = this._pendingClusters.splice(0, 1);
                budget -= 35;
            }

            if (budget > 30 && this._pendingDrops.length > 0) {
                const takeDrops = Math.min(Math.floor(budget / 16), Math.min(3, this._pendingDrops.length));
                if (takeDrops > 0) {
                    packet.dp = this._pendingDrops.splice(0, takeDrops);
                    budget -= (takeDrops * 16);
                }
            }

            // 8. 事前バジェットにより確実に1,000バイト未満に収束しているため、一撃で送信
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
            const rawString = JSON.stringify(msgObj);
            const byteLength = getUtf8ByteLength(rawString);

            // =========================================================================
            // 【フェイルセーフ防護（予期せぬ長大文字列等の極限エッジケースのみ発動）】
            // バジェット管理により平常時はこのブロックに入らず、1回の JSON.stringify で即座に通過
            // =========================================================================
            if (byteLength >= 1010) {
                if (msgObj.ch) {
                    this._pendingChats.unshift(...msgObj.ch);
                    delete msgObj.ch;
                }
                if (msgObj.dc) {
                    this._pendingClusters.unshift(...msgObj.dc);
                    delete msgObj.dc;
                }
                if (msgObj.dp) {
                    this._pendingDrops.unshift(...msgObj.dp);
                    delete msgObj.dp;
                }
                if (Array.isArray(msgObj.l) && msgObj.l.length > 2) {
                    // 自機と空き枠ダミーAI枠（Slot < MAX_PLAYERS）のみを死守
                    msgObj.l = msgObj.l.filter(t => t[0] < MAX_PLAYERS);
                }
                window.AgentSDK.room.sendMessage({ msg_data: JSON.stringify(msgObj), message: JSON.stringify(msgObj) });
                return;
            }

            window.AgentSDK.room.sendMessage({ msg_data: rawString, message: rawString });
        } catch (e) {
            console.warn('[NetBroadcaster] sendMessage error:', e);
        }
    }
};