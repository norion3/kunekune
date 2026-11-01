// ==============================================================================
// 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
// v25.1.0 表情描画外部モジュール化＆スリム物理専任版:
// ・表情ベクター描画を snake_face.js へ完全委譲し、ファイルサイズを約40%削減
// ・体節描画ステップ間引き（長大スネーク時のドローコール半減・iOS 60FPS死守）
// ・頭上バッジの ctx.measureText() キャッシュ化（毎フレームの不要文字列レイアウト計算根絶）
// ・ブースト消費レート適正化（-0.09 -> -0.35：身を削る戦術的駆け引きの復活）
// ・左右の索敵視野遮蔽を根絶する「上段スコア・下段名前」の超コンパクトカプセルHUD維持
// ・GRAVITYマイアイコン（user_avatar）選択時の高精細円形アバター＆ネオンリング合成
// ・O(1) リングバッファ ＆ ゼロアロケーション体節追従
// ==============================================================================

import { BASE_SPEED, BOOST_SPEED_MULT, TURN_SPEED_PLAYER, MAP_SIZE } from './constants.js';
import { drawSnakeFace } from './snake_face.js';

const MAX_HISTORY = 2048; // リングバッファ最大長

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
        this.isVisible = true;
        
        this.speed = BASE_SPEED;
        this.invulnerableTimer = 3.0;
        this.aiChangeTimer = Math.floor(Math.random() * 30);

        this._cachedBadgeScore = -1;
        this._cachedBadgeName = '';
    }

    recalculateSize() {
        this.size = 12 + Math.pow(this.score, 0.45) * 0.35;
        this.targetLength = 10 + Math.floor(Math.pow(this.score, 0.55) * 0.4);
        if (this.size > this.maxSize) this.maxSize = this.size;
    }

    addScore(val) {
        this.score += val;
        this.recalculateSize();
    }

    die() {
        this.isDead = true;
    }

    updatePhysics(inputAngle, boostActive) {
        if (this.isDead) return;

        if (this.invulnerableTimer > 0) {
            this.invulnerableTimer -= 1 / 60;
        }

        this.isBoosting = boostActive && this.score > 60;
        
        const dynamicBaseSpeed = 3.5 + (10.0 / Math.max(10, this.size));
        const currentSpeed = this.isBoosting ? dynamicBaseSpeed * BOOST_SPEED_MULT : dynamicBaseSpeed;
        this.speed = currentSpeed;

        // ★ ブースト消費レート適正化（毎秒約21pt消費：無制限ブーストを防止し戦術的駆け引きを創出）
        if (this.isBoosting) {
            this.score = Math.max(50, this.score - 0.35);
            this.recalculateSize();
        }

        if (inputAngle !== null) {
            this.targetAngle = inputAngle;
        }

        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), this.turnSpeed);

        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        const wallMin = this.size;
        const wallMax = MAP_SIZE - this.size;
        if (this.x < wallMin || this.x > wallMax || this.y < wallMin || this.y > wallMax) {
            this.x = Math.max(wallMin, Math.min(wallMax, this.x));
            this.y = Math.max(wallMin, Math.min(wallMax, this.y));
            if (!this.isPlayer) {
                this.targetAngle = Math.atan2(MAP_SIZE / 2 - this.y, MAP_SIZE / 2 - this.x);
            }
        }

        // O(1) リングバッファへの座標格納（GC負荷ゼロ）
        this.distCounter += this.speed;
        const stepDist = this.size * 0.55;
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

    draw(ctx, frameCount, cameraScale) {
        if (this.isDead || !this.isVisible) return;

        if (this.invulnerableTimer > 0) {
            ctx.globalAlpha = (Math.floor(Date.now() / 100) % 2 === 0) ? 0.4 : 0.8;
        } else {
            ctx.globalAlpha = 1.0;
        }

        const histLen = this.historyLength;
        // ★ 描画ステップ間引き：体節数が長大な場合、ステップを2に間引いてGPUドローコールを半減
        const step = (histLen > 30) ? 2 : 1;

        // 胴体体節を一括パス連結で描画（ドローコール削減）
        ctx.fillStyle = this.color;
        ctx.beginPath();
        for (let i = histLen - 1; i >= 0; i -= step) {
            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (!pt) continue;

            const progress = i / histLen;
            const segmentRadius = this.size * (1 - Math.pow(progress, 2.5) * 0.5) * (step > 1 ? 1.06 : 1.0);

            const waveOffset = Math.sin(frameCount * 0.18 - i * 0.35) * (this.size * 0.2);
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.moveTo(drawX + segmentRadius, drawY);
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
        }
        ctx.fill();

        // 胴体の光彩・ウロコシャドウ（フロー効果）を一括描画（間引き適用）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        for (let i = histLen - 1; i >= 0; i -= (step * 2)) {
            const flow = Math.sin(frameCount * 0.25 - i * 0.3);
            if (flow <= 0.4) continue;

            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (!pt) continue;

            const progress = i / histLen;
            const segmentRadius = this.size * (1 - Math.pow(progress, 2.5) * 0.5) * 0.7;

            const waveOffset = Math.sin(frameCount * 0.18 - i * 0.35) * (this.size * 0.2);
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.moveTo(drawX + segmentRadius, drawY);
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
        }
        ctx.fill();

        // 頭部描画
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // ★ GRAVITYユーザーアバター顔スキンの場合：円形マスクでポートレート写真を描画
        if (this.face === 'user_avatar' && window.userAvatarImgInstance && window.userAvatarImgInstance.complete) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.clip();
            // 頭部の進行方向に合わせて自然な向きで描画
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(window.userAvatarImgInstance, -this.size, -this.size, this.size * 2, this.size * 2);
            ctx.restore();

            // 胴体との一体感を保つ微小ネオンリング
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            // スネーク頭部ベース円（胴体とシームレスに繋がる地色）
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.fill();

            // ★ 外部モジュール (snake_face.js) へ完全委譲：パッチリ可愛い表情を描画
            drawSnakeFace(ctx, this.face, this.size);
        }

        if (this.isBoosting) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        ctx.restore();

        ctx.globalAlpha = 1.0;

        // 頭上ステータス表示：左右の死角を遮らない「上段スコア・下段名前」コンパクトカプセル
        this.drawOverheadBadge(ctx);
    }

    /**
     * 頭上ステータスカプセル描画（ビルボード方式：回転せず常に正立）
     */
    drawOverheadBadge(ctx) {
        ctx.save();
        
        // 頭部中心から上方向へ頭部サイズ＋余白分オフセット
        const badgeY = this.y - this.size - 18;
        ctx.translate(this.x, badgeY);

        const currentFloorScore = Math.floor(this.score);
        const scoreText = `${currentFloorScore.toLocaleString()} pt`;
        const nameText = this.name.length > 10 ? this.name.slice(0, 9) + '…' : this.name;

        // ★ テキスト計測キャッシュ（スコアまたは名前が変わった時のみ measureText を実行）
        if (this._cachedBadgeScore !== currentFloorScore || this._cachedBadgeName !== nameText) {
            this._cachedBadgeScore = currentFloorScore;
            this._cachedBadgeName = nameText;
            ctx.font = 'bold 10px sans-serif';
            const scoreW = ctx.measureText(scoreText).width;
            ctx.font = 'bold 9.5px sans-serif';
            const nameW = ctx.measureText(nameText).width;
            this._cachedBadgeWidth = Math.max(54, Math.min(84, Math.max(scoreW, nameW) + 14));
        }

        const badgeW = this._cachedBadgeWidth;
        const badgeH = 25;
        const radius = 6;

        // カプセル背景（極薄透過フロスト調・背後の敵を遮らない）
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

        // 上段：スコア（視認性最優先・シアン/ゴールド）
        ctx.fillStyle = this.isPlayer ? '#fde047' : '#38bdf8';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(scoreText, 0, -2);

        // 下段：名前（クッキリ白）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = 'bold 9.5px sans-serif';
        ctx.fillText(nameText, 0, 9.5);

        ctx.restore();
    }
}