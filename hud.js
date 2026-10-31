/**
 * ==============================================================================
 * 『くねくねバトル オンライン』一体型HUD ＆ 自機中心相対追従レーダー (hud.js)
 * v20.5.0 ゼロアロケーション索敵最適化版:
 * ・レーダーサイズ 140px 大型表示（索敵視認性向上）
 * ・topEnemies 抽出処理のゼロアロケーション化（毎30FPSの filter/sort 配列破棄を根絶）
 * ・2フレームに1回（30FPS）描画スロットリング ＆ Offscreen キャッシュ
 * ==============================================================================
 */

export class HUDManager {
    constructor() {
        this.showMap = true;
        this.showRanking = false;
        this.radarSize = 140; // 索敵用大型レーダーサイズ
        this.radarMargin = 14;
        
        // 描画負荷軽減: レーダー描画をキャッシュし、2フレームに1回の更新（30FPS）へスロットリングするための内部キャンバス
        this.radarCanvas = document.createElement('canvas');
        this.radarCanvas.width = this.radarSize;
        this.radarCanvas.height = this.radarSize;
        this.radarCtx = this.radarCanvas.getContext('2d', { alpha: true });
        this.radarFrameCount = 0;

        // ゼロアロケーション用トップエネミー固定参照バッファ（最大5体）
        this.topEnemiesPool = new Array(5).fill(null);
        this.topEnemyCount = 0;
    }

    init() {
        // stats-box（ランキング詳細）の初期非表示
        const statsBox = document.getElementById('stats-box');
        if (statsBox) {
            statsBox.style.display = this.showRanking ? 'block' : 'none';
        }
    }

    // ランキング表示のON/OFF切り替え
    toggleRanking() {
        this.showRanking = !this.showRanking;
        const statsBox = document.getElementById('stats-box');
        const btnRankToggle = document.getElementById('btn-toggle-ranking');

        if (statsBox) {
            statsBox.style.display = this.showRanking ? 'block' : 'none';
        }
        if (btnRankToggle) {
            btnRankToggle.classList.toggle('active', this.showRanking);
        }
        return this.showRanking;
    }

    // レーダー（ミニマップ）表示のON/OFF切り替え
    toggleMap() {
        this.showMap = !this.showMap;
        const btnMapToggle = document.getElementById('btn-toggle-map');

        if (btnMapToggle) {
            btnMapToggle.classList.toggle('active', this.showMap);
        }
        return this.showMap;
    }

    // スコアと順位のDOM更新
    updateStats(rank, total, score) {
        const valRank = document.getElementById('val-rank');
        const valTotal = document.getElementById('val-total');
        const valScore = document.getElementById('val-score');
        if (valRank) valRank.innerText = rank;
        if (valTotal) valTotal.innerText = total;
        if (valScore) valScore.innerText = Math.floor(score);
    }

    /**
     * 自機中心の相対追従レーダーをメインCanvasに直接描画
     * 描画スロットリング ＆ ゼロアロケーション版
     */
    drawRadar(ctx, canvasWidth, safeTop, player, otherEntities, cameraScale) {
        if (!this.showMap || !player) return;

        const rx = canvasWidth - this.radarSize - this.radarMargin;
        const ry = safeTop;

        // スロットリング: 2フレームに1回（30FPS）だけ内部キャンバスを更新
        if (this.radarFrameCount % 2 === 0) {
            const rCtx = this.radarCtx;
            const radarCenter = this.radarSize / 2;

            // 背景クリア & レーダー背景描画
            rCtx.clearRect(0, 0, this.radarSize, this.radarSize);
            rCtx.fillStyle = 'rgba(11, 5, 26, 0.72)';
            rCtx.fillRect(0, 0, this.radarSize, this.radarSize);

            const viewW = ctx.canvas.width / cameraScale;
            const viewH = ctx.canvas.height / cameraScale;
            const radarRange = Math.max(viewW, viewH) * 4.0;
            const radarRatio = this.radarSize / radarRange;

            const cx = player.x;
            const cy = player.y;

            // 💡 ゼロアロケーション：filter/sort/slice を完全撤廃し、固定長プールへ上位5体を直接収集
            this.topEnemyCount = 0;
            const targetMinScore = player.score * 1.2;

            if (otherEntities && otherEntities.length > 0) {
                const len = otherEntities.length;
                for (let i = 0; i < len; i++) {
                    const s = otherEntities[i];
                    if (s === player || s.isDead || s.isPlayer || s.score <= targetMinScore) continue;

                    // 挿入ソート形式で上位5体に格納
                    if (this.topEnemyCount < 5) {
                        this.topEnemiesPool[this.topEnemyCount++] = s;
                    } else {
                        // 最小スコアの位置を探索して置換
                        let minIdx = 0;
                        let minScore = this.topEnemiesPool[0].score;
                        for (let k = 1; k < 5; k++) {
                            if (this.topEnemiesPool[k].score < minScore) {
                                minScore = this.topEnemiesPool[k].score;
                                minIdx = k;
                            }
                        }
                        if (s.score > minScore) {
                            this.topEnemiesPool[minIdx] = s;
                        }
                    }
                }
            }

            // 敵スネークの描画
            if (otherEntities && otherEntities.length > 0) {
                const totalEntities = otherEntities.length;
                for (let i = 0; i < totalEntities; i++) {
                    const s = otherEntities[i];
                    if (s === player || s.isDead) continue;

                    let isTopEnemy = false;
                    for (let k = 0; k < this.topEnemyCount; k++) {
                        if (this.topEnemiesPool[k] === s) {
                            isTopEnemy = true;
                            break;
                        }
                    }

                    // 視野外の敵は描画しないが、トップエネミーの場合は遠隔表示する
                    if (!s.isVisible && !isTopEnemy) continue;

                    const drawX = radarCenter + (s.x - cx) * radarRatio;
                    const drawY = radarCenter + (s.y - cy) * radarRatio;

                    // 座標判定による高速クリッピング
                    if (drawX < 0 || drawX > this.radarSize || drawY < 0 || drawY > this.radarSize) {
                        continue;
                    }

                    const isBigger = s.score > player.score;
                    rCtx.fillStyle = isBigger ? '#ff3366' : '#33ccff';
                    const dotRadius = (isTopEnemy && !s.isVisible) ? 1.8 : (isBigger ? 2.8 : 2.0);

                    rCtx.beginPath();
                    rCtx.arc(drawX, drawY, dotRadius, 0, Math.PI * 2);
                    rCtx.fill();
                }
            }

            // 自機の画面カメラ視野枠（白の矩形ライン）を描画
            const camRectW = viewW * radarRatio;
            const camRectH = viewH * radarRatio;
            rCtx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            rCtx.lineWidth = 1.0;
            rCtx.strokeRect(radarCenter - camRectW / 2, radarCenter - camRectH / 2, camRectW, camRectH);

            // 自機位置（中心に白ドット ＋ シアンパルス）
            rCtx.fillStyle = '#ffffff';
            rCtx.beginPath();
            rCtx.arc(radarCenter, radarCenter, 3.2, 0, Math.PI * 2);
            rCtx.fill();

            rCtx.strokeStyle = '#00e5ff';
            rCtx.lineWidth = 1.2;
            rCtx.beginPath();
            rCtx.arc(radarCenter, radarCenter, 5.0, 0, Math.PI * 2);
            rCtx.stroke();

            // レーダー外枠
            rCtx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
            rCtx.lineWidth = 1.5;
            rCtx.strokeRect(0, 0, this.radarSize, this.radarSize);
        }

        this.radarFrameCount++;

        // メインCanvasにはキャッシュされた画像を転送（負荷極小）
        ctx.drawImage(this.radarCanvas, rx, ry);
    }
}