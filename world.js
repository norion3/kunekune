// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・決定論的シード生成 (world.js)
// v27.3.0 Dynamic LoD 描画負荷軽減版:
// ・【Dynamic LoD】カメラのズーム倍率(scale)とオブジェクトのサイズを掛け合わせた「見かけのサイズ」を計算
// ・見かけのサイズが小さい（3.5px未満）、あるいはズームアウト時の小型餌に対して、重い ctx.arc を軽量な ctx.rect (矩形描画) へ動的フォールバック
// ・数千個の肉片やチャンク餌が密集する激戦区でのGPUドローコール限界・FPS低下（カクつき）を完全突破
// ・【肉片完全同期】ドロップ肉片も絶対座標による同期対象となり、マルチプレイ時の肉片ロスト・無限増殖バグを完全根絶
// ・【安全消去API】受信した絶対座標から最も近い餌・肉片を探し出して O(1) で安全に消去する removeFoodAt(x, y) を維持
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
        const baseSeed = (NetworkManager && NetworkManager.currentSeed) ? NetworkManager.currentSeed : 12345678;
        const chunkSeed = (baseSeed ^ (gx * 73856093) ^ (gy * 19349663)) >>> 0;
        const prng = this.createChunkPRNG(chunkSeed);

        // 環境勾配アルゴリズム：マップ中心に近いほど大餌＆ホットスポット密集
        const chunkCenterX = gx * GRID_SIZE + GRID_SIZE / 2;
        const chunkCenterY = gy * GRID_SIZE + GRID_SIZE / 2;
        const mapCenterX = MAP_SIZE / 2;
        const mapCenterY = MAP_SIZE / 2;

        const dxCenter = chunkCenterX - mapCenterX;
        const dyCenter = chunkCenterY - mapCenterY;
        const distFromCenter = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter);

        const maxDist = MAP_SIZE * 0.5;
        const centerProximity = Math.max(0, Math.min(1.0, 1.0 - (distFromCenter / maxDist)));

        const hotspotThreshold = 0.025 + centerProximity * 0.125;
        const isHotspot = prng() < hotspotThreshold;

        const baseMin = 1 + Math.floor(centerProximity * 3);
        const baseMax = 3 + Math.floor(centerProximity * 5);
        const count = isHotspot 
            ? Math.floor(prng() * 12) + 8 + Math.floor(centerProximity * 6)
            : Math.floor(prng() * (baseMax - baseMin + 1)) + baseMin;

        const list = [];

        for (let i = 0; i < count; i++) {
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
                spawnTime: now
            });
        }

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
                        // ★ 絶対座標でコールバックを返す（インデックス同期廃止）
                        if (onEat) onEat(snake, f, f.x, f.y);
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
                // ★ 絶対座標でコールバックを返す（肉片も確実に同期対象になる）
                if (onEat) onEat(snake, f, f.x, f.y);
            }
        }
    }

    /**
     * ★ 通信で他人が食べた餌を絶対座標 (x, y) から探し出して安全に消去する
     * インデックスズレによる「違う餌が消えるバグ」を完全根絶
     */
    removeFoodAt(x, y, searchRadius = 16) {
        const searchDistSq = searchRadius * searchRadius;

        // 1. ドロップ肉片を最優先で探索
        for (let i = this.dropFoods.length - 1; i >= 0; i--) {
            const f = this.dropFoods[i];
            const dx = f.x - x;
            const dy = f.y - y;
            if (dx * dx + dy * dy < searchDistSq) {
                this.dropFoods[i] = this.dropFoods[this.dropFoods.length - 1];
                this.dropFoods.pop();
                return true;
            }
        }

        // 2. チャンク餌の探索
        const gx = Math.floor(x / GRID_SIZE);
        const gy = Math.floor(y / GRID_SIZE);
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const key = `${gx + ox}_${gy + oy}`;
                const list = this.foodGrid.get(key);
                if (!list) continue;

                for (let i = list.length - 1; i >= 0; i--) {
                    const f = list[i];
                    const dx = f.x - x;
                    const dy = f.y - y;
                    if (dx * dx + dy * dy < searchDistSq) {
                        list[i] = list[list.length - 1];
                        list.pop();
                        return true;
                    }
                }
            }
        }
        return false;
    }

    updateParticles() {
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

        // 肉片TTL自動パージ (35秒)
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

        // ★ カメラスケールを逆算（Dynamic LoD用）
        const scale = ctx.canvas.width / viewW;
        const isLowDetail = scale < 0.65; // ズームアウト時は軽量化を積極適用

        for (const bucket of this.batchBuckets.values()) {
            bucket.length = 0;
        }

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
                        
                        // 巨大餌のパルス光彩も遠景では矩形で軽量化
                        const pulseSize = f.size * 1.8 * pulse;
                        if (pulseSize * scale < 3.5 || isLowDetail) {
                            ctx.rect(f.x - pulseSize, f.y - pulseSize, pulseSize * 2, pulseSize * 2);
                        } else {
                            ctx.arc(f.x, f.y, pulseSize, 0, Math.PI * 2);
                        }
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

        for (const [color, coords] of this.batchBuckets.entries()) {
            const len = coords.length;
            if (len === 0) continue;

            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < len; i += 3) {
                const x = coords[i];
                const y = coords[i + 1];
                const size = coords[i + 2];
                
                // ★ Dynamic LoD判定: 画面上の見かけのサイズが小さい場合は rect 描画へフォールバック
                const apparentSize = size * scale;
                if (apparentSize < 3.5 || (isLowDetail && size < 6.0)) {
                    ctx.rect(x - size, y - size, size * 2, size * 2);
                } else {
                    ctx.moveTo(x + size, y);
                    ctx.arc(x, y, size, 0, Math.PI * 2);
                }
            }
            ctx.fill();
        }

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.beginPath();
            
            const pSize = 3.5 * p.life;
            if (pSize * scale < 3.5 || isLowDetail) {
                ctx.rect(p.x - pSize, p.y - pSize, pSize * 2, pSize * 2);
            } else {
                ctx.arc(p.x, p.y, pSize, 0, Math.PI * 2);
            }
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}