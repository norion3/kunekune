// ==============================================================================
// 『くねくねバトル オンライン』スネーク.io型 自律生態系AIマネージャー (ai.js)
// v41.0.0 思考ターゲットマルチ化＆胴体回避リアクション遅延配備版:
// ・【AI思考ターゲットのマルチ化（ゲスト無視の完全解消）】
// 　ちょっかい行動（HARASS）およびプレイヤー接近トリガーの対象をホスト固定から
// 　「AIに最も近い生存人間プレイヤー」へ動的切り替え！
// 　ゲストプレイヤーに対しても進路妨害や並走威嚇を仕掛け、マルチプレイの対人対AI駆け引きを完全成立
// ・【胴体回避の人間化（0ms神回避の適正化）】
// 　危険距離侵入時の即時直角反転ルーチンに 0.15秒のリアクション遅延（avoidReactionTimer）を配備！
// 　プレイヤーがブースト加速で側面・前方から奇襲した際、首切り・囲い込みが正当に成功する
// 　ゲームバランスへ適正化（至近距離での緊急回避は維持）
// ・【全人間プレイヤー対応動的循環スポーン維持】
// ・【ゲスト視界内AI突然変異（サイズ急膨張）完全防止維持】
// ・【全人間プレイヤー視界外リスポーン（4.0秒）維持】
// ・【画面外AIの生態系ピラミッド型仮想成長キャップ維持】
// ・【思考用空間グリッドのactiveCells管理＆完全ゼロアロケーション化維持】
// ・【思考用空間グリッドの毎フレーム確実クリアによるメモリリーク根絶維持】
// ・【AI思考走査グリッドの動的探索半径化維持】
// ・【空間ハッシュマイナス座標ビット崩壊完全防護維持】
// ・【整数ビット演算ハッシュによる文字列アロケーション完全根絶維持】
// ・【空間ハッシュ局所グリッド走査(O(1))維持】
// ・【AI行動タイマー実時間同期維持】
// ・【全行動ステート完全保持】カミカゼ暗殺(AMBUSH)、包囲コイリング(HUNTER)、
// 　ちょっかい(HARASS)、ハイエナ(SCAVENGER)、ビビり(PANIC)、大回遊(CRUISING)
// ==============================================================================

import { MAP_SIZE, SNAKE_COLORS, GRID_SIZE } from './constants.js';
import { Snake } from './snake.js';

// AIの生態系ステート
const AI_STATE = {
    FORAGING: 0,   // マイペース採餌（平和に餌を食べる）
    CRUISING: 1,   // 大回遊パトロール（広大な空間を悠然と横断・巨大な壁）
    SCAVENGER: 2,  // ハイエナ肉片争奪（撃破残骸や大量餌へ一斉殺到）
    HUNTER: 3,     // 狡猾な狩猟（好戦的な個体によるキル狙い・包囲コイリング）
    HARASS: 4,     // ちょっかい行動（進路横切り・並走威嚇・餌横取り）
    PANIC: 5,      // ビビり逃走（特定臆病個体のみ限定発動）
    AMBUSH: 6      // カミカゼ特攻（巨大スネークの首元へ捨て身の突進）
};

// ★ 画面外AIの生態系ピラミッド型仮想成長上限スコア
const MAX_VIRTUAL_SCORE_BOSS = 12000;    // ボス級（cruiser等: 体長約78〜85節）
const MAX_VIRTUAL_SCORE_MID = 5000;      // 中堅好戦型（hunter, harasser, ambusher: 体長約52〜56節）
const MAX_VIRTUAL_SCORE_DEFAULT = 2200;  // 一般・主食（forager, timid等: 体長約32〜38節）

// セル再利用プール上限
const MAX_AI_CELL_POOL = 2048;

export class AIManager {
    constructor() {
        this.ais = [];
        this.sliceIndex = 0;
        this.faces = ['normal', 'angry', 'happy', 'cool', 'cute'];
        
        // 各AIの個別性格・行動メタデータ
        this.aiMeta = [];

        // 仮想成長用アキュムレーター
        this._virtualGrowthTimer = 0;

        // ★ 思考走査専用のゼロアロケーション空間グリッドキャッシュ
        this.bodySpatialGrid = new Map();
        this.nodePool = [];
        this.nodePoolIndex = 0;

        // ★ イテレータ生成排除用アクティブセル追跡配列＆セルプール
        this.activeCells = [];
        this.cellPool = [];
    }

    clear() {
        // セルの回収とプール返却
        const activeCount = this.activeCells.length;
        for (let i = 0; i < activeCount; i++) {
            const cell = this.activeCells[i];
            cell.length = 0;
            if (this.cellPool.length < MAX_AI_CELL_POOL) {
                this.cellPool.push(cell);
            }
        }
        this.activeCells.length = 0;
        this.bodySpatialGrid.clear();

        // ノードの参照解放
        const limit = Math.min(this.nodePoolIndex, this.nodePool.length);
        for (let i = 0; i < limit; i++) {
            this.nodePool[i].snake = null;
        }
        this.nodePoolIndex = 0;
    }

    init(count, playerX, playerY) {
        this.clear();
        this.ais = [];
        this.aiMeta = [];

        for (let i = 1; i <= count; i++) {
            const color = SNAKE_COLORS[i % SNAKE_COLORS.length];
            const face = this.faces[i % this.faces.length];
            const ai = new Snake(false, i, `CPU ${i}`, color, face);

            const randVal = Math.random();
            let persona = 'forager'; // デフォルト採餌型 (35%)
            if (randVal < 0.20) persona = 'hunter';          // 20%: 好戦的ハンター
            else if (randVal < 0.40) persona = 'ambusher';  // 20%: 首元を狙う命知らずの暗殺型
            else if (randVal < 0.60) persona = 'harasser';  // 20%: 生意気なちょっかい型
            else if (randVal < 0.75) persona = 'cruiser';   // 15%: 悠然と回遊する大型予備軍
            else persona = 'timid';                         // 5%: 本当にビビりの臆病個体

            this.aiMeta.push({
                state: AI_STATE.FORAGING,
                persona: persona,
                targetFoodPos: null,
                stateTimer: 40 + Math.floor(Math.random() * 60),
                scavengeTarget: null,
                cruiseDirection: Math.random() < 0.5 ? 1 : -1,
                harassSubtype: 0,
                harassCooldown: Math.floor(Math.random() * 60),
                panicCooldown: 0,
                deadTimer: 0,
                ambushTarget: null,
                avoidReactionTimer: 0 // ★ 回避リアクション遅延タイマー
            });

            // 初期配置の広域分散化
            const angle = Math.random() * Math.PI * 2;
            const dist = 2500 + Math.random() * 16000;
            const sx = Math.max(400, Math.min(MAP_SIZE - 400, playerX + Math.cos(angle) * dist));
            const sy = Math.max(400, Math.min(MAP_SIZE - 400, playerY + Math.sin(angle) * dist));
            ai.reset(sx, sy);

            // 開幕の健全な生態系ピラミッド配分
            const scoreRand = Math.random();
            if (scoreRand < 0.03) {
                ai.addScore(Math.floor(800 + Math.random() * 400));
                this.aiMeta[i - 1].persona = Math.random() < 0.5 ? 'cruiser' : 'hunter';
            } else if (scoreRand < 0.15) {
                ai.addScore(Math.floor(200 + Math.random() * 300));
            } else {
                ai.addScore(Math.floor(Math.random() * 100));
            }

            this.ais.push(ai);
        }
    }

    /**
     * セル配列取得ヘルパー（ゼロアロケーション）
     */
    _obtainCell() {
        if (this.cellPool.length > 0) {
            return this.cellPool.pop();
        }
        return [];
    }

    /**
     * 思考走査専用グリッドのノード確保ヘルパー（ゼロアロケーション）
     */
    _obtainGridNode(snake, x, y, radius) {
        let node;
        if (this.nodePoolIndex < this.nodePool.length) {
            node = this.nodePool[this.nodePoolIndex];
            node.snake = snake;
            node.x = x;
            node.y = y;
            node.radius = radius;
        } else {
            node = { snake, x, y, radius };
            this.nodePool.push(node);
        }
        this.nodePoolIndex++;
        return node;
    }

    /**
     * 思考走査専用グリッドの構築
     */
    _rebuildSpatialGrid(allSnakes) {
        const activeCount = this.activeCells.length;
        for (let i = 0; i < activeCount; i++) {
            const cell = this.activeCells[i];
            cell.length = 0;
            if (this.cellPool.length < MAX_AI_CELL_POOL) {
                this.cellPool.push(cell);
            }
        }
        this.activeCells.length = 0;

        this.bodySpatialGrid.clear();

        const limit = Math.min(this.nodePoolIndex, this.nodePool.length);
        for (let i = 0; i < limit; i++) {
            this.nodePool[i].snake = null;
        }
        this.nodePoolIndex = 0;

        const total = allSnakes.length;
        for (let i = 0; i < total; i++) {
            const s = allSnakes[i];
            if (s.isDead) continue;

            const histLen = s.historyLength || 0;
            for (let j = 3; j < histLen; j += 4) {
                const idx = (s.headIdx + j) % 2048;
                const pt = s.history[idx];
                if (!pt) continue;

                const progress = j / histLen;
                const radius = s.size * (1 - Math.pow(progress, 2.5) * 0.5);

                const gx = Math.floor(pt.x / GRID_SIZE);
                const gy = Math.floor(pt.y / GRID_SIZE);
                const key = ((gx + 10) << 16) | (gy + 10);

                let cell = this.bodySpatialGrid.get(key);
                if (!cell) {
                    cell = this._obtainCell();
                    this.bodySpatialGrid.set(key, cell);
                    this.activeCells.push(cell);
                }
                cell.push(this._obtainGridNode(s, pt.x, pt.y, radius));
            }
        }
    }

    /**
     * AIシミュレーション更新（全人間プレイヤー対応動的循環バランサー＆思考ターゲットマルチ化）
     * @param {Object} player 自機プレイヤー
     * @param {Array} allSnakes 全スネーク配列
     * @param {number} frameCount フレーム数
     * @param {number} [dtSec=0.016] 実経過秒数
     */
    update(player, allSnakes, frameCount, dtSec = 1 / 60) {
        const total = this.ais.length;
        if (total === 0) return;

        const safeDt = (typeof dtSec === 'number' && dtSec > 0) ? Math.min(dtSec, 0.1) : (1 / 60);
        const timeScale = Math.max(0.1, Math.min(3.0, safeDt * 60));

        // =========================================================================
        // 1. 【全生存人間プレイヤー（ホスト＋遠隔ゲスト走者）の座標・角度・インスタンス収集】
        // =========================================================================
        const humanTargets = [];
        if (player && !player.isDead) {
            humanTargets.push({ x: player.x, y: player.y, angle: player.angle, snake: player });
        }
        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s && !s.isDead && s.isHumanPlayer && !s.isPlayer) {
                humanTargets.push({ x: s.x, y: s.y, angle: s.angle, snake: s });
            }
        }
        if (humanTargets.length === 0) {
            humanTargets.push({ x: MAP_SIZE / 2, y: MAP_SIZE / 2, angle: 0, snake: player });
        }

        // =========================================================================
        // 2. 【画面外AIの仮想バックグラウンド成長】（ゲスト視界内突然変異防止対応）
        // =========================================================================
        this._virtualGrowthTimer += safeDt;
        if (this._virtualGrowthTimer >= 0.5) {
            const growthInterval = this._virtualGrowthTimer;
            this._virtualGrowthTimer = 0;
            const nearHumanThresholdSq = 4500 * 4500;

            for (let i = 0; i < total; i++) {
                const ai = this.ais[i];
                if (ai.isDead) continue;

                let nearAnyHuman = false;
                for (let h = 0; h < humanTargets.length; h++) {
                    const ht = humanTargets[h];
                    const distSq = (ai.x - ht.x) ** 2 + (ai.y - ht.y) ** 2;
                    if (distSq < nearHumanThresholdSq) {
                        nearAnyHuman = true;
                        break;
                    }
                }
                if (nearAnyHuman) continue;

                const meta = this.aiMeta[i];
                if (!meta) continue;

                let scoreCap = MAX_VIRTUAL_SCORE_DEFAULT;
                if (meta.persona === 'cruiser') {
                    scoreCap = MAX_VIRTUAL_SCORE_BOSS;
                } else if (meta.persona === 'hunter' || meta.persona === 'harasser' || meta.persona === 'ambusher') {
                    scoreCap = MAX_VIRTUAL_SCORE_MID;
                }

                if (ai.score < scoreCap) {
                    let gainRate = 6;
                    if (meta.persona === 'hunter' || meta.persona === 'cruiser') gainRate = 12;
                    if (meta.persona === 'forager') gainRate = 8;

                    ai.addScore(gainRate * growthInterval);

                    if (Math.random() < 0.005) {
                        const killBonus = Math.floor(120 + Math.random() * 380);
                        ai.addScore(killBonus);
                        ai.kills = (ai.kills || 0) + 1;
                    }
                }
            }
        }

        const batchSize = Math.ceil(total / 4);
        const startIndex = (this.sliceIndex * batchSize) % total;
        this.sliceIndex = (this.sliceIndex + 1) % 4;

        let activeDrops = null;
        if (typeof window !== 'undefined' && window.currentWorldInstance && window.currentWorldInstance.dropFoods) {
            activeDrops = window.currentWorldInstance.dropFoods;
        }

        const recycleDistSq = 16000 * 16000;

        // 思考走査用グリッドの事前マッピング
        this._rebuildSpatialGrid(allSnakes);

        for (let i = 0; i < total; i++) {
            const ai = this.ais[i];
            const meta = this.aiMeta[i];
            if (!meta) continue;

            // =========================================================================
            // 3. 【死亡中AIのリスポーン処理（全人間プレイヤー対応）】
            // =========================================================================
            if (ai.isDead) {
                meta.deadTimer = (meta.deadTimer || 0) + safeDt;
                if (meta.deadTimer >= 4.0) {
                    meta.deadTimer = 0;

                    const baseHuman = humanTargets[Math.floor(Math.random() * humanTargets.length)];
                    const ang = Math.random() * Math.PI * 2;
                    const d = 9000 + Math.random() * 6000;
                    const rx = Math.max(400, Math.min(MAP_SIZE - 400, baseHuman.x + Math.cos(ang) * d));
                    const ry = Math.max(400, Math.min(MAP_SIZE - 400, baseHuman.y + Math.sin(ang) * d));
                    ai.reset(rx, ry);

                    const respawnRand = Math.random();
                    if (respawnRand < 0.02) {
                        ai.addScore(Math.floor(500 + Math.random() * 500));
                    } else if (respawnRand < 0.12) {
                        ai.addScore(Math.floor(150 + Math.random() * 250));
                    }

                    meta.state = AI_STATE.FORAGING;
                    meta.stateTimer = 50;
                    meta.harassCooldown = 90;
                    meta.panicCooldown = 60;
                    meta.avoidReactionTimer = 0;
                }
                continue;
            }

            // タイマー実時間同期
            meta.stateTimer -= timeScale;
            if (meta.harassCooldown > 0) {
                meta.harassCooldown = Math.max(0, meta.harassCooldown - timeScale);
            }
            if (meta.panicCooldown > 0) {
                meta.panicCooldown = Math.max(0, meta.panicCooldown - timeScale);
            }

            // =========================================================================
            // 4. 【動的循環スポーン（過疎プレイヤー優先再配置バランサー）】
            // =========================================================================
            if ((frameCount + i) % 60 === 0) {
                let minDistToAnyHumanSq = Infinity;

                for (let h = 0; h < humanTargets.length; h++) {
                    const ht = humanTargets[h];
                    const distSq = (ai.x - ht.x) ** 2 + (ai.y - ht.y) ** 2;
                    if (distSq < minDistToAnyHumanSq) {
                        minDistToAnyHumanSq = distSq;
                    }
                }

                if (minDistToAnyHumanSq > recycleDistSq) {
                    const targetHuman = humanTargets[Math.floor(Math.random() * humanTargets.length)];
                    const forwardBiasAngle = targetHuman.angle + (Math.random() - 0.5) * Math.PI * 1.3;
                    const spawnDist = 9000 + Math.random() * 5000;

                    const nx = Math.max(400, Math.min(MAP_SIZE - 400, targetHuman.x + Math.cos(forwardBiasAngle) * spawnDist));
                    const ny = Math.max(400, Math.min(MAP_SIZE - 400, targetHuman.y + Math.sin(forwardBiasAngle) * spawnDist));

                    ai.x = nx;
                    ai.y = ny;
                    ai.angle = forwardBiasAngle + Math.PI;
                    ai.targetAngle = ai.angle;
                    ai.distCounter = 0;
                    ai.headIdx = 0;
                    ai.historyLength = 0;

                    meta.state = AI_STATE.FORAGING;
                    meta.stateTimer = 40 + Math.floor(Math.random() * 40);
                    meta.avoidReactionTimer = 0;
                }
            }

            // =========================================================================
            // ★ 【思考対象のマルチ化：AIに最も近い人間走者を特定して think へ渡す】
            // =========================================================================
            const shouldThink = (i >= startIndex && i < startIndex + batchSize);
            if (shouldThink) {
                let closestHumanSnake = player;
                let minHumanDistSq = Infinity;
                for (let h = 0; h < humanTargets.length; h++) {
                    const ht = humanTargets[h];
                    const distSq = (ai.x - ht.x) ** 2 + (ai.y - ht.y) ** 2;
                    if (distSq < minHumanDistSq) {
                        minHumanDistSq = distSq;
                        closestHumanSnake = ht.snake || player;
                    }
                }
                this.think(ai, meta, closestHumanSnake, allSnakes, activeDrops, safeDt);
            }

            ai.updatePhysics(safeDt, null, ai.isBoosting);
        }
    }

    /**
     * AI思考ルーチン（最寄り人間走者対応・胴体回避リアクション遅延・カミカゼ特攻・包囲狩猟）
     * @param {Object} ai 
     * @param {Object} meta 
     * @param {Object} targetHuman AIに最も近い生存人間走者
     * @param {Array} allSnakes 
     * @param {Array} activeDrops 
     * @param {number} [dtSec=0.016] 
     */
    think(ai, meta, targetHuman, allSnakes, activeDrops, dtSec = 1 / 60) {
        // 1. 【最優先】外壁激突回避
        const wallMargin = 400 + ai.size * 2;
        if (ai.x < wallMargin || ai.x > MAP_SIZE - wallMargin || ai.y < wallMargin || ai.y > MAP_SIZE - wallMargin) {
            ai.targetAngle = Math.atan2(MAP_SIZE / 2 - ai.y, MAP_SIZE / 2 - ai.x);
            ai.isBoosting = false;
            meta.avoidReactionTimer = 0;
            return;
        }

        // =========================================================================
        // 2. 【最重要・空間ハッシュ局所グリッド走査(O(1))】胴体激突回避
        // ★ 0.15秒のリアクション遅延を配備し、人間プレイヤーの首切り・囲い込み成功を保証！
        // =========================================================================
        let threatFound = false;
        const gx = Math.floor(ai.x / GRID_SIZE);
        const gy = Math.floor(ai.y / GRID_SIZE);

        const searchRange = Math.max(1, Math.min(3, Math.ceil(ai.size / GRID_SIZE)));

        for (let ox = -searchRange; ox <= searchRange && !threatFound; ox++) {
            for (let oy = -searchRange; oy <= searchRange && !threatFound; oy++) {
                const key = ((gx + ox + 10) << 16) | (gy + oy + 10);
                const cell = this.bodySpatialGrid.get(key);
                if (!cell || cell.length === 0) continue;

                const cellLen = cell.length;
                for (let c = 0; c < cellLen; c++) {
                    const node = cell[c];
                    const other = node.snake;
                    if (!other || other === ai || other.isDead) continue;

                    const sdx = node.x - ai.x;
                    const sdy = node.y - ai.y;
                    const sDistSq = sdx * sdx + sdy * sdy;
                    const safeDistLimit = ai.size * 2.5 + node.radius * 1.2;
                    const safeDistLimitSq = safeDistLimit * safeDistLimit;

                    if (sDistSq < safeDistLimitSq) {
                        const angleToBody = Math.atan2(sdy, sdx);
                        let diff = angleToBody - ai.angle;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;

                        if (Math.abs(diff) < Math.PI / 2.0) {
                            if (meta.avoidReactionTimer === undefined) meta.avoidReactionTimer = 0;
                            meta.avoidReactionTimer += dtSec;

                            // 至近距離（safeDistLimitSq * 0.35）は即時緊急回避、それ以外は0.15秒のリアクション猶予を付与
                            if (meta.avoidReactionTimer >= 0.15 || sDistSq < (safeDistLimitSq * 0.35)) {
                                ai.targetAngle = ai.angle + (diff > 0 ? -Math.PI / 1.6 : Math.PI / 1.6);
                                ai.isBoosting = ai.score > 100 && sDistSq < (safeDistLimitSq * 0.40);
                            }
                            threatFound = true;
                            break;
                        }
                    }
                }
            }
        }

        if (threatFound) return;
        meta.avoidReactionTimer = 0; // 脅威が去ったらリアクションタイマーをリセット

        const totalSnakes = allSnakes.length;

        // 3. 【カミカゼ暗殺特攻（AMBUSH）】
        if ((meta.persona === 'ambusher' || (meta.persona === 'harasser' && Math.random() < 0.4)) && ai.score > 60) {
            let giantTarget = null;
            let minGiantDistSq = 1400 * 1400;

            for (let i = 0; i < totalSnakes; i++) {
                const other = allSnakes[i];
                if (other === ai || other.isDead) continue;
                if (other.invulnerableTimer && other.invulnerableTimer > 0) continue;

                if (other.score >= ai.score * 1.8 || other.size >= 24) {
                    const gdx = other.x - ai.x;
                    const gdy = other.y - ai.y;
                    const distSq = gdx * gdx + gdy * gdy;
                    if (distSq < minGiantDistSq) {
                        minGiantDistSq = distSq;
                        giantTarget = other;
                    }
                }
            }

            if (giantTarget) {
                meta.state = AI_STATE.AMBUSH;
                meta.ambushTarget = giantTarget;

                const leadDist = giantTarget.size * 2.2 + 80;
                const predictX = giantTarget.x + Math.cos(giantTarget.angle) * leadDist;
                const predictY = giantTarget.y + Math.sin(giantTarget.angle) * leadDist;

                ai.targetAngle = Math.atan2(predictY - ai.y, predictX - ai.x);
                ai.isBoosting = ai.score > 70 && minGiantDistSq < (900 * 900);
                return;
            }
        }

        // 4. 【ビビり逃走の限定化】
        if (meta.persona === 'timid' && meta.panicCooldown <= 0 && meta.state !== AI_STATE.PANIC && ai.score > 60) {
            let giantThreat = null;
            const panicDistSq = 350 * 350;

            for (let i = 0; i < totalSnakes; i++) {
                const other = allSnakes[i];
                if (other === ai || other.isDead) continue;
                if (other.score >= ai.score * 2.5) {
                    const gdx = other.x - ai.x;
                    const gdy = other.y - ai.y;
                    if (gdx * gdx + gdy * gdy < panicDistSq) {
                        giantThreat = other;
                        break;
                    }
                }
            }

            if (giantThreat) {
                meta.state = AI_STATE.PANIC;
                meta.stateTimer = 15;
                meta.panicCooldown = 200;
                const awayAngle = Math.atan2(ai.y - giantThreat.y, ai.x - giantThreat.x);
                ai.targetAngle = awayAngle + (Math.random() - 0.5) * 0.4;
                ai.isBoosting = ai.score > 75;
                return;
            }
        }

        // 5. 【ハイエナモード判定】死体肉片の感知
        if (activeDrops && activeDrops.length > 0 && meta.persona !== 'cruiser') {
            let nearestDrop = null;
            let minDropDistSq = Infinity;

            const checkLimit = Math.min(25, activeDrops.length);
            for (let dIdx = 0; dIdx < checkLimit; dIdx++) {
                const drop = activeDrops[dIdx];
                const ddx = drop.x - ai.x;
                const ddy = drop.y - ai.y;
                const dropDistSq = ddx * ddx + ddy * ddy;

                const dynamicSmellRadius = 2400 + Math.min(2000, (drop.val || 20) * 60);
                const smellDistSq = dynamicSmellRadius * dynamicSmellRadius;

                if (dropDistSq < smellDistSq && dropDistSq < minDropDistSq) {
                    minDropDistSq = dropDistSq;
                    nearestDrop = drop;
                }
            }

            if (nearestDrop) {
                meta.state = AI_STATE.SCAVENGER;
                meta.scavengeTarget = nearestDrop;
                const toDropAngle = Math.atan2(nearestDrop.y - ai.y, nearestDrop.x - ai.x);
                ai.targetAngle = toDropAngle;

                const isNearDrop = minDropDistSq < (350 * 350);
                ai.isBoosting = (ai.score > 85 && isNearDrop) || (ai.score > 100 && Math.random() < 0.35);
                return;
            }
        }

        // =========================================================================
        // 6. 【最寄り人間プレイヤー接近時のちょっかい行動トリガー（ゲスト対応）】
        // =========================================================================
        const currentTargetHuman = targetHuman || player;
        const isTargetHumanActive = currentTargetHuman && !currentTargetHuman.isDead;

        if (isTargetHumanActive && meta.harassCooldown <= 0 && meta.state !== AI_STATE.HARASS && meta.state !== AI_STATE.PANIC && meta.state !== AI_STATE.AMBUSH) {
            const pdx = currentTargetHuman.x - ai.x;
            const pdy = currentTargetHuman.y - ai.y;
            const pDistSq = pdx * pdx + pdy * pdy;

            const harassRangeSq = 1200 * 1200;

            if (pDistSq < harassRangeSq) {
                const triggerRate = meta.persona === 'harasser' ? 0.30 : 0.12;
                if (Math.random() < triggerRate) {
                    meta.state = AI_STATE.HARASS;
                    meta.stateTimer = 35 + Math.floor(Math.random() * 30);
                    meta.harassSubtype = Math.floor(Math.random() * 3);
                    meta.harassCooldown = 100 + Math.floor(Math.random() * 80);
                }
            }
        }

        // 7. 【ステートタイマー満了時の自然遷移】
        if (meta.stateTimer <= 0) {
            if (meta.state === AI_STATE.HARASS || meta.state === AI_STATE.PANIC || meta.state === AI_STATE.AMBUSH) {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 70 + Math.floor(Math.random() * 60);
                ai.isBoosting = false;
            } else if (meta.persona === 'cruiser' && ai.size > 20) {
                meta.state = AI_STATE.CRUISING;
                meta.stateTimer = 90 + Math.floor(Math.random() * 120);
            } else if (meta.persona === 'hunter') {
                meta.state = (Math.random() < 0.50) ? AI_STATE.HUNTER : AI_STATE.FORAGING;
                meta.stateTimer = 50 + Math.floor(Math.random() * 50);
            } else {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 60 + Math.floor(Math.random() * 70);
            }
        }

        // =========================================================================
        // 8. 【各ステートの行動実行（最寄り人間プレイヤーに対する追従・迎撃）】
        // =========================================================================
        switch (meta.state) {
            case AI_STATE.AMBUSH:
            case AI_STATE.PANIC:
                break;

            case AI_STATE.HARASS: {
                if (!isTargetHumanActive) {
                    meta.state = AI_STATE.FORAGING;
                    ai.isBoosting = false;
                    break;
                }

                if (meta.harassSubtype === 0) {
                    const leadDist = 280 + currentTargetHuman.size * 1.5;
                    const predictX = currentTargetHuman.x + Math.cos(currentTargetHuman.angle) * leadDist;
                    const predictY = currentTargetHuman.y + Math.sin(currentTargetHuman.angle) * leadDist;
                    ai.targetAngle = Math.atan2(predictY - ai.y, predictX - ai.x);
                    ai.isBoosting = ai.score > 85 && Math.random() < 0.50;
                } else if (meta.harassSubtype === 1) {
                    const lateralAngle = currentTargetHuman.angle + (Math.random() < 0.5 ? Math.PI / 2.2 : -Math.PI / 2.2);
                    const flankX = currentTargetHuman.x + Math.cos(lateralAngle) * (currentTargetHuman.size * 2.5 + ai.size * 2.0);
                    const flankY = currentTargetHuman.y + Math.sin(lateralAngle) * (currentTargetHuman.size * 2.5 + ai.size * 2.0);
                    ai.targetAngle = Math.atan2(flankY - ai.y, flankX - ai.x) * 0.4 + currentTargetHuman.angle * 0.6;
                    ai.isBoosting = ai.score > 90 && currentTargetHuman.isBoosting && Math.random() < 0.45;
                } else {
                    const frontX = currentTargetHuman.x + Math.cos(currentTargetHuman.angle) * 220;
                    const frontY = currentTargetHuman.y + Math.sin(currentTargetHuman.angle) * 220;
                    ai.targetAngle = Math.atan2(frontY - ai.y, frontX - ai.x);
                    ai.isBoosting = ai.score > 80 && Math.random() < 0.60;
                }
                break;
            }

            case AI_STATE.CRUISING: {
                const angleToCenter = Math.atan2(MAP_SIZE / 2 - ai.y, MAP_SIZE / 2 - ai.x);
                let centerDiff = angleToCenter - ai.targetAngle;
                while (centerDiff < -Math.PI) centerDiff += Math.PI * 2;
                while (centerDiff > Math.PI) centerDiff -= Math.PI * 2;

                ai.targetAngle += meta.cruiseDirection * 0.015 + centerDiff * 0.005;
                ai.isBoosting = false;
                break;
            }

            case AI_STATE.HUNTER: {
                let huntTarget = null;
                let minHuntDistSq = 1400 * 1400;

                for (let i = 0; i < totalSnakes; i++) {
                    const other = allSnakes[i];
                    if (other === ai || other.isDead) continue;
                    if (other.invulnerableTimer && other.invulnerableTimer > 0) continue;

                    const hdx = other.x - ai.x;
                    const hdy = other.y - ai.y;
                    const hDistSq = hdx * hdx + hdy * hdy;

                    if (hDistSq < minHuntDistSq) {
                        minHuntDistSq = hDistSq;
                        huntTarget = other;
                    }
                }

                if (huntTarget) {
                    if (ai.size > huntTarget.size * 1.35 && ai.size > 22) {
                        const toTargetAngle = Math.atan2(huntTarget.y - ai.y, huntTarget.x - ai.x);
                        ai.targetAngle = toTargetAngle + Math.PI / 2.3;
                        ai.isBoosting = ai.score > 120 && Math.random() < 0.40;
                    } else {
                        const leadDist = 120 + huntTarget.size;
                        const tx = huntTarget.x + Math.cos(huntTarget.angle) * leadDist;
                        const ty = huntTarget.y + Math.sin(huntTarget.angle) * leadDist;
                        ai.targetAngle = Math.atan2(ty - ai.y, tx - ai.x);
                        ai.isBoosting = ai.score > 100 && Math.random() < 0.45;
                    }
                } else {
                    ai.targetAngle += (Math.random() - 0.5) * 0.3;
                    ai.isBoosting = false;
                }
                break;
            }

            case AI_STATE.FORAGING:
            default: {
                if (Math.random() < 0.12) {
                    ai.targetAngle += (Math.random() - 0.5) * 0.6;
                }
                ai.isBoosting = false;
                break;
            }
        }
    }
}