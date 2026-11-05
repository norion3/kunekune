/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ゼロアロケーション空間ハッシュ衝突判定エンジン (combat.js)
 * v35.0.0 CCD変位リミッター適正化＆デスレーザー誤爆完全根絶版:
 * ・【CCD変位上限二乗値の適正化】
 * 　MAX_CCD_DISPLACEMENT_SQ を過大な 160,000（400px相当）から実移動量に即した
 * 　安全な 10,000（100px相当）へ適正化！
 * 　通常ブースト時の高速移動（1フレーム約25〜45px）におけるすり抜け防止を完全維持しつつ、
 * 　通信ラグやワープ補正時に発生する巨大な不可視の判定線分（デス・レーザー）を
 * 　確実に点判定へフォールバックさせ、周囲の他走者やAIの巻き込み即死を100%物理根絶
 * ・【超巨大スネークの空間ハッシュすり抜け完全防止維持】動的探索半径
 * ・【ホストカメラ依存(!s.isVisibleスキップ)の完全撤廃維持】
 * ・【リスポーン直後CCD誤爆防止ガード維持】
 * ・【Mapイテレータ排除による完全ゼロアロケーション維持】activeCells 配列直接管理
 * ・【空間ハッシュマイナス座標ビット崩壊完全防護維持】((gx + 10) << 16) | (gy + 10)
 * ・【リモート走者死亡判定委譲維持】復活ループ・幽霊化完全根絶
 * ・【頭部同士の正面衝突CCD統合維持】
 * ・【デバッグ用無敵シールド(isGodMode)判定統合維持】双方ノックバック退避
 * ・【正面衝突・完全同座標例外ガード維持】ゼロ除算・NaNエラー完全防止
 * ・【胴体接触ノックバックゼロ除算防止維持】
 * ・【壁際スライディング接線ベクトル強化維持】
 * ・【対戦公平性維持】スコア比率（1.25倍 / 0.8倍）による大型優先判定、拮抗時双方跳ね返り維持
 * ==============================================================================
 */

import { GRID_SIZE, MAP_SIZE } from './constants.js';

// 100体のスネーク（平均体長40〜100節）の登録に十分耐えうる適正プール上限値
const MAX_POOL_CAPACITY = 24576;
const MAX_CELL_POOL_CAPACITY = 4096;

// ★ CCD変位上限二乗値（100px相当: 通常ブースト時の高速移動を網羅し、ワープ時のデス・レーザーを遮断）
const MAX_CCD_DISPLACEMENT_SQ = 10000;

export class SpatialCollisionEngine {
    constructor() {
        this.grid = new Map();
        this.nodePool = [];
        this.poolIndex = 0;

        // セル配列再利用バッファ（ヒープ再アロケーション根絶用）
        this.cellPool = [];
        this.cellPoolIndex = 0;

        // イテレータ生成排除用アクティブセル追跡配列（ゼロアロケーション）
        this.activeCells = [];
    }

    clear() {
        const activeCount = this.activeCells.length;
        for (let i = 0; i < activeCount; i++) {
            const cell = this.activeCells[i];
            cell.length = 0;
            if (this.cellPool.length < MAX_CELL_POOL_CAPACITY) {
                this.cellPool.push(cell);
            }
        }
        this.activeCells.length = 0;
        this.grid.clear();
        this.cellPoolIndex = 0;

        if (this.nodePool.length > MAX_POOL_CAPACITY) {
            this.nodePool.length = MAX_POOL_CAPACITY;
        }

        const limit = Math.min(this.poolIndex, this.nodePool.length);
        for (let i = 0; i < limit; i++) {
            this.nodePool[i].snake = null;
        }

        this.poolIndex = 0;
    }

    obtainNode(snake, x, y, radius) {
        let node;
        if (this.poolIndex < this.nodePool.length) {
            node = this.nodePool[this.poolIndex];
            node.snake = snake;
            node.x = x;
            node.y = y;
            node.radius = radius;
        } else {
            node = { snake, x, y, radius };
            this.nodePool.push(node);
        }
        this.poolIndex++;
        return node;
    }

    obtainCell() {
        if (this.cellPool.length > 0) {
            return this.cellPool.pop();
        }
        return [];
    }

    // 全スネークの胴体体節を空間グリッドに登録（画面外であっても常時演算）
    registerBodies(snakes) {
        this.clear();

        const total = snakes.length;
        for (let i = 0; i < total; i++) {
            const s = snakes[i];
            // 画面外フラグ(!s.isVisible)でのスキップを撤廃し、死亡中(isDead)のみ除外
            if (s.isDead) continue;

            const histLen = s.historyLength || 0;

            // 頭部付近（先頭2節）は自爆防止のため登録しない
            for (let j = 3; j < histLen; j += 2) {
                const idx = (s.headIdx + j) % 2048; // MAX_HISTORY = 2048
                const pt = s.history[idx];
                if (!pt) continue;

                const progress = j / histLen;
                const radius = s.size * (1 - Math.pow(progress, 2.5) * 0.5);

                const gx = Math.floor(pt.x / GRID_SIZE);
                const gy = Math.floor(pt.y / GRID_SIZE);
                // 整数ビット演算ハッシュ（負の座標によるビット崩壊を防ぐ正のオフセット +10 適用）
                const key = ((gx + 10) << 16) | (gy + 10);

                let cell = this.grid.get(key);
                if (!cell) {
                    cell = this.obtainCell();
                    this.grid.set(key, cell);
                    this.activeCells.push(cell);
                }
                cell.push(this.obtainNode(s, pt.x, pt.y, radius));
            }
        }
    }

    /**
     * ノックバックベクトルを壁際で接線方向に逃がす（スライディング・エスケープ）ヘルパー
     * 角（コーナー）に追い込まれた場合でも安全にクランプし振動フリーズを防止
     */
    _applySafeKnockback(target, pushX, pushY) {
        const margin = Math.max(target.size, 50);
        const minX = margin;
        const maxX = MAP_SIZE - margin;
        const minY = margin;
        const maxY = MAP_SIZE - margin;
        
        // X軸が壁に衝突する場合、押し込み力をY軸の接線方向へ逃がす
        if ((target.x <= minX && pushX < 0) || (target.x >= maxX && pushX > 0)) {
            pushY += (pushY !== 0 ? Math.sign(pushY) : (Math.random() < 0.5 ? 1 : -1)) * Math.abs(pushX);
            pushX = 0;
        }
        // Y軸が壁に衝突する場合、押し込み力をX軸の接線方向へ逃がす
        if ((target.y <= minY && pushY < 0) || (target.y >= maxY && pushY > 0)) {
            pushX += (pushX !== 0 ? Math.sign(pushX) : (Math.random() < 0.5 ? 1 : -1)) * Math.abs(pushY);
            pushY = 0;
        }

        target.x = Math.max(minX, Math.min(maxX, target.x + pushX));
        target.y = Math.max(minY, Math.min(maxY, target.y + pushY));
    }

    /**
     * 衝突判定メイン（画面外であっても全エンティティを常時正確にシミュレーション）
     */
    checkHeadCollisions(snakes, onKill) {
        const total = snakes.length;

        // =========================================================================
        // 1. 頭部同士の正面衝突（Head-on Collision）判定 ＆ 相対CCD
        // =========================================================================
        for (let i = 0; i < total; i++) {
            const sA = snakes[i];
            if (sA.isDead) continue;

            const prevAx = sA.prevX !== undefined ? sA.prevX : sA.x;
            const prevAy = sA.prevY !== undefined ? sA.prevY : sA.y;
            const isARespawning = (sA.historyLength || 0) < 2;

            for (let j = i + 1; j < total; j++) {
                const sB = snakes[j];
                if (sB.isDead) continue;

                const prevBx = sB.prevX !== undefined ? sB.prevX : sB.x;
                const prevBy = sB.prevY !== undefined ? sB.prevY : sB.y;
                const isBRespawning = (sB.historyLength || 0) < 2;

                // 相対変位線分（sAから見たsBの相対移動スイープ）
                const relStartX = prevAx - prevBx;
                const relStartY = prevAy - prevBy;
                const relEndX = sA.x - sB.x;
                const relEndY = sA.y - sB.y;

                const relDx = relEndX - relStartX;
                const relDy = relEndY - relStartY;
                const relLenSq = relDx * relDx + relDy * relDy;

                const minHeadDist = sA.size + sB.size;
                const minHeadDistSq = minHeadDist * minHeadDist;

                let closestDistSq = 0;
                let evalDx = relEndX;
                let evalDy = relEndY;

                // ワープ時およびリスポーン直後はCCDをスキップして現在位置の点判定へ安全フォールバック
                const canUseCCD = !isARespawning && !isBRespawning && relLenSq > 0.0001 && relLenSq <= MAX_CCD_DISPLACEMENT_SQ;

                if (canUseCCD) {
                    const t = Math.max(0, Math.min(1, -(relStartX * relDx + relStartY * relDy) / relLenSq));
                    evalDx = relStartX + t * relDx;
                    evalDy = relStartY + t * relDy;
                    closestDistSq = evalDx * evalDx + evalDy * evalDy;
                } else {
                    closestDistSq = relEndX * relEndX + relEndY * relEndY;
                }

                if (closestDistSq < minHeadDistSq) {
                    // isGodMode または通常の invulnerableTimer による無敵判定
                    const isAProtected = Boolean(sA.isGodMode || (sA.invulnerableTimer && sA.invulnerableTimer > 0));
                    const isBProtected = Boolean(sB.isGodMode || (sB.invulnerableTimer && sB.invulnerableTimer > 0));

                    // 完全に同座標に重なった場合のゼロ除算・NaN例外ガード
                    let dist = Math.sqrt(closestDistSq);
                    let pushDx = evalDx;
                    let pushDy = evalDy;
                    if (dist < 0.001) {
                        const randomAngle = Math.random() * Math.PI * 2;
                        pushDx = Math.cos(randomAngle);
                        pushDy = Math.sin(randomAngle);
                        dist = 1.0;
                    }

                    // どちらかが無敵（isGodMode含む）なら双方ノックバックで弾き飛ばし
                    if (isAProtected || isBProtected) {
                        const push = (minHeadDist - dist) * 0.5 + 2.0;
                        this._applySafeKnockback(sA, (pushDx / dist) * push, (pushDy / dist) * push);
                        this._applySafeKnockback(sB, -(pushDx / dist) * push, -(pushDy / dist) * push);
                        continue;
                    }

                    // スコア比較による大型優先ルール（スコア比率 1.25倍以上で勝敗決定）
                    const scoreRatio = sA.score / Math.max(1, sB.score);
                    if (scoreRatio >= 1.25) {
                        // Aの勝ち
                        const isBRemoteHuman = Boolean(sB.isHumanPlayer && !sB.isPlayer);
                        if (!isBRemoteHuman) {
                            sB.isDead = true;
                        }
                        sA.kills++;
                        if (onKill) onKill(sA, sB);
                    } else if (scoreRatio <= 0.8) {
                        // Bの勝ち
                        const isARemoteHuman = Boolean(sA.isHumanPlayer && !sA.isPlayer);
                        if (!isARemoteHuman) {
                            sA.isDead = true;
                        }
                        sB.kills++;
                        if (onKill) onKill(sB, sA);
                    } else {
                        // 拮抗時：双方が安全に跳ね返る（相打ち爆死防止）
                        const push = (minHeadDist - dist) * 0.6 + 3.0;
                        this._applySafeKnockback(sA, (pushDx / dist) * push, (pushDy / dist) * push);
                        this._applySafeKnockback(sB, -(pushDx / dist) * push, -(pushDy / dist) * push);
                    }
                }
            }
        }

        // =========================================================================
        // 2. 頭部 vs 胴体の激突判定（空間ハッシュグリッド走査 ＆ 連続衝突判定CCD）
        // =========================================================================
        for (let i = 0; i < total; i++) {
            const victim = snakes[i];
            const hx = victim.x;
            const hy = victim.y;

            if (victim.isDead) {
                victim.prevX = hx;
                victim.prevY = hy;
                continue;
            }

            const hRadius = victim.size;

            // 前フレーム位置（未記録時は現位置として通常の点判定に安全フォールバック）
            const prevHx = victim.prevX !== undefined ? victim.prevX : hx;
            const prevHy = victim.prevY !== undefined ? victim.prevY : hy;

            // スイープ線分ベクトル
            const segDx = hx - prevHx;
            const segDy = hy - prevHy;
            const segLenSq = segDx * segDx + segDy * segDy;

            // リスポーン直後は前フレーム線分の誤爆を防ぐためCCDを安全にスキップ
            const isVictimRespawning = (victim.historyLength || 0) < 2;

            const gx = Math.floor(hx / GRID_SIZE);
            const gy = Math.floor(hy / GRID_SIZE);

            // =========================================================================
            // ★ 【動的探索半径による超巨大スネークすり抜け完全防止】
            // 頭部半径が GRID_SIZE に迫る・超える巨大化時でも、探索範囲を動的に拡張して判定漏れを根絶
            // =========================================================================
            const searchRange = Math.max(1, Math.min(3, Math.ceil(hRadius / GRID_SIZE)));

            let hasDied = false;

            for (let ox = -searchRange; ox <= searchRange && !hasDied; ox++) {
                for (let oy = -searchRange; oy <= searchRange && !hasDied; oy++) {
                    // 整数ビット演算ハッシュ（負の座標によるビット崩壊を防ぐ正のオフセット +10 適用）
                    const key = ((gx + ox + 10) << 16) | (gy + oy + 10);
                    const bodies = this.grid.get(key);
                    if (!bodies) continue;

                    const bodyCount = bodies.length;
                    for (let b = 0; b < bodyCount; b++) {
                        const bodyNode = bodies[b];
                        const killer = bodyNode.snake;
                        
                        if (!killer || killer === victim || killer.isDead) continue; 

                        const bx = bodyNode.x;
                        const by = bodyNode.y;
                        const minDist = hRadius + bodyNode.radius * 0.75;
                        const minDistSq = minDist * minDist;

                        // =========================================================================
                        // 線分 vs 円の最短距離判定（CCD: トンネリングすり抜け根絶）
                        // ワープ・長距離跳躍時およびリスポーン直後は点判定へ安全フォールバック
                        // =========================================================================
                        let closestDistSq = 0;
                        let hitX = hx;
                        let hitY = hy;

                        const canUseVictimCCD = !isVictimRespawning && segLenSq > 0.0001 && segLenSq <= MAX_CCD_DISPLACEMENT_SQ;

                        if (canUseVictimCCD) {
                            // 胴体中心 P(bx, by) を線分 A(prevHx, prevHy) -> B(hx, hy) に射影
                            const t = Math.max(0, Math.min(1, ((bx - prevHx) * segDx + (by - prevHy) * segDy) / segLenSq));
                            hitX = prevHx + t * segDx;
                            hitY = prevHy + t * segDy;
                            const cdx = hitX - bx;
                            const cdy = hitY - by;
                            closestDistSq = cdx * cdx + cdy * cdy;
                        } else {
                            const dx = hx - bx;
                            const dy = hy - by;
                            closestDistSq = dx * dx + dy * dy;
                        }

                        // 接触判定
                        if (closestDistSq < minDistSq) {
                            // isGodMode または通常の invulnerableTimer による無敵判定
                            const isVictimProtected = Boolean(victim.isGodMode || (victim.invulnerableTimer && victim.invulnerableTimer > 0));
                            const isKillerProtected = Boolean(killer.isGodMode || (killer.invulnerableTimer && killer.invulnerableTimer > 0));

                            // 無敵特攻キルの完全根絶＆連続ハメ防止
                            if (isVictimProtected || isKillerProtected) {
                                if (victim.invulnerableTimer !== undefined && victim.invulnerableTimer < 0.25 && !victim.isGodMode) {
                                    victim.invulnerableTimer = 0.45;
                                }
                                if (killer.invulnerableTimer !== undefined && killer.invulnerableTimer < 0.25 && !killer.isGodMode) {
                                    killer.invulnerableTimer = 0.45;
                                }

                                let dist = Math.sqrt(closestDistSq);
                                let dx = hitX - bx;
                                let dy = hitY - by;
                                if (dist < 0.001) {
                                    const randomAngle = Math.random() * Math.PI * 2;
                                    dx = Math.cos(randomAngle);
                                    dy = Math.sin(randomAngle);
                                    dist = 1.0;
                                }

                                const pushForce = (minDist - dist) * 0.22 + 1.5;
                                
                                // 壁際での振動ハメ状態を防ぐスライディングエスケープ処理
                                this._applySafeKnockback(victim, (dx / dist) * pushForce, (dy / dist) * pushForce);
                                continue;
                            }

                            // リモートの人間走者は相手自身の判定に委任し、ローカルで即死フラグを立てない
                            const isVictimRemoteHuman = Boolean(victim.isHumanPlayer && !victim.isPlayer);
                            if (!isVictimRemoteHuman) {
                                victim.isDead = true;
                            }
                            killer.kills++;

                            if (onKill) {
                                onKill(killer, victim);
                            }

                            hasDied = true;
                            break;
                        }
                    }
                }
            }

            // 次フレームのCCD判定用に現フレーム頭部座標を記録
            victim.prevX = hx;
            victim.prevY = hy;
        }
    }
}