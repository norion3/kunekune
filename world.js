// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・決定論的シード生成 (world.js)
// v26.0.0 肉片TTL寿命クリーンアップ＆長時間稼働安定化版:
// ・【肉片TTL導入】撃破ドロップ肉片に35秒寿命（TTL: 35,000ms）を設定し、過疎地の死体残骸をO(1)自動パージ
// ・10分以上の長期対戦でも dropFoods が肥大化せず、毎フレーム数十万回の距離判定・CPU熱暴走を完全根絶
// ・ホスト/ゲスト間のシード値（currentSeed）に基づく線形合同法（LCG）疑似乱数
// ・チャンク座標（gx, gy）から決定論的に初期餌の座標・サイズ・色を生成（完全同期）
// ・MAP_SIZE = 60000 を活かしたマップ中心（激戦コア）集中ホットスポット勾配
// ・外周部の安全育成ゾーン（小餌中心・敵過疎）の自律形成
// ・draw() 内のゼロアロケーション色別バッチ描画（GPUドローコール最小化）
// ・撃破時ドロップ肉片・チャンク餌の O(1) 末尾スワップ高速消費
// ==============================================================================

import { MAP_SIZE, GRID_SIZE, FOOD_COLORS } from './constants.js';
import { NetworkManager } from './network.js';

export class WorldManager {
    constructor() {
        this.foodGrid = new Map();
        this.generatedChunks = new Set();
        this.dropFoods = [];
        this.particles = [];

        // ゼロアロケーション用色別描画バケット（毎フレーム new Map しない）
        this.batchBuckets = new Map();
    }

    clear() {
        this.foodGrid.clear();
        this.generatedChunks.clear();
        this.dropFoods = [];
        this.particles = [];
        this.batchBuckets.clear();
    }

    /**
     * 決定論的疑似乱数生成器（線形合同法: LCG）
     * チャンク座標とワールドシードから全端末で寸分違わず同じ乱数列を生成
     * @param {number} seed 
     * @returns {function(): number} 0.0 以上 1.0 未満の浮動小数点数を返す乱数関数
     */
    createChunkPRNG(seed) {
        let s = Math.abs(seed | 0) || 12345678;
        return function() {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    // プレイヤー視界周辺のチャンクを動的生成
    updateChunks(playerX, playerY, viewRadius) {
        const minGx = Math.max(0, Math.floor((playerX - viewRadius) / GRID_SIZE));
        const maxGx = Math.min(Math.floor(MAP_SIZE / GRID_SIZE), Math.floor((playerX + viewRadius) / GRID_SIZE));
        const minGy = Math.max(0, Math.floor((playerY - viewRadius) / GRID_SIZE));
        const maxGy = Math.min(Math.floor(MAP_SIZE / GRID_SIZE), Math.floor((playerY + viewRadius) / GRID_SIZE));

        for (let gx = minGx; gx <= maxGx; gx++) {
            for (let gy = minGy; gy <= maxGy; gy++) {
                const key = `${gx}_${gy}`;
                if (!this.generatedChunks.has(key)) {
                    this.generatedChunks.add(key);
                    this.spawnChunkFoods(gx, gy);
                }
            }
        }

        // 遠隔チャンクのバッチ破棄（メモリ上限管理）
        if (this.generatedChunks.size > 900) {
            const deleteKeys = [];
            const maxDistSq = (viewRadius * 2.2) ** 2;

            for (let key of this.generatedChunks) {
                const [gxStr, gyStr] = key.split('_');
                const cx = parseInt(gxStr, 10) * GRID_SIZE;
                const cy = parseInt(gyStr, 10) * GRID_SIZE;
                const distSq = (cx - playerX) ** 2 + (cy - playerY) ** 2;
                if (distSq > maxDistSq) {
                    deleteKeys.push(key);
                }
            }

            for (let k of deleteKeys) {
                this.generatedChunks.delete(k);
                this.foodGrid.delete(k);
            }
        }
    }

    spawnChunkFoods(gx, gy) {
        // 決定論的シード値の導出：ワールドシードとチャンク座標を混合
        const baseSeed = (NetworkManager && NetworkManager.currentSeed) ? NetworkManager.currentSeed : 12345678;
        const chunkSeed = (baseSeed ^ (gx * 73856093) ^ (gy * 19349663)) >>> 0;
        const prng = this.createChunkPRNG(chunkSeed);

        // 環境勾配アルゴリズム：マップ中心（30000, 30000）に近いほど大餌＆ホットスポット密集
        const chunkCenterX = gx * GRID_SIZE + GRID_SIZE / 2;
        const chunkCenterY = gy * GRID_SIZE + GRID_SIZE / 2;
        const mapCenterX = MAP_SIZE / 2;
        const mapCenterY = MAP_SIZE / 2;

        const dxCenter = chunkCenterX - mapCenterX;
        const dyCenter = chunkCenterY - mapCenterY;
        const distFromCenter = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter);

        // 中心度（中心で 1.0、外周で 0.0）
        const maxDist = MAP_SIZE * 0.5;
        const centerProximity = Math.max(0, Math.min(1.0, 1.0 - (distFromCenter / maxDist)));

        // 中心に近いほどホットスポット発生率が大幅上昇（外周: 2.5% -> 中心: 15%）
        const hotspotThreshold = 0.025 + centerProximity * 0.125;
        const isHotspot = prng() < hotspotThreshold;

        // 餌の個数も中心ほど高密度
        const baseMin = 1 + Math.floor(centerProximity * 3);
        const baseMax = 3 + Math.floor(centerProximity * 5);
        const count = isHotspot 
            ? Math.floor(prng() * 12) + 8 + Math.floor(centerProximity * 6)
            : Math.floor(prng() * (baseMax - baseMin + 1)) + baseMin;

        const list = [];

        for (let i = 0; i < count; i++) {
            // 大餌判定（中心に近いほど大餌の比率が上がる）
            const bigThreshold = 0.05 + centerProximity * 0.12;
            const isBig = isHotspot || prng() < bigThreshold;

            list.push({
                x: gx * GRID_SIZE + prng() * GRID_SIZE,
                y: gy * GRID_SIZE + prng() * GRID_SIZE,
                size: isBig ? 8 + prng() * 3.5 : 3 + prng() * 1.5,
                val: isBig ? (24 + Math.floor(centerProximity * 8)) : 4,
                isBig: isBig,
                color: isBig ? '#ffffff' : FOOD_COLORS[Math.floor(prng() * FOOD_COLORS.length)]
            });
        }

        this.foodGrid.set(`${gx}_${gy}`, list);
    }

    // 撃破されたスネークの肉片ドロップ（TTLタイムスタンプ付き）
    spawnDeathDrop(snake) {
        const histLen = snake.historyLength || 0;
        const now = performance.now();
        for (let i = 0; i < histLen; i += 2) {
            const idx = (snake.headIdx + i) % 2048;
            const pt = snake.history[idx];
            if (!pt) continue;
            
            this.dropFoods.push({
                x: pt.x + (Math.random() - 0.5) * 20,
                y: pt.y + (Math.random() - 0.5) * 20,
                size: 7 + Math.random() * 4,
                val: 18 + Math.random() * 12,
                isBig: true,
                color: snake.color,
                spawnTime: now // ★ 寿命（TTL）計測用タイムスタンプ
            });
        }

        // 爆発パーティクル
        for (let p = 0; p < 18; p++) {
            this.particles.push({
                x: snake.x,
                y: snake.y,
                vx: (Math.random() - 0.5) * 8,
                vy: (Math.random() - 0.5) * 8,
                life: 1.0,
                color: snake.color
            });
        }
    }

    // 餌の捕食判定
    checkFoodConsumption(snake, onEat) {
        const gx = Math.floor(snake.x / GRID_SIZE);
        const gy = Math.floor(snake.y / GRID_SIZE);
        const headR = snake.size;

        // 1. チャンク餌
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const key = `${gx + ox}_${gy + oy}`;
                const list = this.foodGrid.get(key);
                if (!list) continue;

                for (let i = list.length - 1; i >= 0; i--) {
                    const f = list[i];
                    const dx = snake.x - f.x;
                    const dy = snake.y - f.y;
                    if (dx * dx + dy * dy < (headR + f.size) ** 2) {
                        snake.addScore(f.val);
                        list[i] = list[list.length - 1];
                        list.pop();
                        if (onEat) onEat(snake, f, gx + ox, gy + oy, i);
                    }
                }
            }
        }

        // 2. 肉片ドロップ餌
        for (let i = this.dropFoods.length - 1; i >= 0; i--) {
            const f = this.dropFoods[i];
            const dx = snake.x - f.x;
            const dy = snake.y - f.y;
            if (dx * dx + dy * dy < (headR + f.size) ** 2) {
                snake.addScore(f.val);
                this.dropFoods[i] = this.dropFoods[this.dropFoods.length - 1];
                this.dropFoods.pop();
                if (onEat) onEat(snake, f, null, null, i);
            }
        }
    }

    /**
     * パーティクル更新 ＆ 未回収肉片の寿命（TTL: 35秒）自動クリーンアップ
     */
    updateParticles() {
        // 1. パーティクル更新
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.04;
            if (p.life <= 0) {
                this.particles[i] = this.particles[this.particles.length - 1];
                this.particles.pop();
            }
        }

        // 2. ★ 肉片ドロップ餌の寿命（TTL: 35秒）自動パージ
        // 長時間プレイ時の未回収肉片の無限蓄積・毎フレーム数十万回判定を完全防止
        const now = performance.now();
        for (let i = this.dropFoods.length - 1; i >= 0; i--) {
            const f = this.dropFoods[i];
            if (!f.spawnTime) f.spawnTime = now;
            if (now - f.spawnTime > 35000) {
                this.dropFoods[i] = this.dropFoods[this.dropFoods.length - 1];
                this.dropFoods.pop();
            }
        }
    }

    draw(ctx, cameraX, cameraY, viewW, viewH, frameCount) {
        const minGx = Math.floor(cameraX / GRID_SIZE) - 1;
        const maxGx = Math.floor((cameraX + viewW) / GRID_SIZE) + 1;
        const minGy = Math.floor(cameraY / GRID_SIZE) - 1;
        const maxGy = Math.floor((cameraY + viewH) / GRID_SIZE) + 1;

        // ゼロアロケーション：既存バケットのクリア
        for (const bucket of this.batchBuckets.values()) {
            bucket.length = 0;
        }

        // チャンク餌描画の収集
        for (let gx = minGx; gx <= maxGx; gx++) {
            for (let gy = minGy; gy <= maxGy; gy++) {
                const list = this.foodGrid.get(`${gx}_${gy}`);
                if (!list) continue;

                for (let i = 0; i < list.length; i++) {
                    const f = list[i];
                    if (f.isBig) {
                        const pulse = 1.0 + Math.sin(frameCount * 0.15 + f.x) * 0.2;
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                        ctx.beginPath();
                        ctx.arc(f.x, f.y, f.size * 1.8 * pulse, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    
                    let bucket = this.batchBuckets.get(f.color);
                    if (!bucket) {
                        bucket = [];
                        this.batchBuckets.set(f.color, bucket);
                    }
                    bucket.push(f.x, f.y, f.size);
                }
            }
        }

        // 肉片ドロップ餌の収集
        for (let i = 0; i < this.dropFoods.length; i++) {
            const f = this.dropFoods[i];
            if (f.x < cameraX - 50 || f.x > cameraX + viewW + 50 || f.y < cameraY - 50 || f.y > cameraY + viewH + 50) continue;
            
            const pulse = 1.0 + Math.sin(frameCount * 0.2 + f.x) * 0.25;
            let bucket = this.batchBuckets.get(f.color);
            if (!bucket) {
                bucket = [];
                this.batchBuckets.set(f.color, bucket);
            }
            bucket.push(f.x, f.y, f.size * pulse);
        }

        // 一括バッチ描画実行（色ごとに単一パス発行）
        for (const [color, coords] of this.batchBuckets.entries()) {
            const len = coords.length;
            if (len === 0) continue;

            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < len; i += 3) {
                const x = coords[i];
                const y = coords[i + 1];
                const size = coords[i + 2];
                ctx.moveTo(x + size, y);
                ctx.arc(x, y, size, 0, Math.PI * 2);
            }
            ctx.fill();
        }

        // パーティクル描画
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5 * p.life, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}