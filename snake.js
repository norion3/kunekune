// ==============================================================================
// 『くねくねバトル オンライン』スネークエンティティクラス (snake.js)
// v24.3.0 メニューSVG完全同一化＆パッチリ表情スケール最適化版:
// ・メニュー（CUSTOMタブ）の可愛いSVGアイコン比率を約1.5倍（scale: 2.30/40）に拡大
// ・頭部円の横幅いっぱいに大きく広がる、パッチリと愛らしい表情描画を完全実現
// ・進行方向先端（+X）への正対配置により、スネークが前をしっかり見つめる生き生きとした視線を確保
// ・左右の索敵視野遮蔽を根絶する「上段スコア・下段名前」の超コンパクトカプセルHUD維持
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

            // ★ メニューSVGと100%同一ベクター描画（スケール拡大＆パッチリ可愛らしく最適化）
            this.drawFaceExpressions(ctx);
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
     * ★ メニュー（CUSTOMタブ）のSVG ViewBox (0 0 40 40) と100%同一のパス・座標・スタイルで描画
     * スケールを従来の約1.5倍（scale: 2.30/40）に拡大し、頭部いっぱいにパッチリと可愛い表情を配置
     */
    drawFaceExpressions(ctx) {
        ctx.save();

        // 1. スネーク進行方向（+X）の先端寄り（+size * 0.22）へ基準点を移動
        ctx.translate(this.size * 0.22, 0);

        // 2. メニューSVGの上（-Y）をスネーク進行方向（+X）へ正対させるため90度時計回り回転
        ctx.rotate(Math.PI / 2);

        // 3. メニューSVGのViewBox (40x40) を頭部円いっぱいに広がるパッチリ比率（約1.5倍）へスケーリング
        const scale = (this.size * 2.30) / 40;
        ctx.scale(scale, scale);

        // 4. SVGの中心 (20, 20) を原点へ合わせる
        ctx.translate(-20, -20);

        // ★ メニュー（dom.js）のSVGタグに定義されているパス・座標・ストロークと1ピクセルも違わず完全一致
        switch (this.face) {
            case 'angry': {
                // メニューSVG：いかり
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(14, 21, 5.5, 0, Math.PI * 2);
                ctx.arc(26, 21, 5.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#111827';
                ctx.beginPath();
                ctx.arc(15.5, 21, 2.6, 0, Math.PI * 2);
                ctx.arc(27.5, 21, 2.6, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#111827';
                ctx.lineWidth = 2.2;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(9, 13);
                ctx.lineTo(19, 18);
                ctx.moveTo(31, 13);
                ctx.lineTo(21, 18);
                ctx.stroke();
                break;
            }

            case 'happy': {
                // メニューSVG：にこにこ
                ctx.strokeStyle = '#111827';
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';

                // 左目笑顔アーチ
                ctx.beginPath();
                ctx.arc(14, 22, 4, Math.PI, 0);
                ctx.stroke();

                // 右目笑顔アーチ
                ctx.beginPath();
                ctx.arc(26, 22, 4, Math.PI, 0);
                ctx.stroke();

                // ピンクチーク
                ctx.fillStyle = 'rgba(255, 99, 132, 0.75)';
                ctx.beginPath();
                ctx.arc(9, 26, 3.2, 0, Math.PI * 2);
                ctx.arc(31, 26, 3.2, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'cool': {
                // メニューSVG：クール
                ctx.fillStyle = '#0f172a';
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(8, 15, 10, 9, 2);
                    ctx.roundRect(22, 15, 10, 9, 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(8, 15, 10, 9);
                    ctx.fillRect(22, 15, 10, 9);
                }

                // シアンの連結ブリッジ
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 2.0;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(18, 18);
                ctx.lineTo(22, 18);
                ctx.stroke();

                // レンズの光沢ライン
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(10, 17);
                ctx.lineTo(16, 17);
                ctx.moveTo(24, 17);
                ctx.lineTo(30, 17);
                ctx.stroke();
                break;
            }

            case 'cute': {
                // メニューSVG：キュート
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(14, 20, 6.5, 0, Math.PI * 2);
                ctx.arc(26, 20, 6.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#0f172a';
                ctx.beginPath();
                ctx.arc(15, 20, 3.5, 0, Math.PI * 2);
                ctx.arc(27, 20, 3.5, 0, Math.PI * 2);
                ctx.fill();

                // うるうるハイライト
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(16.5, 18.5, 1.3, 0, Math.PI * 2);
                ctx.arc(28.5, 18.5, 1.3, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'normal':
            default: {
                // メニューSVG：ノーマル
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(15, 20, 6, 0, Math.PI * 2);
                ctx.arc(25, 20, 6, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#111827';
                ctx.beginPath();
                ctx.arc(16.5, 20, 2.8, 0, Math.PI * 2);
                ctx.arc(26.5, 20, 2.8, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
        }

        ctx.restore();
    }
}