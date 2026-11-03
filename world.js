// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・決定論的シード生成 (world.js)
// v28.8.0 オリジナル美麗発光オーラ＆ホットスポット群生地完全復元版:
// ・【オリジナル神秘的発光オーラ復元】大餌の背後に淡い黄色の発光パルスオーラ
// 　(rgba(255, 255, 200, 0.35)) を完全復元。暗黒宇宙にポワッと美しく浮かび上がる極上の光の粒子を再現
// ・【オリジナル餌群生地(ホットスポット)復元】5%の確率で餌が5倍密集するホットスポットを配備
// 　マップ中心勾配と融合させ、探索して群生地を発見したときの興奮・快感を完全復活
// ・【大・中・小の3段階餌カテゴリ復元】大餌(20〜40pt/白オーラ)、中餌(10〜20pt/カラーオーラ)、
// 　小餌(3〜6pt/カラー)のサイズ・バリエーション階層をオリジナル準拠で再構築
// ・【小餌ズームアウト動的アルファフェード】ズームアウト時に小餌が優しくフェードアウトし、
// 　大餌の美しいオーラのみが浮かび上がる深宇宙の奥行きと視認性を両立
// ・【巨大時小餌スキップ(満腹判定)】スネーク肥大化時(size > 22)の当たり判定最大85%スキップを完全維持
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
        // 大餌専用オーラ描画用バッファ [x, y, radius]
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

    /**
     * ★ オリジナル完全復元：ホットスポット群生地 ＆ 3段階美麗餌生成
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

        // ★ オリジナル版の「5%ホットスポット（密集地帯）」
        const hotspotThreshold = 0.05 + centerProximity * 0.06;
        const isHotspot = prng() < hotspotThreshold;

        // 生成数（通常3〜7個、ホットスポットは5倍の密集！）
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
                // 大サイズ餌（オリジナル準拠：val 20〜40、真っ白なコア＋淡い黄色オーラ）
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
                // 中サイズ餌（オリジナル準拠：val 10〜20、鮮やかなカラー）
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
                // 小サイズ餌（オリジナル準拠：val 3〜6、繊細な光粒）
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

    // 餌の捕食判定（巨大スネークの小餌満腹スキップ統合版）
    checkFoodConsumption(snake, onEat) {
        const gx = Math.floor(snake.x / GRID_SIZE);
        const gy = Math.floor(snake.y / GRID_SIZE);
        const headR = snake.size;

        // スネーク巨大化時の小餌満腹スキップ
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

    /**
     * ★ オリジナル完全復元：美麗パルスオーラ描画 ＆ 高速バッチレンダリング
     */
    draw(ctx, cameraX, cameraY, viewW, viewH, frameCount) {
        const minGx = Math.floor(cameraX / GRID_SIZE) - 1;
        const maxGx = Math.floor((cameraX + viewW) / GRID_SIZE) + 1;
        const minGy = Math.floor(cameraY / GRID_SIZE) - 1;
        const maxGy = Math.floor((cameraY + viewH) / GRID_SIZE) + 1;

        // カメラスケールを逆算
        const scale = ctx.canvas.width / viewW;
        const isLowDetail = scale < 0.65;

        // ズームアウト時の小餌動的アルファフェード
        const smallFoodAlpha = Math.max(0, Math.min(1.0, (scale - 0.18) / 0.38));
        const shouldDrawSmallFood = smallFoodAlpha > 0.03;

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
                        // ★ オリジナル完全復元：大餌・中餌の神秘的な発光パルスオーラ
                        const pulse = 1.0 + Math.sin(frameCount * 0.12 + f.x) * 0.22;
                        const auraSize = f.size * (f.isLargeAura ? 2.1 : 1.6) * pulse;
                        this.bigAuraBuffer.push(f.x, f.y, auraSize);

                        let bucket = this.batchBuckets.get(f.color);
                        if (!bucket) {
                            bucket = [];
                            this.batchBuckets.set(f.color, bucket);
                        }
                        bucket.push(f.x, f.y, f.size);
                    } else if (shouldDrawSmallFood) {
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

        // ドロップ肉片のバケット投入
        for (let i = 0; i < this.dropFoods.length; i++) {
            const f = this.dropFoods[i];
            if (f.x < cameraX - 50 || f.x > cameraX + viewW + 50 || f.y < cameraY - 50 || f.y > cameraY + viewH + 50) continue;
            
            const pulse = 1.0 + Math.sin(frameCount * 0.18 + f.x) * 0.25;
            this.bigAuraBuffer.push(f.x, f.y, f.size * 1.8 * pulse);

            let bucket = this.batchBuckets.get(f.color);
            if (!bucket) {
                bucket = [];
                this.batchBuckets.set(f.color, bucket);
            }
            bucket.push(f.x, f.y, f.size * pulse);
        }

        // =========================================================================
        // 1. ★ オリジナル完全復元：淡い黄色の神秘的発光オーラ一括描画
        // rgba(255, 255, 200, 0.35) により、暗黒宇宙にポワッと光が灯る美しい質感を再現
        // =========================================================================
        const auraLen = this.bigAuraBuffer.length;
        if (auraLen > 0) {
            ctx.fillStyle = 'rgba(255, 255, 200, 0.32)';
            ctx.beginPath();
            for (let i = 0; i < auraLen; i += 3) {
                const ax = this.bigAuraBuffer[i];
                const ay = this.bigAuraBuffer[i + 1];
                const as = this.bigAuraBuffer[i + 2];

                if (as * scale < 3.0 || isLowDetail) {
                    ctx.rect(ax - as, ay - as, as * 2, as * 2);
                } else {
                    ctx.moveTo(ax + as, ay);
                    ctx.arc(ax, ay, as, 0, Math.PI * 2);
                }
            }
            ctx.fill();
        }

        // =========================================================================
        // 2. 餌コア本体のバッチ描画（色ごとの一括ストローク/フィル）
        // =========================================================================
        for (const [color, coords] of this.batchBuckets.entries()) {
            const len = coords.length;
            if (len === 0) continue;

            if (smallFoodAlpha < 0.98) {
                ctx.globalAlpha = Math.max(0.25, smallFoodAlpha);
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
                if (apparentSize < 3.2 || (isLowDetail && size < 5.0)) {
                    ctx.rect(x - size, y - size, size * 2, size * 2);
                } else {
                    ctx.moveTo(x + size, y);
                    ctx.arc(x, y, size, 0, Math.PI * 2);
                }
            }
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // 3. パーティクル描画
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.beginPath();
            
            const pSize = 3.5 * p.life;
            if (pSize * scale < 3.2 || isLowDetail) {
                ctx.rect(p.x - pSize, p.y - pSize, pSize * 2, pSize * 2);
            } else {
                ctx.arc(p.x, p.y, pSize, 0, Math.PI * 2);
            }
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
}