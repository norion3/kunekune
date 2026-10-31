// ==============================================================================
// 『くねくねバトル オンライン』46体スネーク.io型 自律生態系AIマネージャー (ai.js)
// v20.10.0 生態系自律AIモデル (Ecosystem Behavior):
// ・MAP_SIZE = 60000 の広大さを100%活かした自然な過疎・過密の波
// ・4大自律ステート【採餌 / 大回遊パトロール / ハイエナ肉片争奪 / 狩猟ハンター】
// ・死体肉片への一斉殺到による突発的大乱戦の自然発生（スネーク.io本来の緊張と緩和）
// ・CPU平方根計算ゼロ化（二乗距離判定）＆ リングバッファ O(1) 完全維持
// ==============================================================================

import { MAP_SIZE, SNAKE_COLORS } from './constants.js';
import { Snake } from './snake.js';

// AIの4大生態系ステート
const AI_STATE = {
    FORAGING: 0,   // マイペース採餌（平和に餌を食べる・プレイヤー無視）
    CRUISING: 1,   // 大回遊パトロール（広大な空間を悠然と横断・巨大な壁）
    SCAVENGER: 2,  // ハイエナ肉片争奪（撃破残骸や大量餌へ一斉殺到・激戦の波）
    HUNTER: 3      // 狡猾な狩猟（好戦的な個体によるキル狙い）
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

            // 性格ペルソナの決定論的初期化
            const randVal = Math.random();
            let persona = 'forager'; // 60%: マイペース採餌
            if (randVal < 0.15) persona = 'hunter';      // 15%: 好戦的ハンター
            else if (randVal < 0.40) persona = 'cruiser'; // 25%: 大回遊スネーク

            this.aiMeta.push({
                state: AI_STATE.FORAGING,
                persona: persona,
                targetFoodPos: null,
                stateTimer: 30 + Math.floor(Math.random() * 60),
                scavengeTarget: null,
                cruiseDirection: Math.random() < 0.5 ? 1 : -1
            });

            // マップ全域への自然な分散スポーン（クラスタリング＆過疎エリアの形成）
            const angle = Math.random() * Math.PI * 2;
            const dist = 1500 + Math.random() * 22000;
            const sx = Math.max(400, Math.min(MAP_SIZE - 400, playerX + Math.cos(angle) * dist));
            const sy = Math.max(400, Math.min(MAP_SIZE - 400, playerY + Math.sin(angle) * dist));
            ai.reset(sx, sy);

            // 一部のAIを最初から中型〜大型として生成（世界観の深み）
            if (Math.random() < 0.35) {
                ai.addScore(Math.floor(200 + Math.random() * 1400));
            }
            this.ais.push(ai);
        }
    }

    update(player, allSnakes, frameCount) {
        const total = this.ais.length;
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
                // リスポーン：プレイヤーに過剰に近づけず、自然な距離でマップ内に再配置
                if (frameCount % 75 === 0) {
                    const ang = Math.random() * Math.PI * 2;
                    const d = 3500 + Math.random() * 12000;
                    const rx = Math.max(400, Math.min(MAP_SIZE - 400, player.x + Math.cos(ang) * d));
                    const ry = Math.max(400, Math.min(MAP_SIZE - 400, player.y + Math.sin(ang) * d));
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
                const safeDistLimit = ai.size * 3.8 + other.size * 1.8;
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
                            // 胴体を避けるように反対方向へ旋回
                            ai.targetAngle = ai.angle + (diff > 0 ? -Math.PI / 1.7 : Math.PI / 1.7);
                            // 危険度が高い場合のみ緊急ブースト
                            ai.isBoosting = ai.score > 120 && sDistSq < (safeDistLimitSq * 0.45);
                            threatFound = true;
                            break;
                        }
                    }
                }
            }
            if (threatFound) break;
        }

        if (threatFound) return;

        // 3. 【ハイエナモード判定】近くに死体肉片（ドロップ餌）があるか探知（突発的大混戦の起点）
        if (activeDrops && activeDrops.length > 0 && meta.persona !== 'cruiser') {
            const smellDistSq = 3200 * 3200; // 餌の匂いを感知する範囲
            let nearestDrop = null;
            let minDropDistSq = smellDistSq;

            // 直近のドロップを数件サンプリング
            const checkLimit = Math.min(20, activeDrops.length);
            for (let dIdx = 0; dIdx < checkLimit; dIdx++) {
                const drop = activeDrops[dIdx];
                const ddx = drop.x - ai.x;
                const ddy = drop.y - ai.y;
                const dropDistSq = ddx * ddx + ddy * ddy;
                if (dropDistSq < minDropDistSq) {
                    minDropDistSq = dropDistSq;
                    nearestDrop = drop;
                }
            }

            if (nearestDrop) {
                // 肉片を奪いにいく「ハイエナ争奪」モードへ移行
                meta.state = AI_STATE.SCAVENGER;
                meta.scavengeTarget = nearestDrop;
                const toDropAngle = Math.atan2(nearestDrop.y - ai.y, nearestDrop.x - ai.x);
                ai.targetAngle = toDropAngle;
                // 肉片争奪時はスネーク.io特有の一斉ブーストダッシュ！
                ai.isBoosting = ai.score > 90 && Math.random() < 0.65;
                return;
            }
        }

        // 4. 【4大自律ステートの思考ルーチン】
        if (meta.stateTimer <= 0) {
            // ペルソナに基づき次ステートを自然に切り替え
            if (meta.persona === 'cruiser' && ai.size > 22) {
                meta.state = AI_STATE.CRUISING;
                meta.stateTimer = 90 + Math.floor(Math.random() * 120);
            } else if (meta.persona === 'hunter') {
                meta.state = (Math.random() < 0.55) ? AI_STATE.HUNTER : AI_STATE.FORAGING;
                meta.stateTimer = 50 + Math.floor(Math.random() * 60);
            } else {
                meta.state = AI_STATE.FORAGING;
                meta.stateTimer = 60 + Math.floor(Math.random() * 80);
            }
        }

        switch (meta.state) {
            case AI_STATE.CRUISING: {
                // 大回遊：広大なマップを緩やかなカーブを描いて悠然と横断
                ai.targetAngle += meta.cruiseDirection * 0.015;
                ai.isBoosting = false;
                break;
            }

            case AI_STATE.HUNTER: {
                // 好戦的ハンター：隙のある近くの敵頭部を狙って旋回
                let huntTarget = null;
                let minHuntDistSq = 1400 * 1400;

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
                    const isEnemyHuge = huntTarget.size > ai.size * 1.4;
                    const angleToEnemy = Math.atan2(huntTarget.y - ai.y, huntTarget.x - ai.x);

                    if (isEnemyHuge) {
                        // 相手が巨大なら反転して退避
                        ai.targetAngle = angleToEnemy + Math.PI;
                        ai.isBoosting = ai.score > 120 && Math.random() < 0.4;
                    } else {
                        // 先読みして相手の前方を遮るように追尾
                        const leadDist = 110 + huntTarget.size;
                        const tx = huntTarget.x + Math.cos(huntTarget.angle) * leadDist;
                        const ty = huntTarget.y + Math.sin(huntTarget.angle) * leadDist;
                        ai.targetAngle = Math.atan2(ty - ai.y, tx - ai.x);
                        ai.isBoosting = ai.score > 120 && Math.random() < 0.35;
                    }
                } else {
                    ai.targetAngle += (Math.random() - 0.5) * 0.4;
                    ai.isBoosting = false;
                }
                break;
            }

            case AI_STATE.FORAGING:
            default: {
                // マイペース採餌：プレイヤーを完全無視し、自律的に餌を探して緩やかに直進・蛇行
                if (Math.random() < 0.15) {
                    ai.targetAngle += (Math.random() - 0.5) * 0.7;
                }
                ai.isBoosting = false;
                break;
            }
        }
    }
}