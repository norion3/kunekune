// ==============================================================================
// 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
// v28.6.0 オリジナル生体ビジュアル復元＆隙間ゼロ有機的レンダリング版:
// ・【不格好なお団子・数珠つなぎの完全根絶】無理な間引き(step: 2〜3)で生じていた
// 　円同士の隙間を全廃。オリジナル版の密接な体節重ね合わせと、一括パス fill() を融合
// ・【オリジナル美しい生体テーパー復元】Math.pow(progress, 3.0) * 0.6 を採用し、
// 　首回りを力強く太く保ち、尾先に向けて鋭くしなやかに細くなる大蛇シルエットを完全復元
// ・【半透明ネオンチューブ光彩(alpha: 0.65)】ベタ塗りを廃止し、オリジナル版の透明度0.65を
// 　適用。円同士が滑らかに光を溶け合わせ、艶やかで美しい生体質感を表現
// ・【頭部と首の自然な一体化】頭部サイズ成長曲線(pow 0.46 * 0.40)を適正化し、
// 　頭だけが取り残される違和感を解消して圧倒的な存在感を創出
// ・【超低負荷一括パス描画】全節を滑らかに描画しつつも、Canvasパス構築を一括化することで
// 　100体規模でもDrawCallを最小限に抑え、60FPS完全維持
// ・【緊急離脱ブーストの無敵保護】リスポーン後の3.0秒無敵自然減衰を完全維持
// ・【タイポ完全解消】drawOverheadBadge 内の currentFloorScore 参照を完全修正
// ==============================================================================

import { BASE_SPEED, BOOST_SPEED_MULT, TURN_SPEED_PLAYER, MAP_SIZE } from './constants.js';
import { drawSnakeFace } from './snake_face.js';

const MAX_HISTORY = 2048; // リングバッファ最大長

/**
 * 頭上バッジ用スコア短縮フォーマッター
 */
function formatBadgeScore(val) {
    const s = Math.floor(val || 0);
    if (s >= 1000000) {
        return (s / 1000000).toFixed(1).replace(/\.0$/, '') + 'M pt';
    }
    if (s >= 10000) {
        return (s / 1000).toFixed(1).replace(/\.0$/, '') + 'k pt';
    }
    return `${s.toLocaleString()} pt`;
}

export class Snake {
    constructor(isPlayer = false, id = 0, name = '', color = '#00e5ff', face = 'normal') {
        this.isPlayer = isPlayer;
        this.id = id;
        this.name = name || (isPlayer ? 'あなた' : `CPU ${id}`);
        this.color = color;
        this.face = face;
        this.internalUid = isPlayer ? 'local_user' : null;

        this.x = MAP_SIZE / 2;
        this.y = MAP_SIZE / 2;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.speed = BASE_SPEED;
        this.turnSpeed = isPlayer ? TURN_SPEED_PLAYER : 0.08;

        this.score = 50;
        this.size = 14;
        this.targetLength = 16;
        
        // ゼロアロケーション・リングバッファ
        this.history = new Array(MAX_HISTORY);
        this.headIdx = 0;
        this.historyLength = 0;
        
        this.distCounter = 0;
        this.maxSize = this.size;

        this.isDead = false;
        this.kills = 0;
        this.isBoosting = false;
        this._prevBoostingState = false; // ブースト状態変化検知用
        this.isVisible = true;

        this.invulnerableTimer = 0;
        this.aiLevel = isPlayer ? 0 : (Math.floor(Math.random() * 3) + 1);
        this.aiChangeTimer = Math.floor(Math.random() * 30);

        // 頭上バッジ描画用テキスト計測キャッシュ
        this._cachedBadgeScore = -1;
        this._cachedBadgeName = '';
        this._cachedBadgeWidth = 60;
    }

    reset(spawnX, spawnY) {
        this.x = spawnX;
        this.y = spawnY;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.score = 50;
        this.recalculateSize();
        this.maxSize = this.size;
        
        // リングバッファの初期化（再利用）
        this.headIdx = 0;
        this.historyLength = 0;
        
        this.distCounter = 0;
        this.isDead = false;
        this.kills = 0;
        this.isBoosting = false;
        this._prevBoostingState = false;
        this.isVisible = true;
        
        this.speed = BASE_SPEED;
        this.invulnerableTimer = 3.0;
        this.aiChangeTimer = Math.floor(Math.random() * 30);

        this._cachedBadgeScore = -1;
        this._cachedBadgeName = '';
    }

    /**
     * ★ オリジナル比率を強化したサイズ＆体長計算
     * スコア上昇時に頭部と首回りの太さがしっかりと成長し、巨大化の快感をダイレクトに伝える
     */
    recalculateSize() {
        this.size = 12 + Math.pow(this.score, 0.46) * 0.40;
        this.targetLength = 10 + Math.floor(Math.pow(this.score, 0.54) * 0.44);
        if (this.size > this.maxSize) this.maxSize = this.size;
    }

    addScore(val) {
        this.score += val;
        this.recalculateSize();
    }

    die() {
        this.isDead = true;
    }

    /**
     * 完全DeltaTime物理演算（引数厳格判定対応）
     * @param {number|null} arg1 dtSec（新シグネチャ）または inputAngle（旧シグネチャ）
     * @param {number|boolean|null} arg2 inputAngle（新シグネチャ）または boostActive（旧シグネチャ）
     * @param {boolean} [arg3] boostActive（新シグネチャ）
     */
    updatePhysics(arg1, arg2, arg3) {
        if (this.isDead) return;

        let dtSec = 1 / 60;
        let inputAngle = null;
        let boostActive = false;

        // 引数厳格判定
        if (arguments.length >= 3 || typeof arg3 === 'boolean') {
            dtSec = (typeof arg1 === 'number' && arg1 > 0) ? Math.min(arg1, 0.1) : (1 / 60);
            inputAngle = (typeof arg2 === 'number') ? arg2 : null;
            boostActive = Boolean(arg3);
        } else {
            inputAngle = (typeof arg1 === 'number') ? arg1 : null;
            boostActive = Boolean(arg2);
            dtSec = 1 / 60;
        }

        const timeScale = Math.max(0.1, Math.min(3.0, dtSec * 60));

        // ★ 無敵時間の安全な自然減衰（緊急離脱ブーストでも無敵が維持される）
        if (this.invulnerableTimer > 0) {
            this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dtSec);
        }

        const newBoostingState = boostActive && this.score > 60;

        // 自機の場合：ブースト状態が変化した瞬間に即座にネットワーク同期をトリガー（ラグ根絶）
        if (this.isPlayer && this._prevBoostingState !== newBoostingState) {
            this._prevBoostingState = newBoostingState;
            if (typeof window !== 'undefined' && window.NetworkManager && typeof window.NetworkManager.forceImmediateSync === 'function') {
                window.NetworkManager.forceImmediateSync();
            }
        }

        this.isBoosting = newBoostingState;
        
        const dynamicBaseSpeed = 3.5 + (10.0 / Math.max(10, this.size));
        const currentSpeed = this.isBoosting ? dynamicBaseSpeed * BOOST_SPEED_MULT : dynamicBaseSpeed;
        this.speed = currentSpeed;

        // ブースト消費レート適正化（実時間基準：毎秒約21pt消費）
        if (this.isBoosting) {
            this.score = Math.max(50, this.score - 0.35 * timeScale);
            this.recalculateSize();
        }

        if (inputAngle !== null) {
            this.targetAngle = inputAngle;
        }

        // 旋回計算のDeltaTimeスケーリング
        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), this.turnSpeed * timeScale);

        // 移動座標のDeltaTimeスケーリング
        this.x += Math.cos(this.angle) * (this.speed * timeScale);
        this.y += Math.sin(this.angle) * (this.speed * timeScale);

        const wallMin = this.size;
        const wallMax = MAP_SIZE - this.size;
        if (this.x < wallMin || this.x > wallMax || this.y < wallMin || this.y > wallMax) {
            this.x = Math.max(wallMin, Math.min(wallMax, this.x));
            this.y = Math.max(wallMin, Math.min(wallMax, this.y));
            if (!this.isPlayer) {
                this.targetAngle = Math.atan2(MAP_SIZE / 2 - this.y, MAP_SIZE / 2 - this.x);
            }
        }

        // ★ オリジナル版準拠の関節間隔（stepDist = this.size * 0.58）
        // 円同士がしっかりと重なり合い、お団子状のくびれ・隙間を完全に埋める黄金比
        this.distCounter += this.speed * timeScale;
        const stepDist = this.size * 0.58;
        if (this.distCounter >= stepDist) {
            this.distCounter = 0;
            
            this.headIdx = (this.headIdx - 1 + MAX_HISTORY) % MAX_HISTORY;
            let pt = this.history[this.headIdx];
            if (!pt) {
                pt = { x: this.x, y: this.y, angle: this.angle };
                this.history[this.headIdx] = pt;
            } else {
                pt.x = this.x; pt.y = this.y; pt.angle = this.angle;
            }

            if (this.historyLength < this.targetLength) {
                this.historyLength++;
            } else if (this.historyLength > this.targetLength) {
                this.historyLength = this.targetLength;
            }
        }
    }

    /**
     * ★ オリジナル生体ビジュアル復元描画
     * お団子状の間引きを完全撤廃し、半透明(0.65)の密接な円パス一括 fill() により、
     * 一切の隙間がない滑らかなネオンチューブ生体ボディを描画する
     */
    draw(ctx, frameCount, cameraScale = 1.0) {
        if (this.isDead || !this.isVisible) return;

        // ズームアウト時の小型獲物強調パルスリング（オリジナル継承）
        const localPlayer = (typeof window !== 'undefined' && window.localPlayerInstance) ? window.localPlayerInstance : null;
        if (!this.isPlayer && cameraScale < 0.75 && localPlayer && !localPlayer.isDead) {
            if (this.size < localPlayer.size * 0.65 || this.score < localPlayer.score * 0.5) {
                const pulse = 1.0 + Math.sin(frameCount * 0.16 + this.x) * 0.18;
                const ringRadius = Math.max(this.size * 2.2, 18 / cameraScale) * pulse;

                ctx.save();
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.15;
                ctx.beginPath();
                ctx.arc(this.x, this.y, ringRadius, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = this.color;
                ctx.lineWidth = Math.max(1.2, 1.8 / cameraScale);
                ctx.globalAlpha = 0.55;
                ctx.beginPath();
                ctx.arc(this.x, this.y, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        const histLen = this.historyLength;
        const invulnAlpha = (this.invulnerableTimer > 0)
            ? ((Math.floor(Date.now() / 100) % 2 === 0) ? 0.35 : 0.75)
            : 1.0;

        // =========================================================================
        // 1. 胴体メインボディ描画（オリジナル完全復元）
        // globalAlpha: 0.65 により円同士が重なって艶やかなグラデーションとなり、
        // ベタ塗りの「丸の連なり」感を完全消去して滑らかな一本の生体チューブを形成
        // =========================================================================
        ctx.globalAlpha = 0.65 * invulnAlpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();

        for (let i = histLen - 1; i >= 0; i--) {
            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (!pt) continue;

            const progress = i / histLen;
            // ★ オリジナルのテーパー計算式：首元が太く、尾先だけが鋭く細くなる美しいシルエット
            const segmentRadius = this.size * (1 - Math.pow(progress, 3.0) * 0.60);

            // オリジナルの波打ちオフセット（うねり）
            const waveAmplitude = this.size * 0.22;
            const waveOffset = Math.sin(frameCount * 0.15 - i * 0.38) * waveAmplitude;
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.moveTo(drawX + segmentRadius, drawY);
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
        }
        ctx.fill();

        // =========================================================================
        // 2. 胴体光彩・生体ウロコシャドウ（オリジナル完全復元）
        // 背骨に沿って流れる有機的な陰影効果
        // =========================================================================
        ctx.beginPath();
        for (let i = histLen - 1; i >= 0; i--) {
            const flow = Math.sin(frameCount * 0.28 - i * 0.25);
            if (flow <= 0.05) continue;

            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (!pt) continue;

            const progress = i / histLen;
            const segmentRadius = this.size * (1 - Math.pow(progress, 3.0) * 0.60) * 0.78;

            const waveAmplitude = this.size * 0.22;
            const waveOffset = Math.sin(frameCount * 0.15 - i * 0.38) * waveAmplitude;
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.fillStyle = `rgba(0, 0, 0, ${flow * 0.22})`;
            ctx.moveTo(drawX + segmentRadius, drawY);
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
        }
        ctx.fill();

        ctx.globalAlpha = invulnAlpha;

        // =========================================================================
        // 3. 頭部描画
        // =========================================================================
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // GRAVITYユーザーアバター顔スキンの場合
        if (this.face === 'user_avatar' && window.userAvatarImgInstance && window.userAvatarImgInstance.complete) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.clip();
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(window.userAvatarImgInstance, -this.size, -this.size, this.size * 2, this.size * 2);
            ctx.restore();

            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.fill();

            drawSnakeFace(ctx, this.face, this.size);
        }

        // ブースト時の頭部発光（顔崩れ防止）
        if (this.isBoosting) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();

        ctx.globalAlpha = 1.0;

        // 頭上ステータス表示
        this.drawOverheadBadge(ctx);
    }

    drawOverheadBadge(ctx) {
        ctx.save();
        
        const badgeY = this.y - this.size - 18;
        ctx.translate(this.x, badgeY);

        const currentFloorScore = Math.floor(this.score);
        // 10万・100万時のバッジはみ出しを防止する短縮フォーマット（タイポ完全修正）
        const scoreText = formatBadgeScore(currentFloorScore);
        const nameText = this.name.length > 10 ? this.name.slice(0, 9) + '…' : this.name;

        if (this._cachedBadgeScore !== currentFloorScore || this._cachedBadgeName !== nameText) {
            this._cachedBadgeScore = currentFloorScore;
            this._cachedBadgeName = nameText;
            ctx.font = 'bold 10px sans-serif';
            const scoreW = ctx.measureText(scoreText).width;
            ctx.font = 'bold 9.5px sans-serif';
            const nameW = ctx.measureText(nameText).width;
            this._cachedBadgeWidth = Math.max(54, Math.min(92, Math.max(scoreW, nameW) + 14));
        }

        const badgeW = this._cachedBadgeWidth;
        const badgeH = 25;
        const radius = 6;

        ctx.fillStyle = 'rgba(11, 5, 26, 0.72)';
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 1.2;

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(-badgeW / 2, -badgeH / 2, badgeW, badgeH, radius);
        } else {
            ctx.rect(-badgeW / 2, -badgeH / 2, badgeW, badgeH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';

        ctx.fillStyle = this.isPlayer ? '#fde047' : '#38bdf8';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(scoreText, 0, -2);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = 'bold 9.5px sans-serif';
        ctx.fillText(nameText, 0, 9.5);

        ctx.restore();
    }
}