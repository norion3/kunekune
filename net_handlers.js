// ==============================================================================
// 『くねくねバトル オンライン』リモートパケット受信反映ハンドラ (net_handlers.js)
// v41.0.0 ゲスト端末ランキング順位(valRank)完全同期＆PvPキル報酬維持版:
// ・【ゲスト端末側ランキング順位（valRank）同期の完全正常化】
// 　ホスト側のみで updateStats が実行される仕様と調和させ、ゲスト端末の onLeaderboardSync
// 　においてトップリスト内の自機確定位置（myTopIndex + 1）および全体確定順位（ranks）
// 　から算出した myRank を val-rank DOM へ確実に反映！
// 　下部リストが「8. のりおん」であるにもかかわらず上部が初期値の「1 / 87」と表示される
// 　矛盾を100%解消し、上部ヘッダーとリスト順位を完全一致化
// ・【対人戦（PvP）キル報酬確定同期（KILL_ALERTフック）維持】
// ・【撃破肉片クラスタ二重生成の完全防止（onDropClusterSpawned）維持】
// ・【ランキング文字色の個別カスタムカラー化維持】
// ・【色変更検知シグネチャ連動による0ms即時再描画維持】
// ・【ランキング同期デッドロックの完全解消維持】
// ・【リーダーボードキャッシュのリセット機構維持】
// ・【相手顔タイプ・マイアイコン(face/faceIdx)リアルタイム同期維持】
// ・【相手走者アイコン枠線(淵)リアルタイム連動維持】
// ・【onGameStart ゲームオーバー中完全遮断維持】
// ・【ホスト(Slot 0)人間走者フラグ(isHumanPlayer)の完全刻印維持】
// ・【人間走者厳格フラグ(isHumanPlayer)刻印維持】
// ・【ランキング順位番号と名前の完全頭出し整列維持】
// ・【スコア省略フォーマッター維持】
// ・【長いGRAVITYユーザー名の安全な省略保証維持】
// ・【AI表情・デザインの完全同期維持】
// ・【空き枠ダミーAI整合性保証維持】
// ・【リモート死亡時肉片還元＆胴体シフトAPI維持】
// ==============================================================================

import { Snake } from './snake.js';
import { NetworkManager } from './network.js';
import { Menu } from './menu.js';
import { FACE_TYPES } from './net_protocol.js';
import { SNAKE_COLORS, TOTAL_SNAKES, MAX_PLAYERS } from './constants.js';

// 表情タイプの同期用定義（ai.js と完全一致）
const AI_FACES = ['normal', 'angry', 'happy', 'cool', 'cute'];

// ランキングDOM書き換えチラつき防止用シグネチャキャッシュ
let lastLeaderboardSignature = '';

/**
 * リーダーボードのキャッシュを明示的にクリアするヘルパー
 */
export function resetLeaderboardCache() {
    lastLeaderboardSignature = '';
}

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

    // =========================================================================
    // ★ 【対人戦（PvP）キル報酬確定同期インターセプター】
    // 相手端末の自己判定で自分がキラーとなった KILL_ALERT を検知し、自機スコアを加算
    // =========================================================================
    if (NetworkManager && !NetworkManager._hasKillRewardHooked) {
        NetworkManager._hasKillRewardHooked = true;
        const originalHandleCustomMessage = NetworkManager._handleCustomMessage.bind(NetworkManager);

        NetworkManager._handleCustomMessage = function(data) {
            if (data) {
                let packet = null;
                try {
                    let rawStr = '';
                    if (data.data && typeof data.data.msg_data === 'string') rawStr = data.data.msg_data;
                    else if (typeof data.msg_data === 'string') rawStr = data.msg_data;
                    else if (data.data && typeof data.data.message === 'string') rawStr = data.data.message;
                    else if (typeof data.message === 'string') rawStr = data.message;
                    else if (typeof data === 'string') rawStr = data;

                    if (rawStr) packet = JSON.parse(rawStr);
                    if (!packet && typeof data === 'object') {
                        if (data.e || data.event) packet = data;
                        else if (data.data && typeof data.data === 'object') packet = data.data;
                    }
                } catch (e) {
                    packet = null;
                }

                if (packet) {
                    const eventType = packet.e || packet.event;
                    if (eventType === 'KILL_ALERT') {
                        const myPlayer = window.localPlayerInstance;
                        const myName = (myPlayer && myPlayer.name) ? myPlayer.name : 'あなた';

                        // 相手端末からのキル通告で、自機がキラーかつ被害者が他者の場合
                        if (packet.kn === myName && packet.vs !== undefined && packet.vs !== NetworkManager.mySlot) {
                            let victimScore = 200;
                            const victimSnake = allSnakes.find(s => s && s.id === packet.vs);
                            if (victimSnake && victimSnake.score) {
                                victimScore = victimSnake.score;
                            }
                            const absorbedScore = Math.max(120, Math.floor(victimScore * 0.18));

                            if (myPlayer && !myPlayer.isDead) {
                                myPlayer.addScore(absorbedScore);
                                myPlayer.kills = (myPlayer.kills || 0) + 1;
                            }
                        }
                    }
                }
            }
            return originalHandleCustomMessage(data);
        };
    }

    NetworkManager.setCallbacks({
        /**
         * ホストからのゲーム開始・直接参戦合図受信ハンドラ
         * ★ ゲームオーバー表示中は外部からの自動開始をブロックしリザルト画面を死守
         * ★ 途中参加時は isRespawn = true 扱いにして受信済み他プレイヤーの消去（点滅）を完全防止
         */
        onGameStart(packet) {
            const overScreen = document.getElementById('over-screen');
            const isGameOver = (typeof window !== 'undefined' && window.currentGameState === 'gameover') ||
                (overScreen && overScreen.style.display === 'flex');

            if (isGameOver) {
                console.warn('[net_handlers] リザルト画面表示中のため、onGameStart をスキップします。');
                return;
            }

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
                    const slotData = NetworkManager.slots[data.slot];
                    color = (data.colorIdx !== undefined)
                        ? SNAKE_COLORS[data.colorIdx % SNAKE_COLORS.length]
                        : ((slotData && slotData.color) ? slotData.color : SNAKE_COLORS[data.slot % SNAKE_COLORS.length]);
                    resolvedName = (slotData && slotData.name)
                        ? slotData.name 
                        : (data.isAI ? `CPU ${data.slot + 1}` : `P${data.slot + 1}`);

                    if (data.face) {
                        face = data.face;
                    } else if (data.faceIdx !== undefined && FACE_TYPES[data.faceIdx]) {
                        face = FACE_TYPES[data.faceIdx];
                    } else if (slotData && slotData.face) {
                        face = slotData.face;
                    } else {
                        face = 'normal';
                    }
                    
                    if (data.slot === 0 || (slotData && !slotData.isAI)) {
                        isRealHuman = true;
                    }
                } else {
                    const originalAiId = data.slot - MAX_PLAYERS + 1;
                    color = (data.colorIdx !== undefined)
                        ? SNAKE_COLORS[data.colorIdx % SNAKE_COLORS.length]
                        : SNAKE_COLORS[originalAiId % SNAKE_COLORS.length];
                    resolvedName = `CPU ${originalAiId}`;
                    face = AI_FACES[originalAiId % AI_FACES.length];
                    isRealHuman = false;
                }

                remote = new Snake(false, data.slot, resolvedName, color, face);
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

            if (data.colorIdx !== undefined) {
                const newColor = SNAKE_COLORS[data.colorIdx % SNAKE_COLORS.length];
                let colorChanged = false;

                if (remote.color !== newColor) {
                    remote.color = newColor;
                    colorChanged = true;
                }
                if (data.slot < MAX_PLAYERS && NetworkManager.slots[data.slot]) {
                    if (NetworkManager.slots[data.slot].color !== newColor) {
                        NetworkManager.slots[data.slot].color = newColor;
                        colorChanged = true;
                    }
                }

                if (colorChanged && Menu && typeof Menu.updateParticipants === 'function') {
                    Menu.updateParticipants(NetworkManager.slots.filter(s => !s.isAI));
                }
            }

            let targetFace = null;
            if (data.face) {
                targetFace = data.face;
            } else if (data.faceIdx !== undefined && FACE_TYPES[data.faceIdx]) {
                targetFace = FACE_TYPES[data.faceIdx];
            }

            if (targetFace) {
                if (remote.face !== targetFace) {
                    remote.face = targetFace;
                }
                if (data.slot < MAX_PLAYERS && NetworkManager.slots[data.slot]) {
                    if (NetworkManager.slots[data.slot].face !== targetFace) {
                        NetworkManager.slots[data.slot].face = targetFace;
                    }
                }
            }

            if (data.slot < MAX_PLAYERS) {
                const curSlot = NetworkManager.slots[data.slot];
                if (data.slot === 0 || (curSlot && !curSlot.isAI)) {
                    remote.isHumanPlayer = true;
                }
                if (curSlot && curSlot.name && !curSlot.isAI && remote.name !== curSlot.name) {
                    remote.name = curSlot.name;
                }
            }

            const dx = data.x - remote.x;
            const dy = data.y - remote.y;
            const distSq = dx * dx + dy * dy;

            if (distSq > 1000000) {
                remote.shiftHistory(dx, dy);
                remote.x = data.x;
                remote.y = data.y;
            }

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
            remote.recalculateSize();

            remote.isBoosting = data.isBoosting;
            remote.kills = data.kills;
            remote.lastPacketTime = performance.now();
        },

        /**
         * ホストから受信した全体リーダーボード情報をゲスト端末へ同期
         * ★ ゲスト端末側で算出された myRank を確実に valRank DOM へ反映し、画像のような「1 / 87」不整合を100%解消
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

            // =========================================================================
            // ★ 【自機順位（myRank）の高精度算出＆DOM確実反映】
            // 1. トップリスト内に自機がいる場合: その表示位置インデックス + 1（画像例: 8位）
            // 2. リスト外（9位以下）の場合: ホストが全スロットを正確に集計した確定順位マップを参照
            // =========================================================================
            let myRank = 1;
            const myTopIndex = topList.findIndex(item => item.slot === NetworkManager.mySlot);

            if (myTopIndex !== -1) {
                myRank = myTopIndex + 1;
            } else if (lbData.ranks && lbData.ranks[NetworkManager.mySlot] !== undefined) {
                myRank = lbData.ranks[NetworkManager.mySlot];
            } else if (lbData.myRank) {
                myRank = lbData.myRank;
            } else {
                const higherCount = topList.filter(item => item.score > myScore).length;
                myRank = higherCount + 1;
            }

            // ゲスト端末側のDOM（val-rank および val-total）を確実に同期更新
            const valRank = document.getElementById('val-rank');
            const valTotal = document.getElementById('val-total');
            if (valRank) valRank.innerText = myRank;
            if (valTotal) valTotal.innerText = totalAlive;

            // 差分検知シグネチャ（名前・スコア・順位および各プレイヤーの色文字列化）
            const newSignature = topList.slice(0, 8).map(item => {
                let col = '#ffffff';
                if (item.slot === NetworkManager.mySlot && myPlayer) {
                    col = myPlayer.color || '#ffffff';
                } else if (item.slot < MAX_PLAYERS && NetworkManager.slots[item.slot] && !NetworkManager.slots[item.slot].isAI) {
                    col = NetworkManager.slots[item.slot].color || '#ffffff';
                }
                return `${item.name}:${item.score}:${col}`;
            }).join('|') + `_me:${myScore}_rank:${myRank}`;

            if (newSignature === lastLeaderboardSignature) {
                return;
            }
            lastLeaderboardSignature = newSignature;

            // =========================================================================
            // ★ 【ゲスト端末側ランキング表示：人間プレイヤーはカスタムカラー / AIは白】
            // =========================================================================
            const listEl = document.getElementById('leaderboard-list');
            if (listEl) {
                listEl.innerHTML = topList.slice(0, 8).map((item, idx) => {
                    const isMe = item.slot === NetworkManager.mySlot;
                    let textColor = '#ffffff';

                    if (isMe && myPlayer) {
                        textColor = myPlayer.color || '#ffffff';
                    } else if (item.slot < MAX_PLAYERS && NetworkManager.slots[item.slot] && !NetworkManager.slots[item.slot].isAI) {
                        textColor = NetworkManager.slots[item.slot].color || '#ffffff';
                    }

                    return `
                        <div style="display:flex; justify-content:space-between; align-items:center; color:${textColor}; font-weight:${isMe ? 'bold' : 'normal'}; font-size:12px; gap:6px;">
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
         * ★ ゲスト端末かつ自機の直近キル（ローカル先行生成済み）である場合は二重生成をスキップ！
         */
        onDropClusterSpawned(cluster) {
            if (!world || !world.dropFoods || !Array.isArray(cluster)) return;
            const cx = cluster[0];
            const cy = cluster[1];

            if (NetworkManager.isMultiplayerActive && !NetworkManager.isHost) {
                if (typeof window !== 'undefined' && typeof window.checkIsRecentLocalKill === 'function') {
                    if (window.checkIsRecentLocalKill(cx, cy)) {
                        return;
                    }
                }
            }

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
            resetLeaderboardCache();
        }
    });
}