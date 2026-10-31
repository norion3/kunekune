// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・パーティクル (world.js)
// v20.3.0 ゼロアロケーション描画最適化版:
// ・draw() 内の毎フレーム new Map() / 配列生成を根絶（GCスパイク完全解消）
// ・事前確保バケットによる色別バッチ描画（GPUドローコール最小化）
// ・撃破時ドロップ肉片・チャンク餌の O(1) 末尾スワップ高速消費
// ==============================================================================

import { MAP_SIZE, GRID_SIZE, FOOD_COLORS } from './constants.js';

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
        const isHotspot = Math.random() < 0.04;
        const count = isHotspot ? Math.floor(Math.random() * 12) + 8 : Math.floor(Math.random() * 4) + 1;
        const list = [];

        for (let i = 0; i < count; i++) {
            const isBig = isHotspot || Math.random() < 0.08;
            list.push({
                x: gx * GRID_SIZE + Math.random() * GRID_SIZE,
                y: gy * GRID_SIZE + Math.random() * GRID_SIZE,
                size: isBig ? 8 + Math.random() * 3 : 3 + Math.random() * 1.5,
                val: isBig ? 24 : 4,
                isBig: isBig,
                color: isBig ? '#ffffff' : FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)]
            });
        }

        this.foodGrid.set(`${gx}_${gy}`, list);
    }

    // 撃破されたスネークの肉片ドロップ
    spawnDeathDrop(snake) {
        const histLen = snake.historyLength || 0;
        for (let i = 0; i < histLen; i += 2) {
            const idx = (snake.headIdx + i) % 2048; // MAX_HISTORY = 2048
            const pt = snake.history[idx];
            if (!pt) continue;
            
            this.dropFoods.push({
                x: pt.x + (Math.random() - 0.5) * 20,
                y: pt.y + (Math.random() - 0.5) * 20,
                size: 7 + Math.random() * 4,
                val: 18 + Math.random() * 12,
                isBig: true,
                color: snake.color
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
                        // GC負荷軽減：O(1)末尾スワップによる超高速削除
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
                // GC負荷軽減：O(1)末尾スワップによる超高速削除
                this.dropFoods[i] = this.dropFoods[this.dropFoods.length - 1];
                this.dropFoods.pop();
                if (onEat) onEat(snake, f, null, null, i);
            }
        }
    }

    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.04;
            if (p.life <= 0) {
                // GC負荷軽減：O(1)末尾スワップによる超高速削除
                this.particles[i] = this.particles[this.particles.length - 1];
                this.particles.pop();
            }
        }
    }

    draw(ctx, cameraX, cameraY, viewW, viewH, frameCount) {
        const minGx = Math.floor(cameraX / GRID_SIZE) - 1;
        const maxGx = Math.floor((cameraX + viewW) / GRID_SIZE) + 1;
        const minGy = Math.floor(cameraY / GRID_SIZE) - 1;
        const maxGy = Math.floor((cameraY + viewH) / GRID_SIZE) + 1;

        // ゼロアロケーション：既存バケットのクリア（新規インスタンスを生成しない）
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
                    // x, y, size をフラットに蓄積（一時オブジェクト生成ゼロ）
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

        // 一括バッチ描画実行（ドローコールを色数分に激減）
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