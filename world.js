// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・決定論的シード生成 (world.js)
// v30.0.0 ズーム時大餌真円発光完全復元＆小餌インテリジェント間引き版:
// ・【大餌・肉片の真円パルス発光完全復元】ズームアウト時でも四角形化（rect）を完全廃止。
// 　大餌（val 22〜42）および撃破肉片はどんな遠景でも通常時と同じ美しい真円（arc）と
// 　淡黄色・極上ネオンパルスオーラで発光し続け、遠くからでもごちそうの山が一目瞭然
// ・【小餌の階層的スマート間引き】視界を引いた際に画面を埋め尽くしていた四角いノイズを全廃。
// 　カメラスケールに応じて価値の低い小餌（4〜6pt）をチラつきなく決定論的に間引き
// 　（scale < 0.60で約65%間引き、scale < 0.40で完全非表示）。
// 　漆黒の宇宙空間に「自機」「敵スネーク」「輝く大餌・肉片」だけがクリアに浮かび上がる
// ・【ズーム時チャンク爆発防止】視野生成半径(viewRadius)を最大8000pxに安全クランプ
// ・【チャンクスラッシング防止】チャンク保持上限2,500個により60FPSを完全維持
// ・【環境勾配ホットスポット完全維持】5%確率・密集ホットスポット＆大・中・小3段階餌
// ・【絶対座標消去API完全維持】removeFoodAt(x, y) による通信同期ズレ完全排除
// ==============================================================================

import { MAP_SIZE, GRID_SIZE, FOOD_COLORS } from './constants.js';
import { NetworkManager } from './network.js';

export class WorldManager {
    constructor() {
        this.foodGrid = new Map();
        this.generatedChunks = new Set();
        this.dropFoods = [];
        this.particles = [];

        // ゼロアロケーション用色別描画バケット
        this.batchBuckets = new Map();
        // 大餌・肉片専用オーラ描画用バッファ [x, y, radius]
        this.bigAuraBuffer = [];
    }

    clear() {
        this.foodGrid.clear();
        this.generatedChunks.clear();
        this.dropFoods = [];
        this.particles = [];
        this.batchBuckets.clear();
        this.bigAuraBuffer.length = 0;
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

    // プレイヤー視界周辺のチャンクを動的生成（ズーム時のチャンク大爆発ガード付き）
    updateChunks(playerX, playerY, viewRadius) {
        const clampedRadius = Math.min(8000, viewRadius);

        const minGx = Math.max(0, Math.floor((playerX - clampedRadius) / GRID_SIZE));
        const maxGx = Math.min(Math.floor(MAP_SIZE / GRID_SIZE), Math.floor((playerX + clampedRadius) / GRID_SIZE));
        const minGy = Math.max(0, Math.floor((playerY - clampedRadius) / GRID_SIZE));
        const maxGy = Math.min(Math.floor(MAP_SIZE / GRID_SIZE), Math.floor((playerY + clampedRadius) / GRID_SIZE));

        for (let gx = minGx; gx <= maxGx; gx++) {
            for (let gy = minGy; gy <= maxGy; gy++) {
                const key = `${gx}_${gy}`;
                if (!this.generatedChunks.has(key)) {
                    this.generatedChunks.add(key);
                    this.spawnChunkFoods(gx, gy);
                }
            }
        }

        // 遠隔チャンクのバッチ破棄
        if (this.generatedChunks.size > 2500) {
            const deleteKeys = [];
            const maxDistSq = (clampedRadius * 1.8) ** 2;

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

    /**
     * ホットスポット群生地 ＆ 3段階美麗餌生成
     */
    spawnChunkFoods(gx, gy) {
        const baseSeed = (NetworkManager && NetworkManager.currentSeed) ? NetworkManager.currentSeed : 12345678;
        const chunkSeed = (baseSeed ^ (gx * 73856093) ^ (gy * 19349663)) >>> 0;
        const prng = this.createChunkPRNG(chunkSeed);

        // 環境勾配アルゴリズム：中心に近いほどホットスポット発生率上昇
        const chunkCenterX = gx * GRID_SIZE + GRID_SIZE / 2;
        const chunkCenterY = gy * GRID_SIZE + GRID_SIZE / 2;
        const mapCenterX = MAP_SIZE / 2;
        const mapCenterY = MAP_SIZE / 2;

        const dxCenter = chunkCenterX - mapCenterX;
        const dyCenter = chunkCenterY - mapCenterY;
        const distFromCenter = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter);

        const maxDist = MAP_SIZE * 0.5;
        const centerProximity = Math.max(0, Math.min(1.0, 1.0 - (distFromCenter / maxDist)));

        // 5%ホットスポット（密集地帯）
        const hotspotThreshold = 0.05 + centerProximity * 0.06;
        const isHotspot = prng() < hotspotThreshold;

        // 生成数（通常3〜7個、ホットスポットは最大26個）
        const baseCount = Math.floor(prng() * 5) + 3;
        const count = isHotspot ? Math.min(26, baseCount * 4 + Math.floor(centerProximity * 4)) : baseCount;

        const list = [];

        for (let i = 0; i < count; i++) {
            const randVal = prng();
            const largeProb = isHotspot ? 0.12 : 0.03 + centerProximity * 0.04;
            const medProb = isHotspot ? 0.35 : 0.14 + centerProximity * 0.08;

            let sizeCategory = 0; // 0: 小, 1: 中, 2: 大
            if (randVal < largeProb) {
                sizeCategory = 2;
            } else if (randVal < medProb) {
                sizeCategory = 1;
            }

            const x = gx * GRID_SIZE + prng() * GRID_SIZE;
            const y = gy * GRID_SIZE + prng() * GRID_SIZE;

            if (sizeCategory === 2) {
                // 大サイズ餌（val 22〜42、白色コア＋淡黄色オーラ）
                list.push({
                    x: x,
                    y: y,
                    val: Math.floor(22 + prng() * 20 + centerProximity * 10),
                    size: 9.5 + prng() * 3.5,
                    isBig: true,
                    isLargeAura: true,
                    color: '#ffffff'
                });
            } else if (sizeCategory === 1) {
                // 中サイズ餌（val 10〜20、カラーオーラ）
                list.push({
                    x: x,
                    y: y,
                    val: Math.floor(10 + prng() * 10),
                    size: 5.5 + prng() * 2.5,
                    isBig: true,
                    isLargeAura: false,
                    color: FOOD_COLORS[Math.floor(prng() * FOOD_COLORS.length)]
                });
            } else {
                // 小サイズ餌（val 4〜6）
                list.push({
                    x: x,
                    y: y,
                    val: 4 + Math.floor(prng() * 3),
                    size: 3.0 + prng() * 1.5,
                    isBig: false,
                    isLargeAura: false,
                    color: FOOD_COLORS[Math.floor(prng() * FOOD_COLORS.length)]
                });
            }
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
                isLargeAura: true,
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

                    if (!f.isBig && skipSmallProb > 0 && Math.random() < skipSmallProb) {
                        continue;
                    }

                    const dx = snake.x - f.x;
                    const dy = snake.y - f.y;
                    if (dx * dx + dy * dy < (headR + f.size) ** 2) {
                        snake.addScore(f.val);
                        list[i] = list[list.length - 1];
                        list.pop();
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
                if (onEat) onEat(snake, f, f.x, f.y);
            }
        }
    }

    /**
     * 通信で他人が食べた餌を絶対座標 (x, y) から探し出して安全に消去する
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

    /**
     * ★ 美麗真円パルスオーラ描画 ＆ 小餌インテリジェント間引き
     */
    draw(ctx, cameraX, cameraY, viewW, viewH, frameCount) {
        const minGx = Math.floor(cameraX / GRID_SIZE) - 1;
        const maxGx = Math.floor((cameraX + viewW) / GRID_SIZE) + 1;
        const minGy = Math.floor(cameraY / GRID_SIZE) - 1;
        const maxGy = Math.floor((cameraY + viewH) / GRID_SIZE) + 1;

        // カメラスケールを逆算
        const scale = ctx.canvas.width / viewW;

        // =========================================================================
        // 【小餌のスマート間引きフィルター設計】
        // ・scale >= 0.60: 100% 全て表示（近景・通常時）
        // ・0.40 <= scale < 0.60: 約33%のみ表示（小餌の2/3を間引いてスッキリ整理）
        // ・scale < 0.40: 小餌を100%完全非表示（超広域視界。大餌・肉片のみが輝く極上宇宙）
        // =========================================================================
        const isFarZoom = scale < 0.60;
        const isUltraZoom = scale < 0.40;

        for (const bucket of this.batchBuckets.values()) {
            bucket.length = 0;
        }
        this.bigAuraBuffer.length = 0;

        for (let gx = minGx; gx <= maxGx; gx++) {
            for (let gy = minGy; gy <= maxGy; gy++) {
                const list = this.foodGrid.get(`${gx}_${gy}`);
                if (!list) continue;

                for (let i = 0; i < list.length; i++) {
                    const f = list[i];

                    if (f.isBig) {
                        // ★ 大餌・中餌：遠景でも必ず美しい真円パルスオーラを放つ
                        const pulse = 1.0 + Math.sin(frameCount * 0.12 + f.x) * 0.24;
                        // 遠景ズーム時は画面上で見失わないよう最小見かけ半径(4.0px)を担保
                        const minPixelRadius = Math.max(f.size, 4.0 / scale);
                        const auraSize = minPixelRadius * (f.isLargeAura ? 2.3 : 1.7) * pulse;
                        this.bigAuraBuffer.push(f.x, f.y, auraSize);

                        let bucket = this.batchBuckets.get(f.color);
                        if (!bucket) {
                            bucket = [];
                            this.batchBuckets.set(f.color, bucket);
                        }
                        bucket.push(f.x, f.y, Math.max(f.size, 2.8 / scale));
                    } else if (!isUltraZoom) {
                        // ★ 小餌：遠景時は決定論的ハッシュでチラつきなく約67%をスマートに間引く
                        if (isFarZoom && ((gx * 31 + gy * 17 + i) % 3 !== 0)) {
                            continue;
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
        }

        // ドロップ肉片のバケット投入（どんな遠景でも100%真円パルス発光）
        for (let i = 0; i < this.dropFoods.length; i++) {
            const f = this.dropFoods[i];
            if (f.x < cameraX - 50 || f.x > cameraX + viewW + 50 || f.y < cameraY - 50 || f.y > cameraY + viewH + 50) continue;
            
            const pulse = 1.0 + Math.sin(frameCount * 0.18 + f.x) * 0.28;
            const minDropRadius = Math.max(f.size, 4.5 / scale);
            this.bigAuraBuffer.push(f.x, f.y, minDropRadius * 2.0 * pulse);

            let bucket = this.batchBuckets.get(f.color);
            if (!bucket) {
                bucket = [];
                this.batchBuckets.set(f.color, bucket);
            }
            bucket.push(f.x, f.y, Math.max(f.size, 3.0 / scale) * pulse);
        }

        // =========================================================================
        // 1. 淡い黄色の神秘的発光オーラ一括描画（★ 常に100%真円 arc で描画）
        // 四角形化（rect）を完全廃止し、遠景でも滑らかな光の玉として輝かせる
        // =========================================================================
        const auraLen = this.bigAuraBuffer.length;
        if (auraLen > 0) {
            ctx.fillStyle = 'rgba(255, 255, 200, 0.36)';
            ctx.beginPath();
            for (let i = 0; i < auraLen; i += 3) {
                const ax = this.bigAuraBuffer[i];
                const ay = this.bigAuraBuffer[i + 1];
                const as = this.bigAuraBuffer[i + 2];

                ctx.moveTo(ax + as, ay);
                ctx.arc(ax, ay, as, 0, Math.PI * 2);
            }
            ctx.fill();
        }

        // =========================================================================
        // 2. 餌コア本体のバッチ描画（★ 真円 arc 描画でブロックノイズを根絶）
        // =========================================================================
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

        // 3. パーティクル描画（超遠景時はスキップして視界をクリアに保つ）
        if (!isUltraZoom) {
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                ctx.fillStyle = p.color;
                ctx.globalAlpha = Math.max(0, p.life);
                ctx.beginPath();
                
                const pSize = 3.5 * p.life;
                ctx.arc(p.x, p.y, pSize, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
        }
    }
}