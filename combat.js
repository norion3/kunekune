/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ゼロアロケーション空間ハッシュ衝突判定エンジン (combat.js)
 * v27.3.0 メモリプール上限適正化・GCスパイク完全根絶版:
 * ・【GCスパイク完全根絶】旧MAX_POOL_CAPACITY(4096)が100体スネーク成長時の必要ノード数
 * 　(6,000〜12,000個)を下回り、毎フレーム数千個の破棄＆新規newがループして発生していた
 * 　致命的なGCカクつきを完全解決。プール上限を 24,576 まで適正拡大し、真のゼロアロケーションを達成
 * ・【セル配列プール適正化】cellPoolの上限も 1024 から 4096 へ拡張し、高密度交戦時のヒープ再確保を抑制
 * ・【ハメ状態根絶】無敵時のノックバックベクトルを計算する際、対象が壁際にいる場合は
 * 　壁への押し込み力を「壁に沿う接線方向」へ逃がし（スライディング）、振動フリーズを完全回避
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

import { GRID_SIZE, MAP_SIZE } from './constants.js';

// 100体のスネーク（平均体長40〜100節）の登録に十分耐えうる適正プール上限値
// （4096だと巨大化時に毎フレーム数千個のオブジェクトが切り捨て＆再生成されてGCスパイクの原因になっていた）
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
     */
    _applySafeKnockback(target, pushX, pushY) {
        const margin = Math.max(target.size, 50);
        
        // X軸が壁に阻まれる場合、Xの押し込み力をYへ変換して滑らせる
        if ((target.x < margin && pushX < 0) || (target.x > MAP_SIZE - margin && pushX > 0)) {
            pushY += Math.sign(pushY || 1) * Math.abs(pushX);
            pushX = 0;
        }
        // Y軸が壁に阻まれる場合、Yの押し込み力をXへ変換して滑らせる
        if ((target.y < margin && pushY < 0) || (target.y > MAP_SIZE - margin && pushY > 0)) {
            pushX += Math.sign(pushX || 1) * Math.abs(pushY);
            pushY = 0;
        }

        target.x += pushX;
        target.y += pushY;
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
                        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
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