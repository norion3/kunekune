// ==============================================================================
// 『くねくねバトル オンライン』ワールド・動的チャンク餌・決定論的シード生成 (world.js)
// v40.0.0 肉片ドロップFIFO上限キャップ＆O(N^2)処理落ち完全防護版:
// ・【肉片ドロップFIFO上限キャップによるO(N^2)処理落ち完全防護】
// 　画面外でのAI乱戦・大量撃破時に dropFoods 配列が無制限に肥大化し、
// 　全スネークの毎フレーム距離判定が O(N^2) 爆発を起こしてFPSが急降下する問題を
// 　MAX_DROP_FOODS = 400 のハードキャップと古い肉片から削除するFIFOリング管理で根絶！
// ・【餌捕食判定への連続衝突判定(CCD)統合維持】高速ブースト時のフード・トンネリング完全防止
// ・【無限餌増殖(ボーダーダンス)の完全根絶維持】FIFOリングバッファ管理(最大4,096件)
// ・【整数ビット演算ハッシュによる文字列アロケーション完全根絶維持】
// 　foodGrid, generatedChunks, consumedFoodBits を 32bit整数キーで一貫運用
// ・【撃破時肉片ドロップの外壁内安全クランプ維持】
// ・【画面外遠隔チャンクの即時回収維持】保持上限500チャンク
// ・【肉片ドロップ寿命の適正化維持】12秒TTL
// ・【通常チャンク・ホットスポット餌密度のスマート化維持】
// ・【大餌・肉片オーラの超遠景ハイライト維持】
// ・【絶対座標消去API完全維持】removeFoodAt(x, y) 連動
// ・【ゼロアロケーション描画バケット維持】
// ==============================================================================

import { MAP_SIZE, GRID_SIZE, FOOD_COLORS } from './constants.js';
import { NetworkManager } from './network.js';

// 消費ビットマスクの最大キャッシュ保持チャンク数（メモリリーク防止 ＆ 長期エコシステム維持）
const MAX_CONSUMED_CACHE_SIZE = 4096;

// CCD変位上限二乗値（ワープ時や長距離移動時の誤爆防止リミッター）
const MAX_CCD_DISPLACEMENT_SQ = 160000;

// ★ 肉片ドロップ最大保持上限（乱戦・大量撃破時の計算量爆発・FPS崩壊を物理防護）
const MAX_DROP_FOODS = 400;

export class WorldManager {
    constructor() {
        this.foodGrid = new Map();
        this.generatedChunks = new Set();
        this.dropFoods = [];
        this.particles = [];

        // ★ チャンクアンロード後も捕食履歴を保持し続ける軽量ビットマスクキャッシュ（FIFOリング制限付き）
        // キー: チャンクキー ((gx + 10) << 16) | (gy + 10), 値: 32bitビットマスク (Bit i = 餌インデックス i が消費済みか)
        this.consumedFoodBits = new Map();

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
        this.consumedFoodBits.clear();
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

    /**
     * 消費ビットマスクの安全な記録ヘルパー（FIFOリングバッファ管理）
     * @param {number} chunkIntKey 
     * @param {number} foodIdx 
     */
    _recordConsumedBit(chunkIntKey, foodIdx) {
        const curMask = this.consumedFoodBits.get(chunkIntKey) || 0;
        this.consumedFoodBits.set(chunkIntKey, curMask | (1 << foodIdx));

        // メモリ上限管理：最大件数を超えた場合、最も古い探索履歴から順に安全削除（FIFO）
        if (this.consumedFoodBits.size > MAX_CONSUMED_CACHE_SIZE) {
            const oldestKey = this.consumedFoodBits.keys().next().value;
            if (oldestKey !== undefined) {
                this.consumedFoodBits.delete(oldestKey);
            }
        }
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
                const intKey = ((gx + 10) << 16) | (gy + 10);
                if (!this.generatedChunks.has(intKey)) {
                    this.generatedChunks.add(intKey);
                    this.spawnChunkFoods(gx, gy, intKey);
                }
            }
        }

        // =========================================================================
        // ★ 【画面外遠隔チャンクの即時回収】
        // 保持上限を 2,500 ➔ 500 に縮小し、画面外の不要な餌を即時破棄してスッキリ化
        // =========================================================================
        if (this.generatedChunks.size > 500) {
            const deleteKeys = [];
            const maxDistSq = (clampedRadius * 1.35) ** 2;

            for (let intKey of this.generatedChunks) {
                const gx = (intKey >> 16) - 10;
                const gy = (intKey & 0xFFFF) - 10;
                const cx = gx * GRID_SIZE;
                const cy = gy * GRID_SIZE;
                const distSq = (cx - playerX) ** 2 + (cy - playerY) ** 2;
                if (distSq > maxDistSq) {
                    deleteKeys.push(intKey);
                }
            }

            for (let k of deleteKeys) {
                this.generatedChunks.delete(k);
                this.foodGrid.delete(k);
                // チャンク破棄時に consumedFoodBits を即時削除しない！
                // これにより、境界反復移動（ボーダーダンス）による餌無限復活を物理根絶
            }
        }
    }

    /**
     * ホットスポット群生地 ＆ 3段階美麗餌生成（消費済みビットマスク判定対応版）
     */
    spawnChunkFoods(gx, gy, intKey = null) {
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
        const hotspotThreshold = 0.05 + centerProximity * 0.05;
        const isHotspot = prng() < hotspotThreshold;

        // 生成数適正化：通常1〜3個、ホットスポット最大8個
        const baseCount = Math.floor(prng() * 3) + 1;
        const count = isHotspot ? Math.min(8, baseCount * 2 + Math.floor(centerProximity * 2)) : baseCount;

        // チャンク整数キー（32bit）
        const chunkIntKey = intKey !== null ? intKey : (((gx + 10) << 16) | (gy + 10));
        const consumedMask = this.consumedFoodBits.get(chunkIntKey) || 0;

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

            // =========================================================================
            // ★ 【消費済みビット判定（ゾンビ復活防止）】
            // 過去に捕食されたインデックスの餌は、PRNGの乱数順序を狂わせずにスポーンのみ安全にスキップ
            // =========================================================================
            if ((consumedMask & (1 << i)) !== 0) {
                if (sizeCategory === 2) {
                    prng(); prng(); // 大餌の乱数消費を同期
                } else if (sizeCategory === 1) {
                    prng(); prng(); prng(); // 中餌の乱数消費を同期
                } else {
                    prng(); prng(); prng(); // 小餌の乱数消費を同期
                }
                continue;
            }

            if (sizeCategory === 2) {
                // 大サイズ餌（val 22〜42、白色コア＋淡黄色オーラ）
                list.push({
                    x: x,
                    y: y,
                    val: Math.floor(22 + prng() * 20 + centerProximity * 10),
                    size: 9.5 + prng() * 3.5,
                    isBig: true,
                    isLargeAura: true,
                    color: '#ffffff',
                    chunkIntKey: chunkIntKey,
                    foodIdx: i
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
                    color: FOOD_COLORS[Math.floor(prng() * FOOD_COLORS.length)],
                    chunkIntKey: chunkIntKey,
                    foodIdx: i
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
                    color: FOOD_COLORS[Math.floor(prng() * FOOD_COLORS.length)],
                    chunkIntKey: chunkIntKey,
                    foodIdx: i
                });
            }
        }

        this.foodGrid.set(chunkIntKey, list);
    }

    // 撃破されたスネークの肉片ドロップ（TTLタイムスタンプ付き ＆ 外壁内安全クランプ ＆ ハードキャップ管理）
    spawnDeathDrop(snake) {
        const histLen = snake.historyLength || 0;
        const now = performance.now();
        const margin = 20;

        for (let i = 0; i < histLen; i += 2) {
            const idx = (snake.headIdx + i) % 2048;
            const pt = snake.history[idx];
            if (!pt) continue;

            // =========================================================================
            // ★ 【外壁内安全クランプ】
            // 外壁際で撃破された際、肉片がマップ外に飛び出して回収不能になるのを完全防止
            // =========================================================================
            const dropX = Math.max(margin, Math.min(MAP_SIZE - margin, pt.x + (Math.random() - 0.5) * 20));
            const dropY = Math.max(margin, Math.min(MAP_SIZE - margin, pt.y + (Math.random() - 0.5) * 20));

            this.dropFoods.push({
                x: dropX,
                y: dropY,
                size: 7 + Math.random() * 4,
                val: 18 + Math.random() * 12,
                isBig: true,
                isLargeAura: true,
                color: snake.color,
                spawnTime: now
            });
        }

        // =========================================================================
        // ★ 【肉片ドロップFIFOハードキャップ防護】
        // 画面外大乱戦時でも MAX_DROP_FOODS を超過した分を最も古い肉片から安全に切り捨て
        // =========================================================================
        if (this.dropFoods.length > MAX_DROP_FOODS) {
            const overflow = this.dropFoods.length - MAX_DROP_FOODS;
            this.dropFoods.splice(0, overflow);
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

    /**
     * 餌の捕食判定（連続衝突判定CCD統合：高速ブースト移動時のすり抜けを完全防止）
     */
    checkFoodConsumption(snake, onEat) {
        const hx = snake.x;
        const hy = snake.y;
        const headR = snake.size;

        // 前フレーム座標（未記録時は現位置として通常の点判定に安全フォールバック）
        const prevHx = snake.prevX !== undefined ? snake.prevX : hx;
        const prevHy = snake.prevY !== undefined ? snake.prevY : hy;

        const segDx = hx - prevHx;
        const segDy = hy - prevHy;
        const segLenSq = segDx * segDx + segDy * segDy;

        const isRespawning = (snake.historyLength || 0) < 2;
        const canUseCCD = !isRespawning && segLenSq > 0.0001 && segLenSq <= MAX_CCD_DISPLACEMENT_SQ;

        const gx = Math.floor(hx / GRID_SIZE);
        const gy = Math.floor(hy / GRID_SIZE);

        let skipSmallProb = 0;
        if (headR > 22) {
            skipSmallProb = Math.min(0.85, (headR - 22) / 60 * 0.85);
        }

        // 1. チャンク餌
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const intKey = ((gx + ox + 10) << 16) | (gy + oy + 10);
                const list = this.foodGrid.get(intKey);
                if (!list) continue;

                for (let i = list.length - 1; i >= 0; i--) {
                    const f = list[i];

                    if (!f.isBig && skipSmallProb > 0 && Math.random() < skipSmallProb) {
                        continue;
                    }

                    const minDist = headR + f.size;
                    const minDistSq = minDist * minDist;

                    // =========================================================================
                    // ★ 【線分 vs 餌(円)の幾何学的最短距離判定（CCD捕食）】
                    // =========================================================================
                    let hitDistSq = 0;
                    if (canUseCCD) {
                        const t = Math.max(0, Math.min(1, ((f.x - prevHx) * segDx + (f.y - prevHy) * segDy) / segLenSq));
                        const cdx = prevHx + t * segDx - f.x;
                        const cdy = prevHy + t * segDy - f.y;
                        hitDistSq = cdx * cdx + cdy * cdy;
                    } else {
                        const dx = hx - f.x;
                        const dy = hy - f.y;
                        hitDistSq = dx * dx + dy * dy;
                    }

                    if (hitDistSq < minDistSq) {
                        snake.addScore(f.val);

                        // ★ チャンク内での捕食インデックスを永続ビットマスク（FIFO管理）へ刻印
                        if (f.chunkIntKey !== undefined && f.foodIdx !== undefined) {
                            this._recordConsumedBit(f.chunkIntKey, f.foodIdx);
                        }

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
            const minDist = headR + f.size;
            const minDistSq = minDist * minDist;

            let hitDistSq = 0;
            if (canUseCCD) {
                const t = Math.max(0, Math.min(1, ((f.x - prevHx) * segDx + (f.y - prevHy) * segDy) / segLenSq));
                const cdx = prevHx + t * segDx - f.x;
                const cdy = prevHy + t * segDy - f.y;
                hitDistSq = cdx * cdx + cdy * cdy;
            } else {
                const dx = hx - f.x;
                const dy = hy - f.y;
                hitDistSq = dx * dx + dy * dy;
            }

            if (hitDistSq < minDistSq) {
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
                const intKey = ((gx + ox + 10) << 16) | (gy + oy + 10);
                const list = this.foodGrid.get(intKey);
                if (!list) continue;

                for (let i = list.length - 1; i >= 0; i--) {
                    const f = list[i];
                    const dx = f.x - x;
                    const dy = f.y - y;
                    if (dx * dx + dy * dy < searchDistSq) {
                        // ★ 他走者の捕食時もインデックスを永続ビットマスク（FIFO管理）へ刻印
                        if (f.chunkIntKey !== undefined && f.foodIdx !== undefined) {
                            this._recordConsumedBit(f.chunkIntKey, f.foodIdx);
                        }

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

        // =========================================================================
        // ★ 【肉片ドロップ寿命の適正化】35秒 ➔ 12秒へ短縮し、餌の山を速やかに解消
        // =========================================================================
        const now = performance.now();
        for (let i = this.dropFoods.length - 1; i >= 0; i--) {
            const f = this.dropFoods[i];
            if (!f.spawnTime) f.spawnTime = now;
            if (now - f.spawnTime > 12000) {
                this.dropFoods[i] = this.dropFoods[this.dropFoods.length - 1];
                this.dropFoods.pop();
            }
        }
    }

    /**
     * ★ 美麗真円パルスオーラ描画 ＆ 高精度・階層的スマートLoD
     */
    draw(ctx, cameraX, cameraY, viewW, viewH, frameCount) {
        const minGx = Math.floor(cameraX / GRID_SIZE) - 1;
        const maxGx = Math.floor((cameraX + viewW) / GRID_SIZE) + 1;
        const minGy = Math.floor(cameraY / GRID_SIZE) - 1;
        const maxGy = Math.floor((cameraY + viewH) / GRID_SIZE) + 1;

        // カメラスケールを逆算
        const scale = ctx.canvas.width / viewW;

        // =========================================================================
        // 【強化版・階層的スマートLoDフィルター（60,000px索敵特化）】
        // ・scale >= 0.65: 100% 全て表示（近景・通常時）
        // ・0.50 <= scale < 0.65: 約50%間引き（標準ズームアウト時の画面白飛びを防止）
        // ・0.35 <= scale < 0.50: 約75%間引き（中遠景：小餌の1/4のみ表示）
        // ・scale < 0.35: 小餌を完全非表示（超広域索敵：大餌・肉片のみが浮かぶ漆黒の宇宙）
        // =========================================================================
        const isMidZoom = scale < 0.65 && scale >= 0.50;
        const isFarZoom = scale < 0.50 && scale >= 0.35;
        const isUltraZoom = scale < 0.35;

        for (const bucket of this.batchBuckets.values()) {
            bucket.length = 0;
        }
        this.bigAuraBuffer.length = 0;

        for (let gx = minGx; gx <= maxGx; gx++) {
            for (let gy = minGy; gy <= maxGy; gy++) {
                const intKey = ((gx + 10) << 16) | (gy + 10);
                const list = this.foodGrid.get(intKey);
                if (!list) continue;

                for (let i = 0; i < list.length; i++) {
                    const f = list[i];

                    if (f.isBig) {
                        // ★ 大餌・中餌：遠景でも必ず美しい真円パルスオーラを放つ
                        const pulse = 1.0 + Math.sin(frameCount * 0.12 + f.x) * 0.24;
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
                        // ★ 小餌：スケールに応じた決定論的ハッシュでチラつきなく段階的間引き
                        const hash = (gx * 31 + gy * 17 + i) >>> 0;
                        if (isFarZoom) {
                            // 75% 間引き（4個に1個だけ表示）
                            if ((hash % 4) !== 0) continue;
                        } else if (isMidZoom) {
                            // 50% 間引き（2個に1個だけ表示）
                            if ((hash % 2) !== 0) continue;
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
        // 1. 淡い黄色の神秘的発光オーラ一括描画（常に100%真円 arc で描画）
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
        // 2. 餌コア本体のバッチ描画（真円 arc 描画でブロックノイズを根絶）
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