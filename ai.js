// ==============================================================================
// 『くねくねバトル オンライン』スネーク.io型 自律生態系AIマネージャー (ai.js)
// v26.4.0 生態系アクセント（ビビり逃走＆横取りダッシュ）＆完全DeltaTime版:
// ・【ビビり逃走アクセント】格上巨大スネーク（スコア2倍以上）急接近時、小型AIが驚いて身を翻し0.3秒だけ小ダッシュ逃走
// ・【横取りダッシュアクセント】ハイエナ採餌の最後の350pxで一瞬ブーストを踏み込み、肉片を我先にかっさらう人間味アクション
// ・【思考タイマー完全DeltaTime化】stateTimer および harassCooldown を timeScale（dtSec * 60）減算で完全統一
// ・120Hzディスプレイ環境でのAI異常高速思考・せわしないステート遷移・ちょっかい連続暴走を完全根絶
// ・【死後リスポーン実時間化】実時間（秒）減算で管理し、環境によるリスポーン速度格差を解消
// ・ちょっかい行動（HARASS）の適正頻度（10%前後）と2〜3秒の適正クールダウンを30FPS〜120FPSで寸分違わず再現
// ・索敵反応距離 1,200px ＆ 二乗距離判定によるCPU負荷最小化 ＆ リングバッファ O(1) 維持
// ==============================================================================

import { MAP_SIZE, SNAKE_COLORS } from './constants.js';
import { Snake } from './snake.js';

// AIの生態系ステート
const AI_STATE = {
    FORAGING: 0,   // マイペース採餌（平和に餌を食べる）
    CRUISING: 1,   // 大回遊パトロール（広大な空間を悠然と横断・巨大な壁）
    SCAVENGER: 2,  // ハイエナ肉片争奪（撃破残骸や大量餌へ一斉殺到）
    HUNTER: 3,     // 狡猾な狩猟（好戦的な個体によるキル狙い）
    HARASS: 4,     // ちょっかい行動（進路横切り・並走威嚇・餌横取り）
    PANIC: 5       // ★ アクセント：ビビり逃走（巨大スネーク接近時にサッと身を翻す）
};

export class AIManager {
    constructor() {
        this.ais = [];
        this.sliceIndex = 0;
        this.faces = ['normal', 'angry', 'happy', 'cool', 'cute'];
        
        // 各AIの個別性格・行動メタデータ
        this.aiMeta = [];
    }

    init(count, playerX, playerY) {
        this.ais = [];
        this.aiMeta = [];

        for (let i = 1; i <= count; i++) {
            const color = SNAKE_COLORS[i % SNAKE_COLORS.length];
            const face = this.faces[i % this.faces.length];
            const ai = new Snake(false, i, `CPU ${i}`, color, face);

            const randVal = Math.random();
            let persona = 'forager'; // デフォルト採餌型（50%）
            if (randVal < 0.15) persona = 'hunter';        // 15%: たまに狩りを仕掛ける個体
            else if (randVal < 0.30) persona = 'harasser'; // 15%: 生意気に前を横切るトリックスター
            else if (randVal < 0.50) persona = 'cruiser';  // 20%: 悠然と回遊する大型予備軍

            this.aiMeta.push({
                state: AI_STATE.FORAGING,
                persona: persona,
                targetFoodPos: null,
                stateTimer: 40 + Math.floor(Math.random() * 60),
                scavengeTarget: null,
                cruiseDirection: Math.random() < 0.5 ? 1 : -1,
                harassSubtype: 0, // 0: 進路横切り, 1: 餌横取り, 2: 併走プレッシャー
                harassCooldown: Math.floor(Math.random() * 60),
                panicCooldown: 0, // ビビり逃走クールダウン
                deadTimer: 0 // 実時間リスポーン管理用
            });

            // マップ全域への分散スポーン
            const angle = Math.random() * Math.PI * 2;
            const dist = 1500 + Math.random() * 22000;
            const sx = Math.max(400, Math.min(MAP_SIZE - 400, playerX + Math.cos(angle) * dist));
            const sy = Math.max(400, Math.min(MAP_SIZE - 400, playerY + Math.sin(angle) * dist));
            ai.reset(sx, sy);

            if (Math.random() < 0.35) {
                ai.addScore(Math.floor(200 + Math.random() * 1400));
            }
            this.ais.push(ai);
        }
    }

    /**
     * AIシミュレーション更新（完全DeltaTime対応）
     * @param {Object} player 
     * @param {Array} allSnakes 
     * @param {number} frameCount 
     * @param {number} [dtSec=0.016] 実経過秒数
     */
    update(player, allSnakes, frameCount, dtSec = 1 / 60) {
        const total = this.ais.length;
        if (total === 0) return;

        const safeDt = (typeof dtSec === 'number' && dtSec > 0) ? Math.min(dtSec, 0.1) : (1 / 60);
        // 60FPS基準のタイムスケール（120FPSなら約0.5、30FPSなら約2.0）
        const timeScale = Math.max(0.1, Math.min(3.0, safeDt * 60));

        const batchSize = Math.ceil(total / 4);
        const startIndex = (this.sliceIndex * batchSize) % total;
        this.sliceIndex = (this.sliceIndex + 1) % 4;

        let activeDrops = null;
        if (typeof window !== 'undefined' && window.currentWorldInstance && window.currentWorldInstance.dropFoods) {
            activeDrops = window.currentWorldInstance.dropFoods;
        }

        for (let i = 0; i < total; i++) {
            const ai = this.ais[i];
            const meta = this.aiMeta[i];
            if (!meta) continue;

            if (ai.isDead) {
                // 実時間（約1.25秒）経過後にリスポーン
                meta.deadTimer = (meta.deadTimer || 0) + safeDt;
                if (meta.deadTimer >= 1.25) {
                    meta.deadTimer = 0;
                    const ang = Math.random() * Math.PI * 2;
                    const d = 3500 + Math.random() * 14000;
                    const pX = (player && !player.isDead) ? player.x : (MAP_SIZE / 2);
                    const pY = (player && !player.isDead) ? player.y : (MAP_SIZE / 2);
                    const rx = Math.max(400, Math.min(MAP_SIZE - 400, pX + Math.cos(ang) * d));
                    const ry = Math.max(400, Math.min(MAP_SIZE - 400, pY + Math.sin(ang) * d));
                    ai.reset(rx, ry);
                    meta.state = AI_STATE.FORAGING;
                    meta.stateTimer = 50;
                    meta.harassCooldown = 90;
                    meta.panicCooldown = 60;
                }
                continue;
            }

            const shouldThink = (i >= startIndex && i < startIndex + batchSize);
            if (shouldThink) {
                this.think(ai, meta, player, allSnakes, activeDrops, timeScale);
            }

            ai.updatePhysics(safeDt, null, ai.isBoosting);
        }
    }

    /**
     * AI思考ルーチン（タイムスケール考慮版）
     */
    think(ai, meta, player, allSnakes, activeDrops, timeScale = 1.0) {
        meta.stateTimer -= timeScale;
        if (meta.harassCooldown > 0) {
            meta.harassCooldown = Math.max(0, meta.harassCooldown - timeScale);
        }
        if (meta.panicCooldown > 0) {
            meta.panicCooldown = Math.max(0, meta.panicCooldown - timeScale);
        }

        // 1. 【最優先】外壁激突回避
        const wallMargin = 400 + ai.size * 2;
        if (ai.x < wallMargin || ai.x > MAP_SIZE - wallMargin || ai.y < wallMargin || ai.y > MAP_SIZE - wallMargin) {
            ai.targetAngle = Math.atan2(MAP_SIZE / 2 - ai.y, MAP_SIZE / 2 - ai.x);
            ai.isBoosting = false;
            return;
        }

        // 2. 【最重要】近隣の他スネーク胴体への激突回避（O(1) リングバッファ ＆ 二乗距離）
        let threatFound = false;
        const headCheckDistSq = 900 * 900;

        for (let i = 0; i < allSnakes.length; i++) {
            const other = allSnakes[i];
            if (other === ai || other.isDead || !other.isVisible) continue;

            const dx = other.x - ai.x;
            const dy = other.y - ai.y;
            const distHeadSq = dx * dx + dy * dy;

            if (distHeadSq < headCheckDistSq) {
                const histLen = other.historyLength || 0;
                const safeDistLimit = ai.size * 3.4 + other.size * 1.5;
                const safeDistLimitSq = safeDistLimit * safeDistLimit;

                for (let j = 0; j < histLen; j += 4) {
                    const idx = (other.headIdx + j) % 2048;
                    const seg = other.history[idx];
                    if (!seg) continue;

                    const sdx = seg.x - ai.x;
                    const sdy = seg.y - ai.y;
                    const sDistSq = sdx * sdx + sdy * sdy;

                    if (sDistSq < safeDistLimitSq) {
                        const angleToBody = Math.atan2(sdy, sdx);
                        let diff = angleToBody - ai.angle;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;

                        if (Math.abs(diff) < Math.PI / 2.0) {
                            ai.targetAngle = ai.angle + (diff > 0 ? -Math.PI / 1.6 : Math.PI / 1.6);
                            ai.isBoosting = ai.score > 120 && sDistSq < (safeDistLimitSq * 0.40);
                            threatFound = true;
                            break;
                        }
                    }
                }
            }
            if (threatFound) break;
        }

        if (threatFound) return;

        // ★ アクセント①：【ビビり逃走リアクション（Panic Evasion）】
        // 自分よりスコアが2倍以上ある格上スネークが 500px 以内に急接近してきた時、身を翻して小ダッシュ逃走
        if (meta.panicCooldown <= 0 && meta.state !== AI_STATE.PANIC && ai.score > 60) {
            let giantThreat = null;
            const panicDistSq = 500 * 500;

            for (let i = 0; i < allSnakes.length; i++) {
                const other = allSnakes[i];
                if (other === ai || other.isDead || !other.isVisible) continue;
                if (other.score >= ai.score * 2.0) {
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
                meta.stateTimer = 18; // 約0.3秒でサッと終わる小リアクション
                meta.panicCooldown = 180; // 次回まで約3秒クールダウン
                const awayAngle = Math.atan2(ai.y - giantThreat.y, ai.x - giantThreat.x);
                ai.targetAngle = awayAngle + (Math.random() - 0.5) * 0.4;
                ai.isBoosting = ai.score > 75; // 驚いてピュッとダッシュ
                return;
            }
        }

        // 3. 【ハイエナモード判定】死体肉片のサイズ・価値に応じた感知半径の動的スケーリング
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

                // ★ アクセント②：【おこぼれ横取りダッシュ（Scavenger Snatch）】
                // 肉片まで 350px 以内に迫ったら「我先に！」と一瞬ブーストを踏み込む
                const isNearDrop = minDropDistSq < (350 * 350);
                ai.isBoosting = (ai.score > 85 && isNearDrop) || (ai.score > 100 && Math.random() < 0.35);
                return;
            }
        }

        // 4. 【プレイヤー接近時の「ちょっかい行動」トリガー判定（マイルド調律）】
        const isPlayerActive = player && !player.isDead && player.isVisible;
        if (isPlayerActive && meta.harassCooldown <= 0 && meta.state !== AI_STATE.HARASS && meta.state !== AI_STATE.PANIC) {
            const pdx = player.x - ai.x;
            const pdy = player.y - ai.y;
            const pDistSq = pdx * pdx + pdy * pdy;

            const harassRangeSq = 1200 * 1200;

            if (pDistSq < harassRangeSq) {
                const triggerRate = meta.persona === 'harasser' ? 0.20 : 0.08;
                if (Math.random() < triggerRate) {
                    meta.state = AI_STATE.HARASS;
                    meta.stateTimer = 35 + Math.floor(Math.random() * 30);
                    meta.harassSubtype = Math.floor(Math.random() * 3);
                    meta.harassCooldown = 120 + Math.floor(Math.random() * 90);
                }
            }
        }

        // 5. 【ステートタイマー満了時の自然遷移】
        if (meta.stateTimer <= 0) {
            if (meta.state === AI_STATE.HARASS || meta.state === AI_STATE.PANIC) {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 80 + Math.floor(Math.random() * 70);
                ai.isBoosting = false;
            } else if (meta.persona === 'cruiser' && ai.size > 22) {
                meta.state = AI_STATE.CRUISING;
                meta.stateTimer = 90 + Math.floor(Math.random() * 120);
            } else if (meta.persona === 'hunter') {
                meta.state = (Math.random() < 0.40) ? AI_STATE.HUNTER : AI_STATE.FORAGING;
                meta.stateTimer = 50 + Math.floor(Math.random() * 50);
            } else {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 70 + Math.floor(Math.random() * 80);
            }
        }

        // 6. 【各ステートの行動実行】
        switch (meta.state) {
            case AI_STATE.PANIC: {
                // ビビり逃走持続（短時間で終わる）
                break;
            }

            case AI_STATE.HARASS: {
                if (!isPlayerActive) {
                    meta.state = AI_STATE.FORAGING;
                    ai.isBoosting = false;
                    break;
                }

                if (meta.harassSubtype === 0) {
                    const leadDist = 380 + player.size * 1.5;
                    const predictX = player.x + Math.cos(player.angle) * leadDist;
                    const predictY = player.y + Math.sin(player.angle) * leadDist;
                    ai.targetAngle = Math.atan2(predictY - ai.y, predictX - ai.x);
                    ai.isBoosting = ai.score > 90 && Math.random() < 0.45;
                } else if (meta.harassSubtype === 1) {
                    const lateralAngle = player.angle + (Math.random() < 0.5 ? Math.PI / 2.2 : -Math.PI / 2.2);
                    const flankX = player.x + Math.cos(lateralAngle) * (player.size * 3.2 + ai.size * 2.2);
                    const flankY = player.y + Math.sin(lateralAngle) * (player.size * 3.2 + ai.size * 2.2);
                    ai.targetAngle = Math.atan2(flankY - ai.y, flankX - ai.x) * 0.3 + player.angle * 0.7;
                    ai.isBoosting = ai.score > 100 && player.isBoosting && Math.random() < 0.40;
                } else {
                    const frontX = player.x + Math.cos(player.angle) * 280;
                    const frontY = player.y + Math.sin(player.angle) * 280;
                    ai.targetAngle = Math.atan2(frontY - ai.y, frontX - ai.x);
                    ai.isBoosting = ai.score > 85 && Math.random() < 0.55;
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
                let minHuntDistSq = 1300 * 1300;

                for (let i = 0; i < allSnakes.length; i++) {
                    const other = allSnakes[i];
                    if (other === ai || other.isDead || !other.isVisible) continue;
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
                    const isEnemyHuge = huntTarget.size > ai.size * 1.5;
                    const angleToEnemy = Math.atan2(huntTarget.y - ai.y, huntTarget.x - ai.x);

                    if (isEnemyHuge) {
                        ai.targetAngle = angleToEnemy + Math.PI;
                        ai.isBoosting = ai.score > 120 && Math.random() < 0.35;
                    } else {
                        const leadDist = 110 + huntTarget.size;
                        const tx = huntTarget.x + Math.cos(huntTarget.angle) * leadDist;
                        const ty = huntTarget.y + Math.sin(huntTarget.angle) * leadDist;
                        ai.targetAngle = Math.atan2(ty - ai.y, tx - ai.x);
                        ai.isBoosting = ai.score > 110 && Math.random() < 0.40;
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