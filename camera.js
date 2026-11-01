// ==============================================================================
// 『くねくねバトル オンライン』カメラ制御＆ワールド描画マネージャー (camera.js)
// v25.1.0 カメラ補間・スケール・背景グリッド描画専任版:
// ・生存時の自機追従 ＆ 死亡時のキラー/死亡地点スムーズ観戦カメラ補間
// ・スネーク成長サイズ ＆ ズーム倍率に応じた視野スケーリング（ラープ補間）
// ・背景クリア、カメラトランスフォーム（begin / end）、200px境界グリッド線描画
// ・main.js からカメラ描画責務を完全分離し、コードの見通しを大幅改善
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
    }

    /**
     * カメラ座標および視野スケールの更新
     * @param {Object} player 自機スネークインスタンス
     * @param {Object} killerTargetSnake 撃破した相手スネークインスタンス
     * @param {number} zoomMultiplier 入力マネージャーのズーム倍率
     */
    update(player, killerTargetSnake, zoomMultiplier) {
        // 1. 座標の更新（生存時は自機位置、死亡時はキラーまたは死亡地点をスムーズ追従）
        if (player.isDead) {
            if (killerTargetSnake && !killerTargetSnake.isDead) {
                this.spectatorCamX += (killerTargetSnake.x - this.spectatorCamX) * 0.08;
                this.spectatorCamY += (killerTargetSnake.y - this.spectatorCamY) * 0.08;
            }
        } else {
            this.spectatorCamX = player.x;
            this.spectatorCamY = player.y;
        }

        // 2. 視野スケーリング補間
        const effectiveSize = player.isDead ? 16 : player.size;
        const baseTargetScale = 60.0 / (60.0 + (effectiveSize - 12) * 0.85);
        const finalTargetScale = baseTargetScale * zoomMultiplier;
        this.scale += (finalTargetScale - this.scale) * 0.05;
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
     * 宇宙空間背景の格子線（200px間隔）および外壁赤枠の描画
     * @param {CanvasRenderingContext2D} ctx 
     * @param {number} camLeft 
     * @param {number} camTop 
     * @param {number} viewW 
     * @param {number} viewH 
     */
    drawGrid(ctx, camLeft, camTop, viewW, viewH) {
        const step = 200;
        const startX = Math.floor(camLeft / step) * step;
        const endX = startX + viewW + step * 2;
        const startY = Math.floor(camTop / step) * step;
        const endY = startY + viewH + step * 2;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let x = startX; x < endX; x += step) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y < endY; y += step) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();

        // 外壁境界線
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
    }
}