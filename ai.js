// ==============================================================================
// 『くねくねバトル オンライン』スネーク.io型 自律生態系AIマネージャー (ai.js)
// v23.0.0 好戦的ちょっかい3大行動＆動的プレッシャー完全統合版:
// ・プレイヤーに対する3大ちょっかい行動（進路横切り・餌横取りダッシュ・併走プレッシャー）
// ・臆病な即座逃走ルーチンを撤廃し、適度なスリルと駆け引きを生む攻撃的迎撃
// ・MAP_SIZE = 60000 を活かしたマップ環境勾配（外周安全ゾーン・中心激戦コア）
// ・死体肉片のサイズ・価値に応じたハイエナ感知半径の動的スケーリング
// ・大回遊（CRUISING）モードにおけるマップ中心への緩やかな引力バイアス
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

            // 性格ペルソナの初期化
            const randVal = Math.random();
            let persona = 'forager'; // デフォルト採餌型
            if (randVal < 0.25) persona = 'hunter';       // 25%: 好戦的ハンター
            else if (randVal < 0.50) persona = 'harasser'; // 25%: ちょっかいトリックスター
            else if (randVal < 0.75) persona = 'cruiser';  // 25%: 大回遊スネーク

            this.aiMeta.push({
                state: AI_STATE.FORAGING,
                persona: persona,
                targetFoodPos: null,
                stateTimer: 30 + Math.floor(Math.random() * 60),
                scavengeTarget: null,
                cruiseDirection: Math.random() < 0.5 ? 1 : -1,
                harassSubtype: 0 // 0: 進路横切り, 1: 餌横取り, 2: 併走プレッシャー
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
                    meta.stateTimer = 40;
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

                const dynamicSmellRadius = 2800 + Math.min(2700, (drop.val || 20) * 85);
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
                ai.isBoosting = ai.score > 90 && Math.random() < 0.65;
                return;
            }
        }

        // 4. 【プレイヤー接近時の「ちょっかい行動」トリガー判定】
        const isPlayerActive = player && !player.isDead && player.isVisible;
        if (isPlayerActive) {
            const pdx = player.x - ai.x;
            const pdy = player.y - ai.y;
            const pDistSq = pdx * pdx + pdy * pdy;
            const harassRangeSq = 1800 * 1800; // 半径1800px以内でちょっかい発動

            if (pDistSq < harassRangeSq && (meta.persona === 'harasser' || meta.persona === 'hunter' || Math.random() < 0.28)) {
                meta.state = AI_STATE.HARASS;
                if (meta.stateTimer <= 0) {
                    meta.stateTimer = 45 + Math.floor(Math.random() * 50);
                    meta.harassSubtype = Math.floor(Math.random() * 3);
                }
            }
        }

        // 5. 【ステートタイマー満了時の自然遷移】
        if (meta.stateTimer <= 0) {
            if (meta.persona === 'cruiser' && ai.size > 22) {
                meta.state = AI_STATE.CRUISING;
                meta.stateTimer = 90 + Math.floor(Math.random() * 120);
            } else if (meta.persona === 'hunter') {
                meta.state = (Math.random() < 0.60) ? AI_STATE.HUNTER : AI_STATE.FORAGING;
                meta.stateTimer = 50 + Math.floor(Math.random() * 60);
            } else if (meta.persona === 'harasser') {
                meta.state = (Math.random() < 0.50) ? AI_STATE.HARASS : AI_STATE.FORAGING;
                meta.stateTimer = 40 + Math.floor(Math.random() * 50);
                meta.harassSubtype = Math.floor(Math.random() * 3);
            } else {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 60 + Math.floor(Math.random() * 80);
            }
        }

        // 6. 【各ステートの行動実行】
        switch (meta.state) {
            case AI_STATE.HARASS: {
                // ★ 3大ちょっかいアルゴリズムの実装
                if (!isPlayerActive) {
                    meta.state = AI_STATE.FORAGING;
                    ai.isBoosting = false;
                    break;
                }

                if (meta.harassSubtype === 0) {
                    // ①「進路横切り（Cut-In Harassment）」
                    // プレイヤーの前方400〜600pxを予測し、横からブーストで突っ切る
                    const leadDist = 420 + player.size * 2;
                    const predictX = player.x + Math.cos(player.angle) * leadDist;
                    const predictY = player.y + Math.sin(player.angle) * leadDist;
                    ai.targetAngle = Math.atan2(predictY - ai.y, predictX - ai.x);
                    ai.isBoosting = ai.score > 90 && Math.random() < 0.70;
                } else if (meta.harassSubtype === 1) {
                    // ②「併走・プレッシャー（Shoulder Pressure）」
                    // プレイヤーと並走しながら、横からジワジワ頭部を近づけて威嚇
                    const lateralAngle = player.angle + (Math.random() < 0.5 ? Math.PI / 2.3 : -Math.PI / 2.3);
                    const flankX = player.x + Math.cos(lateralAngle) * (player.size * 2.8 + ai.size * 2.0);
                    const flankY = player.y + Math.sin(lateralAngle) * (player.size * 2.8 + ai.size * 2.0);
                    ai.targetAngle = Math.atan2(flankY - ai.y, flankX - ai.x) * 0.4 + player.angle * 0.6;
                    ai.isBoosting = ai.score > 100 && player.isBoosting;
                } else {
                    // ③「餌横取りダッシュ（Greedy Snatch）」
                    // プレイヤーの進行方向にある餌を先回りしてブースト強奪
                    const frontX = player.x + Math.cos(player.angle) * 320;
                    const frontY = player.y + Math.sin(player.angle) * 320;
                    ai.targetAngle = Math.atan2(frontY - ai.y, frontX - ai.x);
                    ai.isBoosting = ai.score > 80;
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
                let minHuntDistSq = 1500 * 1500;

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
                        ai.isBoosting = ai.score > 120 && Math.random() < 0.45;
                    } else {
                        // 偏差射撃のように相手の頭部の前方を狙ってブースト突撃
                        const leadDist = 130 + huntTarget.size;
                        const tx = huntTarget.x + Math.cos(huntTarget.angle) * leadDist;
                        const ty = huntTarget.y + Math.sin(huntTarget.angle) * leadDist;
                        ai.targetAngle = Math.atan2(ty - ai.y, tx - ai.x);
                        ai.isBoosting = ai.score > 110 && Math.random() < 0.55;
                    }
                } else {
                    ai.targetAngle += (Math.random() - 0.5) * 0.4;
                    ai.isBoosting = false;
                }
                break;
            }

            case AI_STATE.FORAGING:
            default: {
                if (Math.random() < 0.15) {
                    ai.targetAngle += (Math.random() - 0.5) * 0.7;
                }
                ai.isBoosting = false;
                break;
            }
        }
    }
}