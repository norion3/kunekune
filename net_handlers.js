// ==============================================================================
// 『くねくねバトル オンライン』リモートパケット受信反映ハンドラ (net_handlers.js)
// v26.4.0 途中参加チラつき解消＆無敵時間3秒対称化版:
// ・【途中参加チラつき根絶】onGameStart で direct または immediate 合図を受信した際、isRespawn = true 扱いで初期化し他走者(remoteSnakes)クリアによる消滅・点滅を完全防止
// ・【無敵対称化】リモート無敵フラグ代入時の下限を 0.5秒 から 3.0秒 へ適正化し、ゲストがホスト判定で即爆死させられる非対称即死を完全根絶
// ・【無敵同期順序適正化】remote.reset() の直後に data.isInvulnerable を反映し、意図せぬ上書きを完全解消
// ・【ワープ直線根絶】回線瞬断やリスポーン時の大距離テレポート検知（distSq > 160000）でバッファを即時リセット
// ・ホスト確定の全スロット順位マップ（lbData.ranks）から自機順位を直接取得し9位固定を根絶維持
// ・ゲスト端末のランキングチラつき（点滅）をシグネチャ差分ガードで完全根絶
// ・餌捕食イベント (pk) ＆ 撃破肉片クラスタ散布 (dc) の世界反映
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
                const name = slotData ? slotData.name : (isPlayerSlot ? `P${data.slot + 1}` : `CPU ${data.slot - 5}`);

                remote = new Snake(false, data.slot, name, color, 'normal');
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

            // ★ 1. テレポート検知＆ワープ直線根絶（生存したまま回線瞬断・再合流した時のゴム線防止）
            const dx = data.x - remote.x;
            const dy = data.y - remote.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > 160000) {
                // 400px以上の瞬間移動時は古いリングバッファを破棄して新座標へ瞬時にリセット
                remote.reset(data.x, data.y);
            }

            // ★ 2. ホスト確定フラグに基づくリモート死亡＆リスポーン復帰処理
            if (data.isDead && !remote.isDead) {
                remote.die();
            } else if (!data.isDead && remote.isDead) {
                // 死亡状態からのリスポーン復帰：リングバッファ初期化
                remote.isDead = false;
                remote.reset(data.x, data.y);
            }

            // ★ 3. リモート無敵フラグの完全代入（reset() の直後に実行し、ゲスト本来の3.0秒無敵と完全同期）
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
            remote.score = data.score;
            remote.isBoosting = data.isBoosting;

            remote.kills = data.kills;
            remote.lastPacketTime = performance.now();
            remote.recalculateSize();
        },

        /**
         * ★ ホストから受信した全体リーダーボード情報をゲスト端末へ同期
         * ホスト確定順位マップ（lbData.ranks）から自機正規順位を取得（9位固定バグ完全解消）
         */
        onLeaderboardSync(lbData) {
            if (!lbData) return;
            const myPlayer = window.localPlayerInstance;
            const myScore = myPlayer ? myPlayer.score : 0;
            const topList = lbData.top || [];
            const totalAlive = lbData.totalAlive || TOTAL_SNAKES;

            // ゲスト端末の自機正規順位算出：
            // 1. ホストから全スロット順位マップ（ranks）が提供されている場合はそれを最優先使用
            // 2. 単独 myRank があればそれを使用
            // 3. なければ Top 8 リストからのフォールバック
            let myRank = 1;
            if (lbData.ranks && lbData.ranks[NetworkManager.mySlot] !== undefined) {
                myRank = lbData.ranks[NetworkManager.mySlot];
            } else if (lbData.myRank) {
                myRank = lbData.myRank;
            } else {
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
                return; // 変化がなければDOM書き換えを行わない（点滅完全防止）
            }
            lastLeaderboardSignature = newSignature;

            const listEl = document.getElementById('leaderboard-list');
            if (listEl && listEl.parentElement && listEl.parentElement.style.display !== 'none') {
                listEl.innerHTML = topList.slice(0, 8).map((item, idx) => {
                    const isMe = myPlayer && (item.name === myPlayer.name || item.slot === NetworkManager.mySlot);
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
         * 餌取得イベント（他プレイヤーが食べた餌の即時消去）
         */
        onFoodPicked(pick) {
            if (!world || !world.foodGrid) return;
            const key = `${pick.gx}_${pick.gy}`;
            const list = world.foodGrid.get(key);
            if (list && list[pick.index]) {
                list[pick.index] = list[list.length - 1];
                list.pop();
            }
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