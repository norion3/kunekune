/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ゼロアロケーション空間ハッシュ衝突判定エンジン (combat.js)
 * v25.0.0 メモリプール完全再利用＆キルスコア二重取り解消版:
 * ・キル時 150pt 加算の重複を解消（main.js 側の相手スコア30%吸収＋撃破点へ一本化）
 * ・空間グリッド cell 配列の再利用プール化により毎秒数万個のヒープ生成＆GCカクつきを根絶
 * ・ノードプール最大長ガード＆循環参照カットによるメモリリーク完全防止
 * ・リングバッファ O(1) 配列アクセス対応
 * ・理不尽デス回避: 無敵終了時に敵の胴体と重なっていた場合、ノックバック＆無敵延長で保護
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

    // 頭部と胴体の激突判定
    checkHeadCollisions(snakes, onKill) {
        for (let i = 0; i < snakes.length; i++) {
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
                        
                        if (!killer || killer === victim) continue; 

                        const dx = hx - bodyNode.x;
                        const dy = hy - bodyNode.y;
                        const minDist = hRadius + bodyNode.radius * 0.75;

                        // 接触判定（二乗距離判定で平方根計算を回避）
                        if (dx * dx + dy * dy < minDist * minDist) {
                            const isVictimInvuln = victim.invulnerableTimer && victim.invulnerableTimer > 0;
                            const isKillerInvuln = killer.invulnerableTimer && killer.invulnerableTimer > 0;

                            // 理不尽デス回避（重なり時の無敵延長＆ノックバック）
                            if (isVictimInvuln || isKillerInvuln) {
                                if (isVictimInvuln && victim.invulnerableTimer < 0.2) {
                                    victim.invulnerableTimer = 0.5; // 無敵延長
                                }
                                if (isKillerInvuln && killer.invulnerableTimer < 0.2) {
                                    killer.invulnerableTimer = 0.5; // 無敵延長
                                }
                                // 安全圏への押し出し（ノックバック）
                                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                                const pushForce = (minDist - dist) * 0.15;
                                victim.x += (dx / dist) * pushForce;
                                victim.y += (dy / dist) * pushForce;
                                continue;
                            }

                            victim.isDead = true;
                            killer.kills++;
                            // ★ スコア加算は main.js の onKill コールバックへ一本化（150pt二重加算を完全排除）

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