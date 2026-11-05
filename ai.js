// ==============================================================================
// 『くねくねバトル オンライン』スネーク.io型 自律生態系AIマネージャー (ai.js)
// v44.0.0 正面自爆激突完全根絶＆動的チキンレース事前ステアリング版:
// ・【頭部接近（Head-to-Head）事前警戒扇形コーンの配備】
// 　胴体グリッドだけでなく「相手の頭部座標（Head）」を検知する前方扇形警戒コーン
// 　（前方75度、距離360px）を配備！対向して近づく相手を事前に察知し、
// 　正面衝突コースを直前で斜め外側へ逃がすチキンレース回避を実現
// ・【状況別可変リアクションディレイ（正面即時回避＆側面奇襲キル維持）】
// 　正面対向接近時（diff < 45度）は遅延を0.02秒（即時）に短縮して正面自爆を根絶！
// 　プレイヤーが側面や斜め後方から首を刈りに来た場合は 0.15秒の遅延を維持し、
// 　プレイヤーのテクニック（奇襲・囲い込み）が正当に成功する完璧なゲームバランスを両立
// ・【回避時の緊急ブースト解除（コンパクト旋回）】
// 　衝突危険域に入った瞬間、強制的にブーストをOFFにして旋回半径を最小化
// ・【300秒ワールドボス（colossus）覚醒＆50,000pt成長維持】
// ・【討伐後120秒再覚醒クールダウンサイクル維持】
// ・【ボス専用の重厚なエリア支配航行ルーチン維持】
// ・【ペルソナ比率の正常化（forager 30%）維持】
// ・【Uターン・ボディシールド防御（Bait & Turn）維持】
// ・【シャドウ並走（Shadowing）＆間合いキープ維持】
// ・【ハイエナ掠め取り（Snatch & Run）維持】
// ・【思考ターゲットマルチ化維持】
// ・【全人間プレイヤー対応動的循環スポーン維持】
// ・【ゲスト視界内AI突然変異（サイズ急膨張）完全防止維持】
// ・【全人間プレイヤー視界外リスポーン（4.0秒）維持】
// ・【思考用空間グリッドのactiveCells管理＆完全ゼロアロケーション化維持】
// ・【空間ハッシュ局所グリッド走査(O(1))維持】
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
    AMBUSH: 6,     // カミカゼ特攻（巨大スネークの首元へ捨て身の突進）
    DEFEND: 7      // Uターン・ボディシールド防御（追撃者を自分の胴体へ誘い込む）
};

// ★ 画面外AIの生態系ピラミッド型仮想成長上限スコア
const MAX_VIRTUAL_SCORE_COLOSSUS = 50000; // 超大型ワールドボス（colossus: スコア50,000pt、太さ65px）
const MAX_VIRTUAL_SCORE_BOSS = 12000;     // 通常ボス級（cruiser等: 体長約78〜85節）
const MAX_VIRTUAL_SCORE_MID = 5000;       // 中堅好戦型（hunter, harasser, ambusher: 体長約52〜56節）
const MAX_VIRTUAL_SCORE_DEFAULT = 2200;   // 一般・主食（forager, timid等: 体長約32〜38節）

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

        // ★ ワールドボス覚醒・サイクル管理
        this._sessionElapsedTime = 0;   // セッション経過時間（秒）
        this._bossCooldownTimer = 0;     // ボス討伐後の再覚醒クールダウンタイマー（120秒）
        this._currentBossSnake = null;   // 現在覚醒中のワールドボスインスタンス

        // ★ 思考走査専用のゼロアロケーション空間グリッドキャッシュ
        this.bodySpatialGrid = new Map();
        this.nodePool = [];
        this.nodePoolIndex = 0;

        // ★ イテレータ生成排除用アクティブセル追跡配列＆セルプール
        this.activeCells = [];
        this.cellPool = [];
    }

    clear() {
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

        this._sessionElapsedTime = 0;
        this._bossCooldownTimer = 0;
        this._currentBossSnake = null;
    }

    init(count, playerX, playerY) {
        this.clear();
        this.ais = [];
        this.aiMeta = [];

        this._sessionElapsedTime = 0;
        this._bossCooldownTimer = 0;
        this._currentBossSnake = null;

        for (let i = 1; i <= count; i++) {
            const color = SNAKE_COLORS[i % SNAKE_COLORS.length];
            const face = this.faces[i % this.faces.length];
            const ai = new Snake(false, i, `CPU ${i}`, color, face);

            // =========================================================================
            // ★ 【ペルソナ比率の正常化（forager復元＆特攻過密の解消）】
            // =========================================================================
            const randVal = Math.random();
            let persona = 'forager';
            if (randVal < 0.30) persona = 'forager';
            else if (randVal < 0.50) persona = 'hunter';
            else if (randVal < 0.68) persona = 'harasser';
            else if (randVal < 0.80) persona = 'ambusher';
            else if (randVal < 0.92) persona = 'cruiser';
            else persona = 'timid';

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
                avoidReactionTimer: 0,
                defendCooldown: 0
            });

            const angle = Math.random() * Math.PI * 2;
            const dist = 2500 + Math.random() * 16000;
            const sx = Math.max(400, Math.min(MAP_SIZE - 400, playerX + Math.cos(angle) * dist));
            const sy = Math.max(400, Math.min(MAP_SIZE - 400, playerY + Math.sin(angle) * dist));
            ai.reset(sx, sy);

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

    _obtainCell() {
        if (this.cellPool.length > 0) {
            return this.cellPool.pop();
        }
        return [];
    }

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

    update(player, allSnakes, frameCount, dtSec = 1 / 60) {
        const total = this.ais.length;
        if (total === 0) return;

        const safeDt = (typeof dtSec === 'number' && dtSec > 0) ? Math.min(dtSec, 0.1) : (1 / 60);
        const timeScale = Math.max(0.1, Math.min(3.0, safeDt * 60));

        // =========================================================================
        // ★ 【ワールドボス生存検知 ＆ 討伐後120秒クールダウンサイクル】
        // =========================================================================
        this._sessionElapsedTime += safeDt;

        if (this._currentBossSnake) {
            if (this._currentBossSnake.isDead) {
                this._currentBossSnake = null;
                this._bossCooldownTimer = 120.0;
            }
        } else if (this._bossCooldownTimer > 0) {
            this._bossCooldownTimer = Math.max(0, this._bossCooldownTimer - safeDt);
        }

        // 開始300秒（5分）以降、かつクールダウン終了時にボスが不在の場合、回遊型から1体覚醒
        if (this._sessionElapsedTime >= 300.0 && !this._currentBossSnake && this._bossCooldownTimer <= 0) {
            let bestCandidate = null;
            let highestScore = -1;

            for (let i = 0; i < total; i++) {
                const ai = this.ais[i];
                const meta = this.aiMeta[i];
                if (!ai || ai.isDead || !meta) continue;

                if (meta.persona === 'cruiser' || meta.persona === 'hunter') {
                    if (ai.score > highestScore) {
                        highestScore = ai.score;
                        bestCandidate = { ai, meta };
                    }
                }
            }

            if (bestCandidate) {
                bestCandidate.meta.persona = 'colossus';
                bestCandidate.meta.state = AI_STATE.CRUISING;
                bestCandidate.meta.stateTimer = 300;
                this._currentBossSnake = bestCandidate.ai;
            }
        }

        // 1. 全生存人間プレイヤーの座標収集
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

        // 2. 仮想成長
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
                if (meta.persona === 'colossus') {
                    scoreCap = MAX_VIRTUAL_SCORE_COLOSSUS;
                } else if (meta.persona === 'cruiser') {
                    scoreCap = MAX_VIRTUAL_SCORE_BOSS;
                } else if (meta.persona === 'hunter' || meta.persona === 'harasser' || meta.persona === 'ambusher') {
                    scoreCap = MAX_VIRTUAL_SCORE_MID;
                }

                if (ai.score < scoreCap) {
                    let gainRate = 6;
                    if (meta.persona === 'colossus') gainRate = 28;
                    else if (meta.persona === 'hunter' || meta.persona === 'cruiser') gainRate = 12;
                    else if (meta.persona === 'forager') gainRate = 8;

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
        this._rebuildSpatialGrid(allSnakes);

        for (let i = 0; i < total; i++) {
            const ai = this.ais[i];
            const meta = this.aiMeta[i];
            if (!meta) continue;

            // 3. 死亡中AIのリスポーン
            if (ai.isDead) {
                meta.deadTimer = (meta.deadTimer || 0) + safeDt;
                if (meta.deadTimer >= 4.0) {
                    meta.deadTimer = 0;

                    if (meta.persona === 'colossus') {
                        meta.persona = 'cruiser';
                    }

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
                    meta.defendCooldown = 60;
                    meta.avoidReactionTimer = 0;
                }
                continue;
            }

            meta.stateTimer -= timeScale;
            if (meta.harassCooldown > 0) meta.harassCooldown = Math.max(0, meta.harassCooldown - timeScale);
            if (meta.panicCooldown > 0) meta.panicCooldown = Math.max(0, meta.panicCooldown - timeScale);
            if (meta.defendCooldown > 0) meta.defendCooldown = Math.max(0, meta.defendCooldown - timeScale);

            // 4. 動的循環スポーン
            if (meta.persona !== 'colossus' && (frameCount + i) % 60 === 0) {
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

            // 5. 思考実行
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
        // 2. 【最重要・対頭部（Head-to-Head）事前警戒 ＆ チキンレース回避】
        // 真正面からお互いに向かい合っている時、350px手前から進路を斜め外側へ反らす！
        // これにより、ただ直進して口の中に飛び込むような正面自爆を100%防止
        // =========================================================================
        let headThreatFound = false;
        const totalSnakesCount = allSnakes.length;

        for (let i = 0; i < totalSnakesCount; i++) {
            const other = allSnakes[i];
            if (!other || other === ai || other.isDead) continue;

            const hdx = other.x - ai.x;
            const hdy = other.y - ai.y;
            const hDistSq = hdx * hdx + hdy * hdy;

            // 警戒距離（360px以内）
            const headAlertLimit = 360 + ai.size + other.size;
            if (hDistSq < headAlertLimit * headAlertLimit) {
                // 相手が自機の前方視野（75度以内）にいるか
                const angleToOtherHead = Math.atan2(hdy, hdx);
                let relAngle = angleToOtherHead - ai.angle;
                while (relAngle < -Math.PI) relAngle += Math.PI * 2;
                while (relAngle > Math.PI) relAngle -= Math.PI * 2;

                if (Math.abs(relAngle) < Math.PI * 0.42) {
                    // お互いの進行方向が対向（130度以上）しているか
                    let faceDiff = Math.abs(ai.angle - other.angle);
                    while (faceDiff > Math.PI) faceDiff = Math.PI * 2 - faceDiff;

                    if (faceDiff > Math.PI * 0.72) {
                        // 正面衝突コースを検知：相手と交差するように斜め外側（±55度）へ舵を切る
                        const steerSide = (relAngle >= 0) ? -Math.PI * 0.32 : Math.PI * 0.32;
                        ai.targetAngle = ai.angle + steerSide;
                        ai.isBoosting = false; // 加速をやめてコンパクトに旋回
                        meta.avoidReactionTimer = 0;
                        headThreatFound = true;
                        break;
                    }
                }
            }
        }

        if (headThreatFound) return;

        // =========================================================================
        // 3. 【空間ハッシュ局所走査】胴体激突回避
        // ★ 状況別可変ディレイ：
        // ・正面対向接近時（diff < 45度）: 遅延を0.02秒（即時）に短縮して正面自爆を根絶！
        // ・側面・斜め奇襲時: 0.15秒の遅延を維持し、プレイヤーの首切り・囲い込み成功を保証！
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
                    const safeDistLimit = ai.size * 2.8 + node.radius * 1.3;
                    const safeDistLimitSq = safeDistLimit * safeDistLimit;

                    if (sDistSq < safeDistLimitSq) {
                        const angleToBody = Math.atan2(sdy, sdx);
                        let diff = angleToBody - ai.angle;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;

                        if (Math.abs(diff) < Math.PI / 2.0) {
                            if (meta.avoidReactionTimer === undefined) meta.avoidReactionTimer = 0;
                            meta.avoidReactionTimer += dtSec;

                            // 正面（進行方向±40度以内）の胴体は即座に回避（0.02秒）、側面奇襲は0.15秒の猶予を残す
                            const isHeadOnObstacle = Math.abs(diff) < Math.PI * 0.22;
                            const requiredDelay = isHeadOnObstacle ? 0.02 : 0.15;

                            if (meta.avoidReactionTimer >= requiredDelay || sDistSq < (safeDistLimitSq * 0.40)) {
                                ai.targetAngle = ai.angle + (diff > 0 ? -Math.PI / 1.6 : Math.PI / 1.6);
                                // 緊急回避時はブーストを即解除して旋回半径を小さくする
                                ai.isBoosting = false;
                            }
                            threatFound = true;
                            break;
                        }
                    }
                }
            }
        }

        if (threatFound) return;
        meta.avoidReactionTimer = 0;

        // =========================================================================
        // ★ 【ワールドボス（colossus）専用航行ルーチン】
        // =========================================================================
        if (meta.persona === 'colossus') {
            meta.state = AI_STATE.CRUISING;
            const angleToCenter = Math.atan2(MAP_SIZE / 2 - ai.y, MAP_SIZE / 2 - ai.x);
            let centerDiff = angleToCenter - ai.targetAngle;
            while (centerDiff < -Math.PI) centerDiff += Math.PI * 2;
            while (centerDiff > Math.PI) centerDiff -= Math.PI * 2;

            ai.targetAngle += meta.cruiseDirection * 0.008 + centerDiff * 0.003;
            ai.isBoosting = false;
            return;
        }

        const totalSnakes = allSnakes.length;
        const currentTargetHuman = targetHuman || player;
        const isTargetHumanActive = currentTargetHuman && !currentTargetHuman.isDead;

        // 4. 【Uターン・ボディシールド防御（Bait & Turn）】
        if (isTargetHumanActive && meta.defendCooldown <= 0 && ai.score > 90 && ai.historyLength > 8) {
            const hdx = currentTargetHuman.x - ai.x;
            const hdy = currentTargetHuman.y - ai.y;
            const hDistSq = hdx * hdx + hdy * hdy;

            if (hDistSq < 450 * 450 && hDistSq > 150 * 150 && currentTargetHuman.isBoosting) {
                const angleToHuman = Math.atan2(hdy, hdx);
                let rearDiff = angleToHuman - (ai.angle + Math.PI);
                while (rearDiff < -Math.PI) rearDiff += Math.PI * 2;
                while (rearDiff > Math.PI) rearDiff -= Math.PI * 2;

                if (Math.abs(rearDiff) < Math.PI / 2.2 && Math.random() < 0.45) {
                    meta.state = AI_STATE.DEFEND;
                    meta.stateTimer = 22;
                    meta.defendCooldown = 180;
                    ai.targetAngle = ai.angle + (Math.random() < 0.5 ? Math.PI * 0.75 : -Math.PI * 0.75);
                    ai.isBoosting = ai.score > 110;
                    return;
                }
            }
        }

        // 5. 【カミカゼ暗殺（AMBUSH）：側面カット進化】
        if ((meta.persona === 'ambusher' || (meta.persona === 'harasser' && Math.random() < 0.35)) && ai.score > 60) {
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

                let angleDiff = Math.abs(ai.angle - giantTarget.angle);
                while (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

                const isHeadOn = angleDiff > (Math.PI * 0.75);
                const leadDist = giantTarget.size * 2.8 + 120;

                let aimX, aimY;
                if (isHeadOn) {
                    const flankAngle = giantTarget.angle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
                    aimX = giantTarget.x + Math.cos(giantTarget.angle) * leadDist + Math.cos(flankAngle) * (giantTarget.size * 1.8);
                    aimY = giantTarget.y + Math.sin(giantTarget.angle) * leadDist + Math.sin(flankAngle) * (giantTarget.size * 1.8);
                } else {
                    aimX = giantTarget.x + Math.cos(giantTarget.angle) * leadDist;
                    aimY = giantTarget.y + Math.sin(giantTarget.angle) * leadDist;
                }

                ai.targetAngle = Math.atan2(aimY - ai.y, aimX - ai.x);
                ai.isBoosting = ai.score > 75 && minGiantDistSq < (900 * 900);
                return;
            }
        }

        // 6. 【ビビり逃走（PANIC）】
        if (meta.persona === 'timid' && meta.panicCooldown <= 0 && meta.state !== AI_STATE.PANIC && ai.score > 60) {
            let giantThreat = null;
            const panicDistSq = 400 * 400;

            for (let i = 0; i < totalSnakes; i++) {
                const other = allSnakes[i];
                if (other === ai || other.isDead) continue;
                if (other.score >= ai.score * 2.2) {
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
                meta.stateTimer = 18;
                meta.panicCooldown = 220;
                const awayAngle = Math.atan2(ai.y - giantThreat.y, ai.x - giantThreat.x);
                ai.targetAngle = awayAngle + (Math.random() - 0.5) * 0.4;
                ai.isBoosting = ai.score > 75;
                return;
            }
        }

        // 7. 【ハイエナ（SCAVENGER）：掠め取り（Snatch & Run）】
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
                ai.targetAngle = toDropAngle + (Math.random() - 0.5) * 0.15;

                const isNearDrop = minDropDistSq < (350 * 350);
                ai.isBoosting = (ai.score > 85 && isNearDrop) || (ai.score > 100 && Math.random() < 0.30);
                return;
            }
        }

        // 8. 【ちょっかいトリガー（HARASS / SHADOWING）】
        if (isTargetHumanActive && meta.harassCooldown <= 0 && meta.state !== AI_STATE.HARASS && meta.state !== AI_STATE.PANIC && meta.state !== AI_STATE.AMBUSH && meta.state !== AI_STATE.DEFEND) {
            const pdx = currentTargetHuman.x - ai.x;
            const pdy = currentTargetHuman.y - ai.y;
            const pDistSq = pdx * pdx + pdy * pdy;

            const harassRangeSq = 1200 * 1200;

            if (pDistSq < harassRangeSq) {
                const triggerRate = meta.persona === 'harasser' ? 0.35 : (meta.persona === 'hunter' ? 0.20 : 0.08);
                if (Math.random() < triggerRate) {
                    meta.state = AI_STATE.HARASS;
                    meta.stateTimer = 35 + Math.floor(Math.random() * 30);
                    meta.harassSubtype = Math.floor(Math.random() * 3);
                    meta.harassCooldown = 110 + Math.floor(Math.random() * 80);
                }
            }
        }

        // 9. 【ステートタイマー満了時の自然遷移】
        if (meta.stateTimer <= 0) {
            if (meta.state === AI_STATE.HARASS || meta.state === AI_STATE.PANIC || meta.state === AI_STATE.AMBUSH || meta.state === AI_STATE.DEFEND) {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 70 + Math.floor(Math.random() * 60);
                ai.isBoosting = false;
            } else if (meta.persona === 'cruiser' && ai.size > 20) {
                meta.state = AI_STATE.CRUISING;
                meta.stateTimer = 90 + Math.floor(Math.random() * 120);
            } else if (meta.persona === 'hunter') {
                meta.state = (Math.random() < 0.55) ? AI_STATE.HUNTER : AI_STATE.FORAGING;
                meta.stateTimer = 50 + Math.floor(Math.random() * 50);
            } else {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 60 + Math.floor(Math.random() * 70);
            }
        }

        // 10. 【各ステートの行動実行】
        switch (meta.state) {
            case AI_STATE.AMBUSH:
            case AI_STATE.PANIC:
            case AI_STATE.DEFEND:
                break;

            case AI_STATE.HARASS: {
                if (!isTargetHumanActive) {
                    meta.state = AI_STATE.FORAGING;
                    ai.isBoosting = false;
                    break;
                }

                if (meta.harassSubtype === 0) {
                    const leadDist = 260 + currentTargetHuman.size * 2.0;
                    const predictX = currentTargetHuman.x + Math.cos(currentTargetHuman.angle) * leadDist;
                    const predictY = currentTargetHuman.y + Math.sin(currentTargetHuman.angle) * leadDist;
                    ai.targetAngle = Math.atan2(predictY - ai.y, predictX - ai.x);
                    ai.isBoosting = ai.score > 85 && Math.random() < 0.45;
                } else if (meta.harassSubtype === 1) {
                    const lateralSide = (ai.id % 2 === 0) ? 1 : -1;
                    const flankAngle = currentTargetHuman.angle + lateralSide * (Math.PI / 2.1);
                    const flankDist = currentTargetHuman.size * 3.0 + ai.size * 2.0 + 40;
                    const flankX = currentTargetHuman.x + Math.cos(flankAngle) * flankDist;
                    const flankY = currentTargetHuman.y + Math.sin(flankAngle) * flankDist;
                    ai.targetAngle = Math.atan2(flankY - ai.y, flankX - ai.x) * 0.35 + currentTargetHuman.angle * 0.65;
                    ai.isBoosting = ai.score > 90 && currentTargetHuman.isBoosting;
                } else {
                    const frontX = currentTargetHuman.x + Math.cos(currentTargetHuman.angle) * 200;
                    const frontY = currentTargetHuman.y + Math.sin(currentTargetHuman.angle) * 200;
                    const toFront = Math.atan2(frontY - ai.y, frontX - ai.x);
                    ai.targetAngle = toFront + Math.sin(meta.stateTimer * 0.2) * 0.4;
                    ai.isBoosting = ai.score > 80 && Math.random() < 0.40;
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
                        const leadDist = 140 + huntTarget.size * 1.5;
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
                if (Math.random() < 0.10) {
                    ai.targetAngle += (Math.random() - 0.5) * 0.5;
                }
                ai.isBoosting = false;
                break;
            }
        }
    }
}