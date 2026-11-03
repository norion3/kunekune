/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ゼロアロケーション空間ハッシュ衝突判定エンジン (combat.js)
 * v27.4.0 正面衝突・壁際スライディング安定化＆ハメ完全根絶版:
 * ・【壁際スライディング接線ベクトル強化】壁際でのノックバック時、壁の外へ押し出そうとする力を
 * 　完全接線方向（壁沿い）へ流し、角（コーナー）に追い詰められた際の振動フリーズや突き抜けを完全根絶
 * ・【正面衝突・完全同座標例外ガード】頭部同士が完全に同座標(dx=0, dy=0)で重なった場合の
 * 　ゼロ除算・NaNエラーを防止し、ランダム拡散ベクトルで安全に弾き飛ばすフォールバックを新設
 * ・【GCスパイク完全根絶維持】MAX_POOL_CAPACITY(24,576) ＆ MAX_CELL_POOL_CAPACITY(4,096)
 * 　により、100体交戦時でも毎フレームのヒープ確保・GCカクつきを完全排除
 * ・【対戦公平性維持】スコア比率（1.25倍 / 0.8倍）による大型優先判定、拮抗時双方跳ね返り、
 * 　無敵中スネーク胴体接触時のノックバック退避を完全維持
 * ==============================================================================
 */

import { GRID_SIZE, MAP_SIZE } from './constants.js';

// 100体のスネーク（平均体長40〜100節）の登録に十分耐えうる適正プール上限値
const MAX_POOL_CAPACITY = 24576;
const MAX_CELL_POOL_CAPACITY = 4096;

export class SpatialCollisionEngine {
    constructor() {
        this.grid = new Map();
        this.nodePool = [];
        this.poolIndex = 0;

        // セル配列再利用バッファ（ヒープ再アロケーション根絶用）
        this.cellPool = [];
        this.cellPoolIndex = 0;
    }

    clear() {
        // グリッド内の既存セル配列をプールへ返却
        for (const cell of this.grid.values()) {
            cell.length = 0;
            if (this.cellPool.length < MAX_CELL_POOL_CAPACITY) {
                this.cellPool.push(cell);
            }
        }
        this.grid.clear();
        this.cellPoolIndex = 0;

        // 長時間プレイ時のメモリ肥大化を防ぐ安全トリミング
        if (this.nodePool.length > MAX_POOL_CAPACITY) {
            this.nodePool.length = MAX_POOL_CAPACITY;
        }

        // ガベージコレクタを阻害しないよう、使用済みノードのエンティティ参照を解放
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

    // 全スネークの胴体体節を空間グリッドに登録
    registerBodies(snakes) {
        this.clear();

        for (let i = 0; i < snakes.length; i++) {
            const s = snakes[i];
            if (s.isDead || !s.isVisible) continue;

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
                const key = `${gx}_${gy}`;

                let cell = this.grid.get(key);
                if (!cell) {
                    cell = this.obtainCell();
                    this.grid.set(key, cell);
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
     * 衝突判定メイン（頭部同士の正面衝突 ＋ 頭部vs胴体の衝突）
     */
    checkHeadCollisions(snakes, onKill) {
        const total = snakes.length;

        // =========================================================================
        // 1. 頭部同士の正面衝突（Head-on Collision）判定
        // =========================================================================
        for (let i = 0; i < total; i++) {
            const sA = snakes[i];
            if (sA.isDead || !sA.isVisible) continue;

            for (let j = i + 1; j < total; j++) {
                const sB = snakes[j];
                if (sB.isDead || !sB.isVisible) continue;

                let dx = sA.x - sB.x;
                let dy = sA.y - sB.y;
                const minHeadDist = sA.size + sB.size;

                if (dx * dx + dy * dy < minHeadDist * minHeadDist) {
                    const isAInvuln = Boolean(sA.invulnerableTimer && sA.invulnerableTimer > 0);
                    const isBInvuln = Boolean(sB.invulnerableTimer && sB.invulnerableTimer > 0);

                    // 完全に同座標に重なった場合のゼロ除算ガード
                    let dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 0.001) {
                        const randomAngle = Math.random() * Math.PI * 2;
                        dx = Math.cos(randomAngle);
                        dy = Math.sin(randomAngle);
                        dist = 1.0;
                    }

                    // どちらかが無敵なら双方ノックバックで弾き飛ばし
                    if (isAInvuln || isBInvuln) {
                        const push = (minHeadDist - dist) * 0.5 + 2.0;
                        this._applySafeKnockback(sA, (dx / dist) * push, (dy / dist) * push);
                        this._applySafeKnockback(sB, -(dx / dist) * push, -(dy / dist) * push);
                        continue;
                    }

                    // スコア比較による大型優先ルール（スコア比率 1.25倍以上で勝敗決定）
                    const scoreRatio = sA.score / Math.max(1, sB.score);
                    if (scoreRatio >= 1.25) {
                        // Aの勝ち
                        sB.isDead = true;
                        sA.kills++;
                        if (onKill) onKill(sA, sB);
                    } else if (scoreRatio <= 0.8) {
                        // Bの勝ち
                        sA.isDead = true;
                        sB.kills++;
                        if (onKill) onKill(sB, sA);
                    } else {
                        // 拮抗時：双方が安全に跳ね返る（相打ち爆死防止）
                        const push = (minHeadDist - dist) * 0.6 + 3.0;
                        this._applySafeKnockback(sA, (dx / dist) * push, (dy / dist) * push);
                        this._applySafeKnockback(sB, -(dx / dist) * push, -(dy / dist) * push);
                    }
                }
            }
        }

        // =========================================================================
        // 2. 頭部 vs 胴体の激突判定（空間ハッシュグリッド走査）
        // =========================================================================
        for (let i = 0; i < total; i++) {
            const victim = snakes[i];
            if (victim.isDead || !victim.isVisible) continue;

            const hx = victim.x;
            const hy = victim.y;
            const hRadius = victim.size;

            const gx = Math.floor(hx / GRID_SIZE);
            const gy = Math.floor(hy / GRID_SIZE);

            let hasDied = false;

            // 周囲9マスを走査
            for (let ox = -1; ox <= 1 && !hasDied; ox++) {
                for (let oy = -1; oy <= 1 && !hasDied; oy++) {
                    const key = `${gx + ox}_${gy + oy}`;
                    const bodies = this.grid.get(key);
                    if (!bodies) continue;

                    for (let b = 0; b < bodies.length; b++) {
                        const bodyNode = bodies[b];
                        const killer = bodyNode.snake;
                        
                        if (!killer || killer === victim || killer.isDead) continue; 

                        let dx = hx - bodyNode.x;
                        let dy = hy - bodyNode.y;
                        const minDist = hRadius + bodyNode.radius * 0.75;

                        // 接触判定
                        if (dx * dx + dy * dy < minDist * minDist) {
                            const isVictimInvuln = Boolean(victim.invulnerableTimer && victim.invulnerableTimer > 0);
                            const isKillerInvuln = Boolean(killer.invulnerableTimer && killer.invulnerableTimer > 0);

                            // 無敵特攻キルの完全根絶＆連続ハメ防止
                            if (isVictimInvuln || isKillerInvuln) {
                                if (isVictimInvuln && victim.invulnerableTimer < 0.25) {
                                    victim.invulnerableTimer = 0.45;
                                }
                                if (isKillerInvuln && killer.invulnerableTimer < 0.25) {
                                    killer.invulnerableTimer = 0.45;
                                }

                                let dist = Math.sqrt(dx * dx + dy * dy);
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

                            victim.isDead = true;
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
        }
    }
}