/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ゼロアロケーション空間ハッシュ衝突判定エンジン (combat.js)
 * v18.0.0 改訂:
 * ・リスポーン直後の無敵時間（invulnerableTimer）を貫通・すり抜けするよう保護機能を追加
 * ・リスキル（復活直後の即死）を物理的に完全遮断
 * ==============================================================================
 */

import { GRID_SIZE } from './constants.js';

export class SpatialCollisionEngine {
    constructor() {
        this.grid = new Map();
        this.nodePool = [];
        this.poolIndex = 0;
    }

    clear() {
        this.grid.clear();
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

    // 全スネークの胴体体節を空間グリッドに登録
    registerBodies(snakes) {
        this.clear();

        for (let i = 0; i < snakes.length; i++) {
            const s = snakes[i];
            if (s.isDead || !s.isVisible) continue;

            const hist = s.history;
            const histLen = hist.length;

            // 頭部付近（先頭2節）は自爆防止のため登録しない
            for (let j = 3; j < histLen; j += 2) {
                const pt = hist[j];
                const progress = j / histLen;
                const radius = s.size * (1 - Math.pow(progress, 2.5) * 0.5);

                const gx = Math.floor(pt.x / GRID_SIZE);
                const gy = Math.floor(pt.y / GRID_SIZE);
                const key = `${gx}_${gy}`;

                let cell = this.grid.get(key);
                if (!cell) {
                    cell = [];
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

            // ★ 無敵時間中（リスポーン直後）の相手には判定を行わない（リスキル防止）
            if (victim.invulnerableTimer && victim.invulnerableTimer > 0) continue;

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
                        
                        if (killer === victim) continue; // 自分自身の体節はスキップ

                        // ★ 胴体側（壁を作った側）が無敵時間中の場合も、すり抜けるようにして理不尽な死を防ぐ
                        if (killer.invulnerableTimer && killer.invulnerableTimer > 0) continue;

                        const dx = hx - bodyNode.x;
                        const dy = hy - bodyNode.y;
                        const minDist = hRadius + bodyNode.radius * 0.75;

                        if (dx * dx + dy * dy < minDist * minDist) {
                            victim.isDead = true;
                            killer.kills++;
                            killer.addScore(150);

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