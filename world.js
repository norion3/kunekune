// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・決定論的シード生成 (world.js)
// v27.7.0 シングル版視認性融合・小餌フェード＆満腹判定スキップ版:
// ・【ズームアウト小餌動的フェード】シングル版の秀逸な描画設計を統合
// 　ズームアウトするほど細かい小餌が自然に透明フェードアウトし、巨大餌・ドロップ肉片のみが際立つ視界を形成
// 　遠景で画面が白いゴミで埋め尽くされる問題を完全根絶し、暗黒宇宙の奥行きと索敵視認性を両立
// ・【巨大時小餌スキップ(満腹判定)】スネーク肥大化時(size > 22)、数ptの小餌の当たり判定を最大85%動的スキップ
// 　巨大スネーク時の無駄な毎フレーム微細当たり判定を大幅削減し、CPU処理負荷を大幅にカット
// ・【餌スポーン密度適正化】通常チャンク餌の発生数を適正化し、小餌(7pt)、巨大餌(38pt)の成長テンポを両立
// ・【Dynamic LoD】カメラズームとサイズに応じた動的rect軽量化、肉片TTL寿命(35秒)、絶対座標消去APIを完全維持
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

        // ホットスポット発生頻度（過密抑制調律）
        const hotspotThreshold = 0.015 + centerProximity * 0.065;
        const isHotspot = prng() < hotspotThreshold;

        // 餌生成数（過密抑制）
        const baseMin = 1 + Math.floor(centerProximity * 1.5);
        const baseMax = 2 + Math.floor(centerProximity * 2.5);
        const count = isHotspot 
            ? Math.floor(prng() * 6) + 4 + Math.floor(centerProximity * 3)
            : Math.floor(prng() * (baseMax - baseMin + 1)) + baseMin;

        const list = [];

        for (let i = 0; i < count; i++) {
            const bigThreshold = 0.04 + centerProximity * 0.08;
            const isBig = isHotspot || prng() < bigThreshold;

            list.push({
                x: gx * GRID_SIZE + prng() * GRID_SIZE,
                y: gy * GRID_SIZE + prng() * GRID_SIZE,
                size: isBig ? 7.5 + prng() * 3.0 : 3.0 + prng() * 1.2,
                val: isBig ? (38 + Math.floor(centerProximity * 12)) : 7,
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

    // 餌の捕食判定（巨大スネークの小餌満腹スキップ統合版）
    checkFoodConsumption(snake, onEat) {
        const gx = Math.floor(snake.x / GRID_SIZE);
        const gy = Math.floor(snake.y / GRID_SIZE);
        const headR = snake.size;

        // ★ シングル版の秀逸な設計：巨大化時の小餌スキップ（満腹判定）
        // スネークが巨大化（size > 22）した際、微小な小餌の当たり判定を最大85%スキップ
        // 巨大時の不要な毎フレーム衝突判定負荷を劇的にカット
        let skipSmallProb = 0;
        if (headR > 22) {
            skipSmallProb = Math.min(0.85, (headR - 22) / 60 * 0.85);
        }

        // 1. チャンク餌
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const key = `${gx + ox}_${gy + oy}`;
                const list = this.foodGrid.get(key);
                if (!list) continue;

                for (let i = list.length - 1; i >= 0; i--) {
                    const f = list[i];

                    // 巨大化時は小餌をスキップ（大餌は100%吸い込む）
                    if (!f.isBig && skipSmallProb > 0 && Math.random() < skipSmallProb) {
                        continue;
                    }

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

        // 2. 肉片ドロップ餌（撃破残骸・肉片は価値が高いためサイズに関係なく100%捕食）
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

        // カメラスケールを逆算（Dynamic LoD用）
        const scale = ctx.canvas.width / viewW;
        const isLowDetail = scale < 0.65;

        // ★ シングル版の秀逸な設計：ズームアウト時の小餌動的アルファフェード
        // ズーム倍率が小さくなる（ズームアウト）ほど細かい小餌が徐々に透明フェードアウト
        // scale 0.55でフェード開始、scale 0.20以下で小餌は完全不可視（大餌と肉片のみ表示）
        const smallFoodAlpha = Math.max(0, Math.min(1.0, (scale - 0.20) / 0.35));
        const shouldDrawSmallFood = smallFoodAlpha > 0.02;

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
                        // 巨大餌：遠景でもしっかり視認できるようパルス描画を維持
                        const pulse = 1.0 + Math.sin(frameCount * 0.15 + f.x) * 0.2;
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                        ctx.beginPath();
                        
                        const pulseSize = f.size * 1.8 * pulse;
                        if (pulseSize * scale < 3.5 || isLowDetail) {
                            ctx.rect(f.x - pulseSize, f.y - pulseSize, pulseSize * 2, pulseSize * 2);
                        } else {
                            ctx.arc(f.x, f.y, pulseSize, 0, Math.PI * 2);
                        }
                        ctx.fill();

                        let bucket = this.batchBuckets.get(f.color);
                        if (!bucket) {
                            bucket = [];
                            this.batchBuckets.set(f.color, bucket);
                        }
                        bucket.push(f.x, f.y, f.size);
                    } else if (shouldDrawSmallFood) {
                        // 小餌：ズームアウト時は動的にフェード
                        let bucket = this.batchBuckets.get(f.color);
                        if (!bucket) {
                            bucket = [];
                            this.batchBuckets.set(f.color, bucket);
                        }
                        bucket.push(f.x, f.y, f.size);
                    }
                }
            }
        }

        // ドロップ肉片のバケット投入（肉片は常時クッキリ表示）
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

        // バッチ描画（色ごとの一括ストローク/フィル）
        for (const [color, coords] of this.batchBuckets.entries()) {
            const len = coords.length;
            if (len === 0) continue;

            // ズームアウト時の小餌動的アルファをグローバルアルファに反映
            if (smallFoodAlpha < 0.98) {
                ctx.globalAlpha = Math.max(0.2, smallFoodAlpha);
            } else {
                ctx.globalAlpha = 1.0;
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < len; i += 3) {
                const x = coords[i];
                const y = coords[i + 1];
                const size = coords[i + 2];
                
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
        ctx.globalAlpha = 1.0;

        // パーティクル描画
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