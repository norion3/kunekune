// ==============================================================================
// 『くねくねバトル オンライン』リモートパケット受信反映ハンドラ (net_handlers.js)
// v21.2.0 ゲーム開始一斉キック連携版:
// ・ホストからの START_GAME 受信時に全ゲスト端末で initGame() を自動キック
// ・リモート走者（他プレイヤー/他AI）の位置・向き・速度・スコア同期
// ・餌捕食イベント (pk) ＆ 撃破肉片散布 (dp) の世界反映
// ・ワールドシード同期 ＆ 弾幕チャット通知
// ==============================================================================

import { Snake } from './snake.js';
import { NetworkManager } from './network.js';
import { Danmaku } from './danmaku.js';
import { SNAKE_COLORS, TOTAL_SNAKES } from './constants.js';

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
         * ★ ホストからのゲーム開始合図受信ハンドラ（ゲスト端末一斉始動）
         */
        onGameStart(packet) {
            if (typeof initGame === 'function') {
                initGame();
            } else if (typeof window.initGameInstance === 'function') {
                window.initGameInstance();
            }
            Danmaku.push('システム', 'バトルが開始されました！', '#34d399', true);
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

            remote.targetNetX = data.x;
            remote.targetNetY = data.y;
            remote.targetAngle = data.angle;
            remote.speed = data.speed;
            remote.targetLength = data.length;
            remote.score = data.score;
            remote.isBoosting = data.isBoosting;
            remote.isDead = data.isDead;
            remote.kills = data.kills;
            remote.lastPacketTime = performance.now();
            remote.recalculateSize();
        },

        /**
         * ★ ホストから受信した全体リーダーボード情報をゲスト端末のHUD・順位パネルへ同期
         */
        onLeaderboardSync(lbData) {
            if (!lbData) return;
            const myPlayer = window.localPlayerInstance;
            const myScore = myPlayer ? myPlayer.score : 0;
            const topList = lbData.top || [];
            const totalAlive = lbData.totalAlive || TOTAL_SNAKES;

            // ゲスト端末の自機順位算出
            let higherCount = topList.filter(item => item.score > myScore).length;
            if (lbData.myRank) {
                higherCount = lbData.myRank - 1;
            }
            const myRank = higherCount + 1;

            const valRank = document.getElementById('val-rank');
            const valTotal = document.getElementById('val-total');
            if (valRank) valRank.innerText = myRank;
            if (valTotal) valTotal.innerText = totalAlive;

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
         * Phase 2 先行配備：撃破肉片クラスタ受信ハンドラ
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
            Danmaku.push('同期', 'ワールドシードを同期しました', '#00e5ff', true);
        }
    });
}