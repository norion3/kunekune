// ==============================================================================
// 『くねくねバトル オンライン』カメラ制御＆ワールド描画マネージャー (camera.js)
// v28.7.0 オリジナル巨大化スケール感復元＆サイズ基準ダイナミックズーム版:
// ・【巨大化の快感・迫力完全復元】急激な対数ズームによる「頭の大きさが変わらない相殺現象」を完全解消。
// 　オリジナル版の秀逸なスネークサイズ基準スケールモデル (60.0 / (60.0 + (size - 12) * 0.82)) を統合
// 　成長するほど画面上でスネークが力強く太く巨大になっていく圧倒的なスケール感と手応えを復元
// ・【3段階マルチスケールグリッド完全維持】近景(100px)、中景(400px)、超遠景メガグリッド(2000px)の
// 　3層構造と動的アルファ透過により、広域でもモアレ（網目チラつき）を完全防止
// ・【完全DeltaTime観戦追従】観戦カメラのターゲット追従速度を実経過秒数(dtSec)に完全同期
// ・【手動ズーム連携】手動ズームボタン(0.20〜1.50)との滑らかな合成、下限0.08〜上限1.80安全クランプ
// ==============================================================================

import { MAP_SIZE } from './constants.js';

export class CameraManager {
    constructor() {
        this.spectatorCamX = MAP_SIZE / 2;
        this.spectatorCamY = MAP_SIZE / 2;
        this.scale = 1.0;
    }

    /**
     * スポーン時・リスポーン時のカメラ位置初期化
     * @param {number} x 
     * @param {number} y 
     */
    reset(x, y) {
        this.spectatorCamX = x;
        this.spectatorCamY = y;
        this.scale = 1.0;
    }

    /**
     * カメラ座標および視野スケールの更新（オリジナル巨大化スケールモデル＆DeltaTime対応）
     * @param {Object} player 自機スネークインスタンス
     * @param {Object} killerTargetSnake 撃破した相手スネークインスタンス
     * @param {number} zoomMultiplier 入力マネージャーのズーム倍率
     * @param {number} [dtSec=0.016] 実経過秒数
     */
    update(player, killerTargetSnake, zoomMultiplier, dtSec = 1 / 60) {
        const safeDt = (typeof dtSec === 'number' && dtSec > 0) ? Math.min(dtSec, 0.1) : (1 / 60);

        // 1. 座標の更新（生存時は自機位置、死亡時はキラーまたは死亡地点をスムーズ追従）
        if (player.isDead) {
            if (killerTargetSnake && !killerTargetSnake.isDead) {
                const followLerp = 1.0 - Math.exp(-5.0 * safeDt);
                this.spectatorCamX += (killerTargetSnake.x - this.spectatorCamX) * followLerp;
                this.spectatorCamY += (killerTargetSnake.y - this.spectatorCamY) * followLerp;
            }
        } else {
            this.spectatorCamX = player.x;
            this.spectatorCamY = player.y;
        }

        // =========================================================================
        // 2. ★ オリジナル版準拠のサイズ基準カメラスケールモデル（巨大化快感の復元）
        // 旧来の急激なスコア対数ズームを廃止し、スネークの頭部半径（size）の物理的成長に基づき算出。
        // カメラの引き具合を適度に緩やかに保つことで、成長するほど画面上で頭と胴体が実際に
        // 逞しく太く巨大になっていく「俺は巨大化した！」という圧倒的迫力を復元する。
        // =========================================================================
        const currentSize = player.isDead ? 14 : Math.max(14, player.size || 14);
        const baseTargetScale = 60.0 / (60.0 + (currentSize - 12) * 0.82);

        // 手動ズーム倍率との合成（下限0.08、上限1.80で安全クランプ）
        const finalTargetScale = Math.max(0.08, Math.min(1.80, baseTargetScale * (zoomMultiplier || 1.0)));

        // 指数ラープによる滑らかなズーム追従（急激なカクつきを完全排除）
        const scaleLerp = 1.0 - Math.exp(-3.2 * safeDt);
        this.scale += (finalTargetScale - this.scale) * scaleLerp;
    }

    /**
     * 現在有効なカメラの中心座標を取得
     * @param {Object} player 
     * @returns {{x: number, y: number}}
     */
    getCenter(player) {
        return {
            x: player.isDead ? this.spectatorCamX : player.x,
            y: player.isDead ? this.spectatorCamY : player.y
        };
    }

    /**
     * 2Dコンテキストへカメラスケールおよび平行移動を適用
     * @param {CanvasRenderingContext2D} ctx 
     * @param {HTMLCanvasElement} canvas 
     * @param {number} camX 
     * @param {number} camY 
     */
    begin(ctx, canvas, camX, camY) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(this.scale, this.scale);
        ctx.translate(-camX, -camY);
    }

    /**
     * カメラ座標系の復元
     * @param {CanvasRenderingContext2D} ctx 
     */
    end(ctx) {
        ctx.restore();
    }

    /**
     * 宇宙空間背景の3段階マルチスケールグリッド線および外壁赤枠の描画
     * シングル版の洗練されたスケール演出を完全統合
     * @param {CanvasRenderingContext2D} ctx 
     * @param {number} camLeft 
     * @param {number} camTop 
     * @param {number} viewW 
     * @param {number} viewH 
     */
    drawGrid(ctx, camLeft, camTop, viewW, viewH) {
        const fineGridStep = 100;    // 近景用（細線）
        const coarseGridStep = 400;  // 中景用（標準線）
        const megaGridStep = 2000;   // 巨大ズームアウト時用（メガグリッド）

        // スケールに応じたアルファ透過率の動的計算（モアレチラつき完全防止）
        const fineAlpha = Math.max(0, Math.min(0.06, (this.scale - 0.35) / 0.35 * 0.06));
        const coarseAlpha = this.scale < 0.5 ? Math.min(0.08, (0.5 - this.scale) / 0.25 * 0.06 + 0.02) : 0.02;
        const megaAlpha = this.scale < 0.25 ? Math.min(0.12, (0.25 - this.scale) / 0.15 * 0.10) : 0;

        const endX = camLeft + viewW + megaGridStep;
        const endY = camTop + viewH + megaGridStep;

        // 1. 細グリッド（近景・通常時のみ表示）
        if (fineAlpha > 0.005) {
            const startXFine = Math.floor(camLeft / fineGridStep) * fineGridStep;
            const startYFine = Math.floor(camTop / fineGridStep) * fineGridStep;

            ctx.strokeStyle = `rgba(255, 255, 255, ${fineAlpha})`;
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            for (let x = startXFine; x < endX; x += fineGridStep) {
                ctx.moveTo(x, startYFine); ctx.lineTo(x, endY);
            }
            for (let y = startYFine; y < endY; y += fineGridStep) {
                ctx.moveTo(startXFine, y); ctx.lineTo(endX, y);
            }
            ctx.stroke();
        }

        // 2. 中グリッド（標準〜やや引きの時に主線となる）
        if (coarseAlpha > 0.005) {
            const startXCoarse = Math.floor(camLeft / coarseGridStep) * coarseGridStep;
            const startYCoarse = Math.floor(camTop / coarseGridStep) * coarseGridStep;

            ctx.strokeStyle = `rgba(255, 255, 255, ${coarseAlpha})`;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            for (let x = startXCoarse; x < endX; x += coarseGridStep) {
                ctx.moveTo(x, startYCoarse); ctx.lineTo(x, endY);
            }
            for (let y = startYCoarse; y < endY; y += coarseGridStep) {
                ctx.moveTo(startXCoarse, y); ctx.lineTo(endX, y);
            }
            ctx.stroke();
        }

        // 3. メガグリッド（巨大化時・超広大視野時に宇宙の骨格として浮かび上がる）
        if (megaAlpha > 0.005) {
            const startXMega = Math.floor(camLeft / megaGridStep) * megaGridStep;
            const startYMega = Math.floor(camTop / megaGridStep) * megaGridStep;

            ctx.strokeStyle = `rgba(0, 229, 255, ${megaAlpha})`; // ネオンシアンのメガライン
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            for (let x = startXMega; x < endX; x += megaGridStep) {
                ctx.moveTo(x, startYMega); ctx.lineTo(x, endY);
            }
            for (let y = startYMega; y < endY; y += megaGridStep) {
                ctx.moveTo(startXMega, y); ctx.lineTo(endX, y);
            }
            ctx.stroke();
        }

        // 4. 外壁境界線
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
    }
}