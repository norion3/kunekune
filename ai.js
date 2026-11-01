// ==============================================================================
// 『くねくねバトル オンライン』スネーク.io型 自律生態系AIマネージャー (ai.js)
// v24.2.0 マイルドちょっかい調律＆適正緊張感バランス版:
// ・ちょっかい行動（HARASS）の過剰粘着を根絶し、適度なスリルを与える10%前後の発動率へ調律
// ・索敵反応距離を 1,800px から 1,200px へ縮小（画面内に近づいた時のみ自然に反応）
// ・ちょっかい発動後のクールダウンを2〜3秒へ延長し、連続執拗アタックを完全防止
// ・MAP_SIZE = 60000 を活かしたマップ環境勾配（外周安全ゾーン・中心激戦コア）維持
// ・死体肉片のサイズ・価値に応じたハイエナ感知半径の動的スケーリング維持
// ・CPU平方根計算ゼロ化（二乗距離判定）＆ リングバッファ O(1) 完全維持
// ==============================================================================

import { MAP_SIZE, SNAKE_COLORS } from './constants.js';
import { Snake } from './snake.js';

// AIの生態系ステート
const AI_STATE = {
    FORAGING: 0,   // マイペース採餌（平和に餌を食べる）
    CRUISING: 1,   // 大回遊パトロール（広大な空間を悠然と横断・巨大な壁）
    SCAVENGER: 2,  // ハイエナ肉片争奪（撃破残骸や大量餌へ一斉殺到）
    HUNTER: 3,     // 狡猾な狩猟（好戦的な個体によるキル狙い）
    HARASS: 4      // ちょっかい行動（進路横切り・並走威嚇・餌横取り）
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

            // ★ 性格ペルソナの適正配分（大半を平和な採餌型とし、ちょっかい型はほどよい比率に抑制）
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
                harassCooldown: Math.floor(Math.random() * 60) // ちょっかい連続発生防止タイマー
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

    update(player, allSnakes, frameCount) {
        const total = this.ais.length;
        if (total === 0) return;

        const batchSize = Math.ceil(total / 4);
        const startIndex = (this.sliceIndex * batchSize) % total;
        this.sliceIndex = (this.sliceIndex + 1) % 4;

        // ドロップ肉片の存在検知（ハイエナモード発動用）
        let activeDrops = null;
        if (typeof window !== 'undefined' && window.currentWorldInstance && window.currentWorldInstance.dropFoods) {
            activeDrops = window.currentWorldInstance.dropFoods;
        }

        for (let i = 0; i < total; i++) {
            const ai = this.ais[i];
            const meta = this.aiMeta[i];
            if (!meta) continue;

            if (ai.isDead) {
                // リスポーン：自然な距離でマップ内に再配置
                if (frameCount % 75 === 0) {
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
                }
                continue;
            }

            const shouldThink = (i >= startIndex && i < startIndex + batchSize);
            if (shouldThink) {
                this.think(ai, meta, player, allSnakes, activeDrops);
            }

            ai.updatePhysics(null, ai.isBoosting);
        }
    }

    think(ai, meta, player, allSnakes, activeDrops) {
        meta.stateTimer--;
        if (meta.harassCooldown > 0) {
            meta.harassCooldown--;
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
                ai.isBoosting = ai.score > 90 && Math.random() < 0.50;
                return;
            }
        }

        // 4. 【プレイヤー接近時の「ちょっかい行動」トリガー判定（★マイルド調律）】
        const isPlayerActive = player && !player.isDead && player.isVisible;
        if (isPlayerActive && meta.harassCooldown <= 0 && meta.state !== AI_STATE.HARASS) {
            const pdx = player.x - ai.x;
            const pdy = player.y - ai.y;
            const pDistSq = pdx * pdx + pdy * pdy;

            // 索敵反応距離を 1,800px → 1,200px へ縮小（目の前に近づいた時のみ適度に反応）
            const harassRangeSq = 1200 * 1200;

            if (pDistSq < harassRangeSq) {
                // 発動率を約10%〜15%に抑制（10回に1回程度、たまに前を横切るくらいの絶妙な頻度）
                const triggerRate = meta.persona === 'harasser' ? 0.20 : 0.08;
                if (Math.random() < triggerRate) {
                    meta.state = AI_STATE.HARASS;
                    meta.stateTimer = 35 + Math.floor(Math.random() * 30); // 0.6〜1.0秒程度でサッと終わる
                    meta.harassSubtype = Math.floor(Math.random() * 3);
                    meta.harassCooldown = 120 + Math.floor(Math.random() * 90); // 実行後は2〜3.5秒間のクールダウン
                }
            }
        }

        // 5. 【ステートタイマー満了時の自然遷移（採餌への復帰を促進）】
        if (meta.stateTimer <= 0) {
            if (meta.state === AI_STATE.HARASS) {
                // ちょっかい行動完了後は、粘着せずに必ず平和な採餌モードへ復帰
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
            case AI_STATE.HARASS: {
                if (!isPlayerActive) {
                    meta.state = AI_STATE.FORAGING;
                    ai.isBoosting = false;
                    break;
                }

                if (meta.harassSubtype === 0) {
                    // ①「進路横切り（Cut-In Harassment）」
                    // プレイヤーの前方を予測して軽く横切り、すぐに離脱する
                    const leadDist = 380 + player.size * 1.5;
                    const predictX = player.x + Math.cos(player.angle) * leadDist;
                    const predictY = player.y + Math.sin(player.angle) * leadDist;
                    ai.targetAngle = Math.atan2(predictY - ai.y, predictX - ai.x);
                    ai.isBoosting = ai.score > 90 && Math.random() < 0.45;
                } else if (meta.harassSubtype === 1) {
                    // ②「併走・プレッシャー（Shoulder Pressure）」
                    // 適度な距離を保ちながら横並びで並走
                    const lateralAngle = player.angle + (Math.random() < 0.5 ? Math.PI / 2.2 : -Math.PI / 2.2);
                    const flankX = player.x + Math.cos(lateralAngle) * (player.size * 3.2 + ai.size * 2.2);
                    const flankY = player.y + Math.sin(lateralAngle) * (player.size * 3.2 + ai.size * 2.2);
                    ai.targetAngle = Math.atan2(flankY - ai.y, flankX - ai.x) * 0.3 + player.angle * 0.7;
                    ai.isBoosting = ai.score > 100 && player.isBoosting && Math.random() < 0.40;
                } else {
                    // ③「餌横取りダッシュ（Greedy Snatch）」
                    // プレイヤーの進行方向にある餌を先回りして奪う
                    const frontX = player.x + Math.cos(player.angle) * 280;
                    const frontY = player.y + Math.sin(player.angle) * 280;
                    ai.targetAngle = Math.atan2(frontY - ai.y, frontX - ai.x);
                    ai.isBoosting = ai.score > 85 && Math.random() < 0.55;
                }
                break;
            }

            case AI_STATE.CRUISING: {
                // 大回遊：緩やかなカーブに加え、マップ中心（激戦コア）方向への微細な引力バイアス
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
                        // 偏差射撃のように相手の頭部の前方を狙う
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