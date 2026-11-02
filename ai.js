// ==============================================================================
// 『くねくねバトル オンライン』スネーク.io型 自律生態系AIマネージャー (ai.js)
// v28.1.0 完全機能継承・生態系ピラミッド＆適正密度調律版:
// ・【全機能完全継承】カミカゼ暗殺(AMBUSH)、包囲コイリング(HUNTER)、3種ちょっかい(HARASS)、
// 　ハイエナ肉片争奪(SCAVENGER)、ビビり逃走(PANIC)、大回遊(CRUISING)、完全DeltaTime、
// 　動的循環スポーン、画面外仮想成長の全ルーチンを一切省略せず100%完全保持
// ・【初期スコアのピラミッド化】開幕から巨大な敵だらけになるインフレを解消。
// 　80%を小型(50〜150pt)、15%を中型(200〜600pt)、5%のみをボス格(1000〜2500pt)とする自然な分布へ最適化
// ・【適正密度・息苦しさ解消】プレイヤー周囲が敵だらけ（レーダーが真っ赤）になる過密を解消。
// 　開幕の配備範囲を広域(2000〜16000px)へ分散し、動的循環スポーンの再配置距離も
// 　(4000〜8500px) へ適正拡大。「探せば敵が見つかり、適度に交戦できる」広大な深宇宙の距離感を復元
// ・【画面外成長のマイルド化】画面外AIの仮想成長レートを約1/3に調律し、プレイヤーの努力が報われるテンポを確立
// ==============================================================================

import { MAP_SIZE, SNAKE_COLORS } from './constants.js';
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

export class AIManager {
    constructor() {
        this.ais = [];
        this.sliceIndex = 0;
        this.faces = ['normal', 'angry', 'happy', 'cool', 'cute'];
        
        // 各AIの個別性格・行動メタデータ
        this.aiMeta = [];

        // 仮想成長用アキュムレーター
        this._virtualGrowthTimer = 0;
    }

    init(count, playerX, playerY) {
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
                ambushTarget: null
            });

            // ★ 初期配置の広域分散化（開幕直後の異常過密・敵だらけ状態を解消）
            const angle = Math.random() * Math.PI * 2;
            const dist = 2000 + Math.random() * 16000;
            const sx = Math.max(400, Math.min(MAP_SIZE - 400, playerX + Math.cos(angle) * dist));
            const sy = Math.max(400, Math.min(MAP_SIZE - 400, playerY + Math.sin(angle) * dist));
            ai.reset(sx, sy);

            // ★ ピラミッド型スコア分布（初期インフレの完全解消）
            // 全員が巨大化している不自然さを根絶し、大半が自分と同等以下の適正難易度へ
            const scoreRand = Math.random();
            if (scoreRand < 0.05) {
                // 5%: ごく稀にマップを回遊するボス格（1000〜2500pt）
                ai.addScore(Math.floor(1000 + Math.random() * 1500));
            } else if (scoreRand < 0.20) {
                // 15%: 中堅個体（200〜600pt）
                ai.addScore(Math.floor(200 + Math.random() * 400));
            } else {
                // 80%: 基本となる小型・ザコ個体（初期50pt + わずかなゆらぎ 0〜100pt）
                ai.addScore(Math.floor(Math.random() * 100));
            }

            this.ais.push(ai);
        }
    }

    /**
     * AIシミュレーション更新（動的循環スポーン＆仮想成長対応）
     * @param {Object} player 
     * @param {Array} allSnakes 
     * @param {number} frameCount 
     * @param {number} [dtSec=0.016] 実経過秒数
     */
    update(player, allSnakes, frameCount, dtSec = 1 / 60) {
        const total = this.ais.length;
        if (total === 0) return;

        const safeDt = (typeof dtSec === 'number' && dtSec > 0) ? Math.min(dtSec, 0.1) : (1 / 60);
        const timeScale = Math.max(0.1, Math.min(3.0, safeDt * 60));

        // 1. 【画面外AIの仮想バックグラウンド成長】（ランキング静止バグを防ぎつつ、インフレを抑えたマイルド調律）
        this._virtualGrowthTimer += safeDt;
        if (this._virtualGrowthTimer >= 0.5) {
            const growthInterval = this._virtualGrowthTimer;
            this._virtualGrowthTimer = 0;

            for (let i = 0; i < total; i++) {
                const ai = this.ais[i];
                if (ai.isDead || ai.isVisible) continue;

                const meta = this.aiMeta[i];
                if (!meta) continue;

                // 成長レートを適正化（毎秒 6〜14pt 程度に抑制）
                let gainRate = 6;
                if (meta.persona === 'hunter' || meta.persona === 'cruiser') gainRate = 14;
                if (meta.persona === 'forager') gainRate = 9;

                ai.addScore(gainRate * growthInterval);

                // 仮想キル発生頻度と獲得量をマイルド化
                if (Math.random() < 0.006) {
                    const killBonus = Math.floor(150 + Math.random() * 500);
                    ai.addScore(killBonus);
                    ai.kills = (ai.kills || 0) + 1;
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

        const isPlayerAlive = player && !player.isDead;
        const pX = isPlayerAlive ? player.x : (MAP_SIZE / 2);
        const pY = isPlayerAlive ? player.y : (MAP_SIZE / 2);
        const pAngle = isPlayerAlive ? player.angle : 0;

        // ★ 動的循環スポーン判定用の遠隔閾値（15,000px）
        // プレイヤーから極端に離れたAIのみを対象とし、近場の生態系は乱さない
        const recycleDistSq = 15000 * 15000;

        for (let i = 0; i < total; i++) {
            const ai = this.ais[i];
            const meta = this.aiMeta[i];
            if (!meta) continue;

            // 死亡中AIのリスポーン処理
            if (ai.isDead) {
                meta.deadTimer = (meta.deadTimer || 0) + safeDt;
                if (meta.deadTimer >= 1.25) {
                    meta.deadTimer = 0;

                    // ★ リスポーン位置を広域に散らし、倒した敵がすぐ目の前に再出現する不快感を解消
                    const ang = Math.random() * Math.PI * 2;
                    const d = 4000 + Math.random() * 8000;
                    const rx = Math.max(400, Math.min(MAP_SIZE - 400, pX + Math.cos(ang) * d));
                    const ry = Math.max(400, Math.min(MAP_SIZE - 400, pY + Math.sin(ang) * d));
                    ai.reset(rx, ry);

                    // 復活時の中型化確率を10%へ引き下げ
                    if (Math.random() < 0.10) {
                        ai.addScore(Math.floor(150 + Math.random() * 450));
                    }

                    meta.state = AI_STATE.FORAGING;
                    meta.stateTimer = 50;
                    meta.harassCooldown = 90;
                    meta.panicCooldown = 60;
                }
                continue;
            }

            // ★ 【動的循環スポーン（過疎化防止 ＆ 絶妙な交戦密度ループ）】
            // 遠く離れすぎたAIを、プレイヤーの視野外周（4,000〜8,500px）へ前方を広くカバーして再配置
            // プレイヤー周囲が敵で埋まる過密を防ぎつつ、適度に探索すると必ず敵と会えるバランスを実現
            if (isPlayerAlive && !ai.isVisible && (frameCount + i) % 60 === 0) {
                const distToPlayerSq = (ai.x - pX) ** 2 + (ai.y - pY) ** 2;
                if (distToPlayerSq > recycleDistSq) {
                    const forwardBiasAngle = pAngle + (Math.random() - 0.5) * Math.PI * 1.5;
                    const spawnDist = 4200 + Math.random() * 4800;
                    const nx = Math.max(400, Math.min(MAP_SIZE - 400, pX + Math.cos(forwardBiasAngle) * spawnDist));
                    const ny = Math.max(400, Math.min(MAP_SIZE - 400, pY + Math.sin(forwardBiasAngle) * spawnDist));

                    ai.x = nx;
                    ai.y = ny;
                    ai.angle = forwardBiasAngle + Math.PI; // プレイヤーの方向へ緩やかに進入
                    ai.targetAngle = ai.angle;
                    ai.distCounter = 0;
                    ai.headIdx = 0;
                    ai.historyLength = 0;

                    meta.state = AI_STATE.FORAGING;
                    meta.stateTimer = 40 + Math.floor(Math.random() * 40);
                }
            }

            const shouldThink = (i >= startIndex && i < startIndex + batchSize);
            if (shouldThink) {
                this.think(ai, meta, player, allSnakes, activeDrops, timeScale);
            }

            ai.updatePhysics(safeDt, null, ai.isBoosting);
        }
    }

    /**
     * AI思考ルーチン（カミカゼ特攻・包囲狩猟・過度な逃走抑制・O(1)リングバッファ）
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

        // 2. 【最重要】近隣の他スネーク胴体への激突回避（O(1) リングバッファ）
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
                const safeDistLimit = ai.size * 2.5 + other.size * 1.2;
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
                            ai.isBoosting = ai.score > 100 && sDistSq < (safeDistLimitSq * 0.40);
                            threatFound = true;
                            break;
                        }
                    }
                }
            }
            if (threatFound) break;
        }

        if (threatFound) return;

        // 3. 【カミカゼ暗殺特攻（AMBUSH）】
        // 小型個体が巨大スネークの首元へブースト割り込みを仕掛け、一発逆転を狙うsnake.ioの本質的スリル
        if ((meta.persona === 'ambusher' || (meta.persona === 'harasser' && Math.random() < 0.4)) && ai.score > 60) {
            let giantTarget = null;
            let minGiantDistSq = 1400 * 1400;

            for (let i = 0; i < allSnakes.length; i++) {
                const other = allSnakes[i];
                if (other === ai || other.isDead || !other.isVisible) continue;
                if (other.invulnerableTimer && other.invulnerableTimer > 0) continue;

                if (other.score >= ai.score * 1.8 || other.size >= 28) {
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

        // 4. 【ビビり逃走の限定化】（臆病型のみ至近距離で発動し、敵が全員逃げる過疎化を防止）
        if (meta.persona === 'timid' && meta.panicCooldown <= 0 && meta.state !== AI_STATE.PANIC && ai.score > 60) {
            let giantThreat = null;
            const panicDistSq = 350 * 350;

            for (let i = 0; i < allSnakes.length; i++) {
                const other = allSnakes[i];
                if (other === ai || other.isDead || !other.isVisible) continue;
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

        // 6. 【プレイヤー接近時のちょっかい行動トリガー】
        const isPlayerActive = player && !player.isDead && player.isVisible;
        if (isPlayerActive && meta.harassCooldown <= 0 && meta.state !== AI_STATE.HARASS && meta.state !== AI_STATE.PANIC && meta.state !== AI_STATE.AMBUSH) {
            const pdx = player.x - ai.x;
            const pdy = player.y - ai.y;
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
            } else if (meta.persona === 'cruiser' && ai.size > 22) {
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

        // 8. 【各ステートの行動実行】
        switch (meta.state) {
            case AI_STATE.AMBUSH:
            case AI_STATE.PANIC:
                break;

            case AI_STATE.HARASS: {
                if (!isPlayerActive) {
                    meta.state = AI_STATE.FORAGING;
                    ai.isBoosting = false;
                    break;
                }

                if (meta.harassSubtype === 0) {
                    const leadDist = 280 + player.size * 1.5;
                    const predictX = player.x + Math.cos(player.angle) * leadDist;
                    const predictY = player.y + Math.sin(player.angle) * leadDist;
                    ai.targetAngle = Math.atan2(predictY - ai.y, predictX - ai.x);
                    ai.isBoosting = ai.score > 85 && Math.random() < 0.50;
                } else if (meta.harassSubtype === 1) {
                    const lateralAngle = player.angle + (Math.random() < 0.5 ? Math.PI / 2.2 : -Math.PI / 2.2);
                    const flankX = player.x + Math.cos(lateralAngle) * (player.size * 2.5 + ai.size * 2.0);
                    const flankY = player.y + Math.sin(lateralAngle) * (player.size * 2.5 + ai.size * 2.0);
                    ai.targetAngle = Math.atan2(flankY - ai.y, flankX - ai.x) * 0.4 + player.angle * 0.6;
                    ai.isBoosting = ai.score > 90 && player.isBoosting && Math.random() < 0.45;
                } else {
                    const frontX = player.x + Math.cos(player.angle) * 220;
                    const frontY = player.y + Math.sin(player.angle) * 220;
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
                    // 包囲コイリング狩猟知能：巨大AIが獲物の周囲を円を描くように回り込み、囲い込む
                    if (ai.size > huntTarget.size * 1.5 && ai.size > 28) {
                        const toTargetAngle = Math.atan2(huntTarget.y - ai.y, huntTarget.x - ai.x);
                        ai.targetAngle = toTargetAngle + Math.PI / 2.5;
                        ai.isBoosting = ai.score > 120 && Math.random() < 0.45;
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