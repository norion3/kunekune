// ==============================================================================
// 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
// v23.0.0 デザイン工学表情最適化＆上段スコア・下段名前カプセルHUD版:
// ・各表情（ノーマル・いかり・にこにこ・クール・キュート）ごとの骨格個別ミリ単位先端配置
// ・左右の索敵視野遮蔽を根絶する「上段スコア・下段名前」の超コンパクトカプセルHUD
// ・スネーク回転時も常に画面水平を維持するビルボード正立ステータス描画
// ・GRAVITYマイアイコン（user_avatar）選択時の高精細円形アバター＆ネオンリング合成
// ・体節描画の一括パス連結によるGPUドローコール最小化維持
// ==============================================================================

import { BASE_SPEED, BOOST_SPEED_MULT, TURN_SPEED_PLAYER, MAP_SIZE } from './constants.js';

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

        if (this.isBoosting) {
            this.score = Math.max(50, this.score - 0.09);
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

        // 胴体体節を一括パス連結で描画（ドローコール削減）
        ctx.fillStyle = this.color;
        ctx.beginPath();
        for (let i = histLen - 1; i >= 0; i--) {
            const idx = (this.headIdx + i) % MAX_HISTORY;
            const pt = this.history[idx];
            if (!pt) continue;

            const progress = i / histLen;
            const segmentRadius = this.size * (1 - Math.pow(progress, 2.5) * 0.5);

            const waveOffset = Math.sin(frameCount * 0.18 - i * 0.35) * (this.size * 0.2);
            const normAngle = (pt.angle || 0) + Math.PI / 2;
            const drawX = pt.x + Math.cos(normAngle) * waveOffset;
            const drawY = pt.y + Math.sin(normAngle) * waveOffset;

            ctx.moveTo(drawX + segmentRadius, drawY);
            ctx.arc(drawX, drawY, segmentRadius, 0, Math.PI * 2);
        }
        ctx.fill();

        // 胴体の光彩・ウロコシャドウ（フロー効果）を一括描画
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        for (let i = histLen - 1; i >= 0; i--) {
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

            // ★ 表情ごとの先端黄金比・最適配置描画
            this.drawFaceExpressions(ctx);
        }

        if (this.isBoosting) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        ctx.restore();

        ctx.globalAlpha = 1.0;

        // ★ 頭上ステータス表示：左右の死角を遮らない「上段スコア・下段名前」コンパクトカプセル
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

        const scoreText = `${Math.floor(this.score).toLocaleString()} pt`;
        const nameText = this.name.length > 10 ? this.name.slice(0, 9) + '…' : this.name;

        ctx.font = 'bold 10px sans-serif';
        const scoreMetrics = ctx.measureText(scoreText);
        ctx.font = 'bold 9.5px sans-serif';
        const nameMetrics = ctx.measureText(nameText);

        const textMaxW = Math.max(scoreMetrics.width, nameMetrics.width);
        const badgeW = Math.max(54, Math.min(84, textMaxW + 14));
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

    /**
     * デザイン工学に基づく表情ごとの個別最適配置描画ルーチン
     * 進行方向（+X: 前方、±Y: 左右）に正対して先端寄りへ確実に配置
     */
    drawFaceExpressions(ctx) {
        ctx.save();

        const s = this.size;

        switch (this.face) {
            case 'angry': {
                // いかり顔：先端から約25%の前方（+X）に配置、キリッとした鋭い眉と寄った黒目
                const eyeX = s * 0.38;
                const eyeY = s * 0.34;
                const eyeR = s * 0.30;
                const pupilR = eyeR * 0.48;

                // 白目
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2);
                ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
                ctx.fill();

                // 進行方向前寄りの黒目
                ctx.fillStyle = '#111827';
                ctx.beginPath();
                ctx.arc(eyeX + s * 0.08, -eyeY, pupilR, 0, Math.PI * 2);
                ctx.arc(eyeX + s * 0.08, eyeY, pupilR, 0, Math.PI * 2);
                ctx.fill();

                // キリッとした眉毛
                ctx.strokeStyle = '#111827';
                ctx.lineWidth = Math.max(1.8, s * 0.12);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(eyeX - eyeR * 0.6, -eyeY - eyeR * 0.9);
                ctx.lineTo(eyeX + eyeR * 0.8, -eyeY + eyeR * 0.2);
                ctx.moveTo(eyeX - eyeR * 0.6, eyeY + eyeR * 0.9);
                ctx.lineTo(eyeX + eyeR * 0.8, eyeY - eyeR * 0.2);
                ctx.stroke();
                break;
            }

            case 'happy': {
                // にこにこ顔：先端から約20%の前方へ押し出し、両頬エッジにピンクチーク
                const eyeX = s * 0.42;
                const eyeY = s * 0.34;
                const eyeR = s * 0.28;

                ctx.strokeStyle = '#111827';
                ctx.lineWidth = Math.max(2.2, s * 0.14);
                ctx.lineCap = 'round';

                // 左目・右目の笑顔アーチ（進行方向を向いた前向きアーチ）
                ctx.beginPath();
                ctx.arc(eyeX, -eyeY, eyeR, -Math.PI * 0.45, Math.PI * 0.45);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(eyeX, eyeY, eyeR, -Math.PI * 0.45, Math.PI * 0.45);
                ctx.stroke();

                // ほっぺのぷっくりピンクチーク（頭部左右エッジ）
                ctx.fillStyle = 'rgba(255, 99, 132, 0.85)';
                ctx.beginPath();
                ctx.arc(eyeX - s * 0.20, -eyeY * 1.35, s * 0.18, 0, Math.PI * 2);
                ctx.arc(eyeX - s * 0.20, eyeY * 1.35, s * 0.18, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'cool': {
                // クール：進行方向先端に角丸サングラス
                const glassW = s * 0.52;
                const glassH = s * 0.58;
                const glassX = s * 0.12;
                const glassY = s * 0.40;

                ctx.fillStyle = '#0f172a';
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(glassX, -glassY - glassH * 0.2, glassW, glassH, 3);
                    ctx.roundRect(glassX, glassY - glassH * 0.8, glassW, glassH, 3);
                    ctx.fill();
                } else {
                    ctx.fillRect(glassX, -glassY - glassH * 0.2, glassW, glassH);
                    ctx.fillRect(glassX, glassY - glassH * 0.8, glassW, glassH);
                }

                // シアンの連結ブリッジ
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = Math.max(1.5, s * 0.1);
                ctx.beginPath();
                ctx.moveTo(glassX + glassW * 0.5, -glassY + glassH * 0.5);
                ctx.lineTo(glassX + glassW * 0.5, glassY - glassH * 0.5);
                ctx.stroke();

                // レンズの光沢ライン
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(glassX + glassW * 0.2, -glassY + glassH * 0.2);
                ctx.lineTo(glassX + glassW * 0.8, -glassY + glassH * 0.2);
                ctx.moveTo(glassX + glassW * 0.2, glassY - glassH * 0.2);
                ctx.lineTo(glassX + glassW * 0.8, glassY - glassH * 0.2);
                ctx.stroke();
                break;
            }

            case 'cute': {
                // キュート：先端から約20%の前方に大きなうるうる丸目
                const eyeX = s * 0.38;
                const eyeY = s * 0.36;
                const eyeR = s * 0.34;
                const pupilR = eyeR * 0.56;

                // 大きなパッチリ白目
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2);
                ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
                ctx.fill();

                // 進行方向寄りの瞳孔
                ctx.fillStyle = '#0f172a';
                ctx.beginPath();
                ctx.arc(eyeX + s * 0.08, -eyeY, pupilR, 0, Math.PI * 2);
                ctx.arc(eyeX + s * 0.08, eyeY, pupilR, 0, Math.PI * 2);
                ctx.fill();

                // うるうるダブルハイライト（大：進行方向前寄り）
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(eyeX + s * 0.12, -eyeY - pupilR * 0.3, pupilR * 0.45, 0, Math.PI * 2);
                ctx.arc(eyeX + s * 0.12, eyeY - pupilR * 0.3, pupilR * 0.45, 0, Math.PI * 2);
                ctx.fill();

                // うるうるダブルハイライト（小）
                ctx.beginPath();
                ctx.arc(eyeX + s * 0.02, -eyeY + pupilR * 0.4, pupilR * 0.25, 0, Math.PI * 2);
                ctx.arc(eyeX + s * 0.02, eyeY + pupilR * 0.4, pupilR * 0.25, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'normal':
            default: {
                // ノーマル：先端から約20%の前方に配置（黒目を進行方向前へ寄せて生き生きとした視線）
                const eyeX = s * 0.38;
                const eyeY = s * 0.34;
                const eyeR = s * 0.32;
                const pupilR = eyeR * 0.46;

                // 丸い白目
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2);
                ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
                ctx.fill();

                // 前方をしっかり見つめる黒目
                ctx.fillStyle = '#111827';
                ctx.beginPath();
                ctx.arc(eyeX + s * 0.09, -eyeY, pupilR, 0, Math.PI * 2);
                ctx.arc(eyeX + s * 0.09, eyeY, pupilR, 0, Math.PI * 2);
                ctx.fill();

                // 前方からの光彩ハイライト
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.beginPath();
                ctx.arc(eyeX + s * 0.13, -eyeY - pupilR * 0.3, pupilR * 0.35, 0, Math.PI * 2);
                ctx.arc(eyeX + s * 0.13, eyeY - pupilR * 0.3, pupilR * 0.35, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
        }

        ctx.restore();
    }
}