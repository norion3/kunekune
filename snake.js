// ==============================================================================
// 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
// v20.3.0 パス連結・描画負荷劇的軽減版:
// ・胴体体節の個別 beginPath/fill を単一パス走査へ連結し、GPUドローコールを半減
// ・リングバッファ O(1) 配列アクセスによるゼロアロケーション維持
// ・表情描画・無敵点滅・減衰物理モデル完全継承
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

        // 💡 描画負荷激減：胴体体節を一括パス連結で描画（ドローコールを1回に削減）
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
            ctx.drawImage(window.userAvatarImgInstance, -this.size, -this.size, this.size * 2, this.size * 2);
            ctx.restore();
        } else {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.fill();

            this.drawFaceExpressions(ctx);
        }

        if (this.isBoosting) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        ctx.restore();

        ctx.globalAlpha = 1.0;

        // ネームタグ
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - this.size - 6);
    }

    /**
     * メニューの可愛いSVGプレビューアイコンと完全一致させた表情描画
     */
    drawFaceExpressions(ctx) {
        const s = this.size;

        switch (this.face) {
            case 'angry': {
                // 1. いかり顔：丸い白目 ＋ 鋭い黒眉 ＋ 寄った黒目
                const eyeR = s * 0.32;
                const eyeX = s * 0.28;
                const eyeY = s * 0.40;
                const pupilR = eyeR * 0.48;

                // 白目
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();

                // 黒目
                ctx.fillStyle = '#111827';
                ctx.beginPath(); ctx.arc(eyeX + 1.5, -eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX + 1.5, eyeY, pupilR, 0, Math.PI * 2); ctx.fill();

                // キリッとした眉毛
                ctx.strokeStyle = '#111827';
                ctx.lineWidth = Math.max(1.8, s * 0.12);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(eyeX - eyeR * 0.8, -eyeY - eyeR * 0.7);
                ctx.lineTo(eyeX + eyeR * 0.8, -eyeY + eyeR * 0.3);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(eyeX - eyeR * 0.8, eyeY + eyeR * 0.7);
                ctx.lineTo(eyeX + eyeR * 0.8, eyeY - eyeR * 0.3);
                ctx.stroke();
                break;
            }

            case 'happy': {
                // 2. にこにこ顔：アーチ型の笑顔の目 ＋ ぷっくりピンクチーク
                const eyeR = s * 0.34;
                const eyeX = s * 0.28;
                const eyeY = s * 0.40;

                ctx.strokeStyle = '#111827';
                ctx.lineWidth = Math.max(2.2, s * 0.14);
                ctx.lineCap = 'round';

                // アーチ目（上向きカーブ）
                ctx.beginPath();
                ctx.arc(eyeX, -eyeY, eyeR, -Math.PI * 0.8, -Math.PI * 0.2);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(eyeX, eyeY, eyeR, Math.PI * 0.2, Math.PI * 0.8);
                ctx.stroke();

                // ほっぺのチーク
                ctx.fillStyle = 'rgba(255, 99, 132, 0.8)';
                ctx.beginPath();
                ctx.arc(eyeX - s * 0.15, -eyeY * 1.15, s * 0.18, 0, Math.PI * 2);
                ctx.arc(eyeX - s * 0.15, eyeY * 1.15, s * 0.18, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'cool': {
                // 3. クール：角丸スクエアのサングラス ＋ 青いブリッジ ＋ ハイライト
                const glassW = s * 0.65;
                const glassH = s * 0.52;
                const glassX = s * 0.05;
                const glassY = s * 0.42;

                ctx.fillStyle = '#0f172a';
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(glassX, -glassY - glassH / 2, glassW, glassH, 3);
                    ctx.roundRect(glassX, glassY - glassH / 2, glassW, glassH, 3);
                    ctx.fill();
                } else {
                    ctx.fillRect(glassX, -glassY - glassH / 2, glassW, glassH);
                    ctx.fillRect(glassX, glassY - glassH / 2, glassW, glassH);
                }

                // フレームの連結ブリッジ
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = Math.max(1.5, s * 0.1);
                ctx.beginPath();
                ctx.moveTo(glassX + glassW * 0.6, -glassY + glassH * 0.4);
                ctx.lineTo(glassX + glassW * 0.6, glassY - glassH * 0.4);
                ctx.stroke();

                // レンズのツヤ（斜めの白い光彩）
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(glassX + glassW * 0.2, -glassY);
                ctx.lineTo(glassX + glassW * 0.7, -glassY);
                ctx.moveTo(glassX + glassW * 0.2, glassY);
                ctx.lineTo(glassX + glassW * 0.7, glassY);
                ctx.stroke();
                break;
            }

            case 'cute': {
                // 4. キュート：大きなうるうる白目 ＋ ダブル光彩ハイライト
                const eyeR = s * 0.36;
                const eyeX = s * 0.28;
                const eyeY = s * 0.40;
                const pupilR = eyeR * 0.58;

                // 大きな白目
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();

                // 黒目
                ctx.fillStyle = '#0f172a';
                ctx.beginPath(); ctx.arc(eyeX + 1.2, -eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX + 1.2, eyeY, pupilR, 0, Math.PI * 2); ctx.fill();

                // 主ハイライト（大）
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(eyeX + eyeR * 0.25, -eyeY - eyeR * 0.25, pupilR * 0.42, 0, Math.PI * 2);
                ctx.arc(eyeX + eyeR * 0.25, eyeY - eyeR * 0.25, pupilR * 0.42, 0, Math.PI * 2);
                ctx.fill();

                // 副ハイライト（小）
                ctx.beginPath();
                ctx.arc(eyeX - eyeR * 0.15, -eyeY + eyeR * 0.25, pupilR * 0.22, 0, Math.PI * 2);
                ctx.arc(eyeX - eyeR * 0.15, eyeY + eyeR * 0.25, pupilR * 0.22, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'normal':
            default: {
                // 5. ノーマル：くりくりのパッチリ丸目 ＋ ちいさな瞳孔
                const eyeR = s * 0.35;
                const eyeX = s * 0.28;
                const eyeY = s * 0.38;
                const pupilR = eyeR * 0.46;

                // 白目
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();

                // 黒目
                ctx.fillStyle = '#111827';
                ctx.beginPath(); ctx.arc(eyeX + 2, -eyeY, pupilR, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(eyeX + 2, eyeY, pupilR, 0, Math.PI * 2); ctx.fill();

                // 小さなハイライト
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.beginPath();
                ctx.arc(eyeX + 3, -eyeY - 1.5, pupilR * 0.3, 0, Math.PI * 2);
                ctx.arc(eyeX + 3, eyeY - 1.5, pupilR * 0.3, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
        }
    }
}