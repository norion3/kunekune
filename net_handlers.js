// ==============================================================================
// 『くねくねバトル オンライン』リモートパケット受信反映ハンドラ (net_handlers.js)
// v28.2.0 リモート死亡時肉片還元＆食物連鎖完全同期版:
// ・【リモート死亡時肉片還元】ゲストが自己判定で死亡（data.isDead && !remote.isDead）した際、
// 　ホストが即座に肉片クラスタ（queueDropCluster）を発行し、巨大スネーク撃破時の
// 　大量肉片が宇宙の塵として消滅するバグを完全解消。食物連鎖の下克上ループを確立
// ・【胴体シフトAPI完全統合】snake.js の公式カプセル化メソッド `shiftHistory(dx, dy)` を
// 　大距離ワープ補正時に直接採用。外部からの直接配列書き換えを根絶し、形状完全維持
// ・【ワープ閾値1000px適正化】400pxから1000px(distSq > 1000000)へ緩和し、通常ラグによる
// 　不要な瞬間移動や胴体消滅（点滅）を完全に解消
// ・【餌消去の絶対座標化】onFoodPicked で world.removeFoodAt(pick.x, pick.y) を実行し、
// 　通信ラグによるインデックスズレ・誤消去を完全根絶
// ・【ランキング再ソート】ゲスト端末自己補正後に topList.sort((a, b) => b.score - a.score) を実行し、
// 　順位表示とリスト表示順の矛盾を100%解消
// ・【スコア・名前即時反映】受信時に remote.score と recalculateSize() を確実に実行し、
// 　NetworkManager.slots の正規ネームで上書き
// ・【途中参加チラつき根絶】onGameStart で direct または immediate 合図を受信した際、
// 　isRespawn = true 扱いで初期化し他走者(remoteSnakes)クリアによる消滅・点滅を完全防止
// ・【無敵対称化】リモート無敵フラグ代入時の下限を 3.0秒 へ適正化し、
// 　ゲストがホスト判定で即爆死させられる非対称即死を完全根絶
// ・【無敵同期順序適正化】remote.reset() の直後に data.isInvulnerable を反映し意図せぬ上書きを解消
// ==============================================================================

import { Snake } from './snake.js';
import { NetworkManager } from './network.js';
import { SNAKE_COLORS, TOTAL_SNAKES } from './constants.js';

// ランキングDOM書き換えチラつき防止用シグネチャキャッシュ
let lastLeaderboardSignature = '';

/**
 * ネットワーク受信コールバックのセットアップ
 * @param {Object} ctx ゲーム世界の主要エンティティ参照およびゲーム始動関数
 */
export function setupNetworkHandlers(ctx) {
    const {
        remoteSnakes,
        allSnakes,
        getSortedSnakes,
        setSortedSnakes,
        world,
        initGame
    } = ctx;

    NetworkManager.setCallbacks({
        /**
         * ホストからのゲーム開始・直接参戦合図受信ハンドラ
         * ★ 途中参加時は isRespawn = true 扱いにして受信済み他プレイヤーの消去（点滅）を完全防止
         */
        onGameStart(packet) {
            const isMidJoin = Boolean(packet && (packet.direct || packet.immediate));
            if (typeof initGame === 'function') {
                initGame(isMidJoin);
            } else if (typeof window.initGameInstance === 'function') {
                window.initGameInstance(isMidJoin);
            }
        },

        /**
         * 他端末・リモート走者の位置・状態更新
         */
        onRemoteSnakeUpdate(data) {
            if (data.slot === NetworkManager.mySlot) return;

            let remote = remoteSnakes.get(data.slot);
            if (!remote) {
                const isPlayerSlot = data.slot < 6;
                const color = SNAKE_COLORS[data.slot % SNAKE_COLORS.length];
                const slotData = NetworkManager.slots[data.slot];
                const resolvedName = (slotData && slotData.name && !slotData.isAI) 
                    ? slotData.name 
                    : (isPlayerSlot ? `P${data.slot + 1}` : `CPU ${data.slot - 5}`);

                remote = new Snake(false, data.slot, resolvedName, color, 'normal');
                remote.reset(data.x, data.y);
                remoteSnakes.set(data.slot, remote);

                if (!allSnakes.includes(remote)) {
                    allSnakes.push(remote);
                    const currentSorted = getSortedSnakes();
                    if (!currentSorted.includes(remote)) {
                        currentSorted.push(remote);
                        setSortedSnakes(currentSorted);
                    }
                }
            }

            // ★ 名前同期保証：スロット情報に人間プレイヤー名が存在する場合、CPU名から即時上書き
            const curSlot = NetworkManager.slots[data.slot];
            if (curSlot && curSlot.name && !curSlot.isAI && remote.name !== curSlot.name) {
                remote.name = curSlot.name;
            }

            // =========================================================================
            // 1. ★ 胴体消滅・点滅の完全根絶（テレポート判定緩和＆公式 shiftHistory 適用）
            // =========================================================================
            const dx = data.x - remote.x;
            const dy = data.y - remote.y;
            const distSq = dx * dx + dy * dy;

            if (distSq > 1000000) {
                // 超大距離ワープ時（回線復旧や長距離リスポーン）：カプセル化されたAPIで安全に平行移動
                remote.shiftHistory(dx, dy);
                remote.x = data.x;
                remote.y = data.y;
            }

            // =========================================================================
            // 2. ★ リモート死亡時の肉片ドロップ還元＆リスポーン復帰処理
            // ゲストが自己判定で死亡した際、ホストが肉片クラスタを発行して食物連鎖を維持
            // =========================================================================
            if (data.isDead && !remote.isDead) {
                if (NetworkManager.isHost && NetworkManager.isMultiplayerActive) {
                    const colorIdx = SNAKE_COLORS.indexOf(remote.color);
                    const safeColorIdx = colorIdx >= 0 ? colorIdx : 0;
                    const dropCount = Math.min(30, Math.max(10, Math.floor((remote.historyLength || 16) / 2)));
                    const totalVal = Math.min(2500, Math.max(100, Math.floor(remote.score * 0.25)));

                    NetworkManager.queueDropCluster(
                        remote.x,
                        remote.y,
                        totalVal,
                        dropCount,
                        safeColorIdx
                    );
                }
                remote.die();
            } else if (!data.isDead && remote.isDead) {
                remote.isDead = false;
                remote.reset(data.x, data.y);
            }

            // 3. リモート無敵フラグの完全代入（reset() の直後に実行し、ゲスト本来の3.0秒無敵と完全同期）
            if (data.isInvulnerable) {
                remote.invulnerableTimer = Math.max(remote.invulnerableTimer || 0, 3.0);
            } else if (!data.isInvulnerable && remote.invulnerableTimer > 0) {
                remote.invulnerableTimer = 0;
            }

            remote.targetNetX = data.x;
            remote.targetNetY = data.y;
            remote.targetAngle = data.angle;
            remote.speed = data.speed;
            remote.targetLength = data.length;

            // スコア確実同期：スコア更新と体長・サイズ再計算を同時に実施
            remote.score = data.score;
            remote.recalculateSize();

            remote.isBoosting = data.isBoosting;
            remote.kills = data.kills;
            remote.lastPacketTime = performance.now();
        },

        /**
         * ホストから受信した全体リーダーボード情報をゲスト端末へ同期
         * 自機実スコア・自機名による即時補正＆再ソートを完備
         */
        onLeaderboardSync(lbData) {
            if (!lbData) return;
            const myPlayer = window.localPlayerInstance;
            const myScore = myPlayer ? Math.floor(myPlayer.score) : 0;
            const myName = (myPlayer && myPlayer.name) ? myPlayer.name : 'あなた';
            const rawTopList = lbData.top || [];
            const totalAlive = lbData.totalAlive || TOTAL_SNAKES;

            // ゲスト端末側での自己情報補正：ホスト集計リスト内の自機スコア・名前を最新の実データに更新
            let hasMeInTop = false;
            const topList = rawTopList.map(item => {
                if (item.slot === NetworkManager.mySlot) {
                    hasMeInTop = true;
                    return {
                        slot: item.slot,
                        name: myName,
                        score: myScore
                    };
                }
                return item;
            });

            // スコア補正後に再度スコア降順で並び替え（順位と表示位置のズレを解消）
            topList.sort((a, b) => b.score - a.score);

            // ホストから全スロット確定順位マップが届いている場合は最優先
            let myRank = 1;
            if (lbData.ranks && lbData.ranks[NetworkManager.mySlot] !== undefined) {
                myRank = lbData.ranks[NetworkManager.mySlot];
            } else if (lbData.myRank) {
                myRank = lbData.myRank;
            } else {
                // フォールバック：全スネークリストまたはTopリストとの比較
                const higherCount = topList.filter(item => item.score > myScore).length;
                myRank = higherCount + 1;
            }

            const valRank = document.getElementById('val-rank');
            const valTotal = document.getElementById('val-total');
            if (valRank) valRank.innerText = myRank;
            if (valTotal) valTotal.innerText = totalAlive;

            // 差分検知シグネチャ（名前・スコア・順位の文字列化）
            const newSignature = topList.slice(0, 8).map(item => `${item.name}:${item.score}`).join('|') + `_me:${myScore}_rank:${myRank}`;
            if (newSignature === lastLeaderboardSignature) {
                return;
            }
            lastLeaderboardSignature = newSignature;

            const listEl = document.getElementById('leaderboard-list');
            if (listEl && listEl.parentElement && listEl.parentElement.style.display !== 'none') {
                listEl.innerHTML = topList.slice(0, 8).map((item, idx) => {
                    const isMe = item.slot === NetworkManager.mySlot;
                    return `
                        <div style="display:flex; justify-content:space-between; color:${isMe ? '#ffdd00' : '#ffffff'}; font-weight:${isMe ? 'bold' : 'normal'}; font-size:12px;">
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:85px;">${idx + 1}. ${item.name}</span>
                            <span>${Math.floor(item.score)}</span>
                        </div>
                    `;
                }).join('');
            }
        },

        /**
         * 餌取得イベント（絶対座標による安全消去）
         */
        onFoodPicked(pick) {
            if (!world || typeof world.removeFoodAt !== 'function' || !pick) return;
            world.removeFoodAt(pick.x, pick.y);
        },

        /**
         * 肉片ドロップ散布イベント（撃破時に他端末で発生した肉片の生成）
         */
        onDropSpawned(drop) {
            if (!world || !world.dropFoods) return;
            world.dropFoods.push({
                x: drop.x,
                y: drop.y,
                val: drop.val,
                size: 7,
                isBig: true,
                color: SNAKE_COLORS[drop.colorIdx % SNAKE_COLORS.length]
            });
        },

        /**
         * 撃破肉片クラスタ受信ハンドラ
         */
        onDropClusterSpawned(cluster) {
            if (!world || !world.dropFoods || !Array.isArray(cluster)) return;
            const cx = cluster[0];
            const cy = cluster[1];
            const totalVal = cluster[2] || 100;
            const count = cluster[3] || 15;
            const colorIdx = cluster[4] || 0;
            const valPerDrop = Math.max(10, Math.floor(totalVal / count));
            const color = SNAKE_COLORS[colorIdx % SNAKE_COLORS.length];

            for (let i = 0; i < count; i++) {
                const ang = (i / count) * Math.PI * 2;
                const dist = Math.random() * 45;
                world.dropFoods.push({
                    x: cx + Math.cos(ang) * dist,
                    y: cy + Math.sin(ang) * dist,
                    val: valPerDrop,
                    size: 7,
                    isBig: true,
                    color: color
                });
            }
        },

        /**
         * ワールドシード同期
         */
        onSeedReceived(seed) {
            if (world) {
                world.clear();
            }
        }
    });
}