/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ゼロアロケーション空間ハッシュ衝突判定エンジン (combat.js)
 * v26.0.0 正面衝突判定新設＆大型優先ルール・無敵安全保護版:
 * ・【正面衝突判定新設】頭部同士の激突（distSq < (rA + rB)^2）を検知し、配列ループ順による一方的理不尽即死を根絶
 * ・大型優先判定：スコア差が顕著な場合は大スネークが勝利、スコア拮抗時または無敵時は双方安全弾き飛ばし（すり抜け）
 * ・加害者（killer）・被害者（victim）のいずれかが無敵時間中なら双方が死亡せずノックバック弾き飛ばし
 * ・無敵中のスネークの胴体に敵が当たっても敵を一方的に即死させない対戦公平性の確立
 * ・キル時 150pt 加算の重複を解消（main.js 側の相手スコア吸収＋撃破点へ一本化）
 * ・空間グリッド cell 配列の再利用プール化により毎秒数万個のヒープ生成＆GCカクつきを根絶
 * ・ノードプール最大長ガード＆循環参照カットによるメモリリーク完全防止
 * ・リングバッファ O(1) 配列アクセス対応
 * ==============================================================================
 */

import { GRID_SIZE } from './constants.js';

const MAX_POOL_CAPACITY = 4096; // メモリ肥大化を防ぐプール上限値

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
            if (this.cellPool.length < 1024) {
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
     * 衝突判定メイン（頭部同士の正面衝突 ＋ 頭部vs胴体の衝突）
     */
    checkHeadCollisions(snakes, onKill) {
        const total = snakes.length;

        // =========================================================================
        // 1. ★ 頭部同士の正面衝突（Head-on Collision）判定
        // 二重ループの配列順序による理不尽な一方的爆死を根絶
        // =========================================================================
        for (let i = 0; i < total; i++) {
            const sA = snakes[i];
            if (sA.isDead || !sA.isVisible) continue;

            for (let j = i + 1; j < total; j++) {
                const sB = snakes[j];
                if (sB.isDead || !sB.isVisible) continue;

                const dx = sA.x - sB.x;
                const dy = sA.y - sB.y;
                const minHeadDist = sA.size + sB.size;

                if (dx * dx + dy * dy < minHeadDist * minHeadDist) {
                    const isAInvuln = Boolean(sA.invulnerableTimer && sA.invulnerableTimer > 0);
                    const isBInvuln = Boolean(sB.invulnerableTimer && sB.invulnerableTimer > 0);

                    // どちらかが無敵なら双方ノックバックで弾き飛ばし
                    if (isAInvuln || isBInvuln) {
                        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                        const push = (minHeadDist - dist) * 0.5 + 2.0;
                        sA.x += (dx / dist) * push;
                        sA.y += (dy / dist) * push;
                        sB.x -= (dx / dist) * push;
                        sB.y -= (dy / dist) * push;
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
                        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                        const push = (minHeadDist - dist) * 0.6 + 3.0;
                        sA.x += (dx / dist) * push;
                        sA.y += (dy / dist) * push;
                        sB.x -= (dx / dist) * push;
                        sB.y -= (dy / dist) * push;
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

                        const dx = hx - bodyNode.x;
                        const dy = hy - bodyNode.y;
                        const minDist = hRadius + bodyNode.radius * 0.75;

                        // 接触判定
                        if (dx * dx + dy * dy < minDist * minDist) {
                            const isVictimInvuln = Boolean(victim.invulnerableTimer && victim.invulnerableTimer > 0);
                            const isKillerInvuln = Boolean(killer.invulnerableTimer && killer.invulnerableTimer > 0);

                            // ★ 無敵特攻キルの完全根絶：
                            if (isVictimInvuln || isKillerInvuln) {
                                if (isVictimInvuln && victim.invulnerableTimer < 0.2) {
                                    victim.invulnerableTimer = 0.4;
                                }
                                if (isKillerInvuln && killer.invulnerableTimer < 0.2) {
                                    killer.invulnerableTimer = 0.4;
                                }

                                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                                const pushForce = (minDist - dist) * 0.18 + 1.2;
                                victim.x += (dx / dist) * pushForce;
                                victim.y += (dy / dist) * pushForce;
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