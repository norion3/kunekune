// ==============================================================================
// 『くねくねバトル オンライン』リモートパケット受信反映ハンドラ (net_handlers.js)
// v33.0.0 ホスト(Slot 0)人間走者完全刻印＆配列直接統合・レーダー同期確定版:
// ・【ホスト(Slot 0)人間走者フラグ(isHumanPlayer)の完全刻印】
// 　ゲスト端末がホストからデータを受信する際、data.slot === 0 を無条件で人間走者
// 　（isHumanPlayer = true）として明示刻印。スロット情報受領の遅延やタイミングのズレ
// 　に一切左右されず、ゲスト画面上でも遠くのホストの方向ポインター（▲）が100%点灯
// ・【人間走者厳格フラグ(isHumanPlayer)刻印維持】
// 　ホスト側で CPU 1 (AI ID: 1) と ゲスト (Slot 1) のID重複による矢印二重描画を根絶
// ・【他ユーザーカラーリアルタイム即時同期維持】相手の色変更を毎フレーム即座に反映
// ・【ランキング順位番号と名前の完全頭出し整列維持】順位番号の独立固定幅ブロック
// ・【スコア省略フォーマッター維持】6桁フル表示、7桁目小数3桁固定（X.XXXM）
// ・【長いGRAVITYユーザー名の安全な省略保証維持】min-width: 0 と ellipsis
// ・【AI表情・デザインの完全同期維持】通常AI(Slot 6〜99)の5種表情・カラー復元維持
// ・【空き枠ダミーAI整合性保証維持】偽装ダミーAIと人間プレイヤーの区別維持
// ・【リモート死亡時肉片還元＆胴体シフトAPI維持】食物連鎖保護＆shiftHistory完全統合
// ==============================================================================

import { Snake } from './snake.js';
import { NetworkManager } from './network.js';
import { SNAKE_COLORS, TOTAL_SNAKES, MAX_PLAYERS } from './constants.js';

// 表情タイプの同期用定義（ai.js と完全一致）
const AI_FACES = ['normal', 'angry', 'happy', 'cool', 'cute'];

// ランキングDOM書き換えチラつき防止用シグネチャキャッシュ
let lastLeaderboardSignature = '';

// スコア表示用単位短縮ヘルパー（6桁フル表示 ＆ 7桁目から小数3桁固定 X.XXXM）
function formatScore(val) {
    const s = Math.floor(val || 0);
    if (s >= 1000000) {
        return (s / 1000000).toFixed(3) + 'M';
    }
    return s.toLocaleString();
}

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
                const isPlayerSlot = data.slot < MAX_PLAYERS;
                let color;
                let resolvedName;
                let face = 'normal';
                let isRealHuman = false;

                if (isPlayerSlot) {
                    // スロット 0〜5: 人間プレイヤーまたは空き枠ダミーAI
                    const slotData = NetworkManager.slots[data.slot];
                    color = (data.colorIdx !== undefined)
                        ? SNAKE_COLORS[data.colorIdx % SNAKE_COLORS.length]
                        : ((slotData && slotData.color) ? slotData.color : SNAKE_COLORS[data.slot % SNAKE_COLORS.length]);
                    resolvedName = (slotData && slotData.name)
                        ? slotData.name 
                        : (data.isAI ? `CPU ${data.slot + 1}` : `P${data.slot + 1}`);
                    face = 'normal';
                    
                    // ★ ホスト枠（Slot 0）または AIフラグが立っていない枠を無条件で人間走者と判定！
                    if (data.slot === 0 || (slotData && !slotData.isAI)) {
                        isRealHuman = true;
                    }
                } else {
                    // スロット 6〜99: ホストがシミュレートしている通常AI
                    const originalAiId = data.slot - MAX_PLAYERS + 1;
                    color = (data.colorIdx !== undefined)
                        ? SNAKE_COLORS[data.colorIdx % SNAKE_COLORS.length]
                        : SNAKE_COLORS[originalAiId % SNAKE_COLORS.length];
                    resolvedName = `CPU ${originalAiId}`;
                    // ★ ホスト側の ai.js と全く同じ計算式で表情を完全復元
                    face = AI_FACES[originalAiId % AI_FACES.length];
                    isRealHuman = false;
                }

                remote = new Snake(false, data.slot, resolvedName, color, face);
                // ★ 人間走者フラグをスネーク自身に直接刻印（AIとの混同・矢印重複を物理排除）
                remote.isHumanPlayer = isRealHuman;

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

            // =========================================================================
            // ★ 【他ユーザーカラーリアルタイム同期】
            // 相手がメニューで色を変更した際、毎フレーム届く colorIdx を即座に反映！
            // スネーク本体・HUDの方向ポインター（▲）・レーダー二重リングの色が完全連動
            // =========================================================================
            if (data.colorIdx !== undefined) {
                const newColor = SNAKE_COLORS[data.colorIdx % SNAKE_COLORS.length];
                if (remote.color !== newColor) {
                    remote.color = newColor;
                }
                if (data.slot < MAX_PLAYERS && NetworkManager.slots[data.slot]) {
                    NetworkManager.slots[data.slot].color = newColor;
                }
            }

            // ★ 名前同期保証 ＆ 人間フラグの追従確定（Slot 0はゲスト端末で常時人間判定）
            if (data.slot < MAX_PLAYERS) {
                const curSlot = NetworkManager.slots[data.slot];
                if (data.slot === 0 || (curSlot && !curSlot.isAI)) {
                    remote.isHumanPlayer = true;
                }
                if (curSlot && curSlot.name && !curSlot.isAI && remote.name !== curSlot.name) {
                    remote.name = curSlot.name;
                }
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
                // ★ 順位番号を独立ブロック（width: 18px）化し「CPU」の頭出しを一直線に整列。名前は ellipsis で安全短縮
                listEl.innerHTML = topList.slice(0, 8).map((item, idx) => {
                    const isMe = item.slot === NetworkManager.mySlot;
                    return `
                        <div style="display:flex; justify-content:space-between; align-items:center; color:${isMe ? '#ffdd00' : '#ffffff'}; font-weight:${isMe ? 'bold' : 'normal'}; font-size:12px; gap:6px;">
                            <div style="display:flex; align-items:center; min-width:0; flex:1; overflow:hidden;">
                                <span style="display:inline-block; width:18px; flex-shrink:0; font-feature-settings:'tnum'; text-align:left;">${idx + 1}.</span>
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${item.name}</span>
                            </div>
                            <span style="font-feature-settings:'tnum'; text-align:right; font-weight:700; flex-shrink:0; margin-left:6px;">${formatScore(item.score)}</span>
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