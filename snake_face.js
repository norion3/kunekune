// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v25.1.0 表情描画完全分離＆軽量化版:
// ・メニュー（CUSTOMタブ）のSVG ViewBox (0 0 40 40) と100%同一のパス・座標・スタイルを完全維持
// ・スケール比率（scale: 2.30/40）と頭部進行方向（+X）への正対配置を完全維持
// ・ステートレスな純粋描画関数として snake.js から独立し、コード保守性を飛躍的に向上
// ==============================================================================

/**
 * スネーク頭部ベース円の上にパッチリ愛らしい表情パーツを描画
 * @param {CanvasRenderingContext2D} ctx 描画対象の2Dコンテキスト（頭部ローカル座標系）
 * @param {string} face 表情タイプ ('normal' | 'angry' | 'happy' | 'cool' | 'cute')
 * @param {number} size スネークの頭部半径
 */
export function drawSnakeFace(ctx, face, size) {
    ctx.save();

    // 1. スネーク進行方向（+X）の先端寄り（+size * 0.22）へ基準点を移動
    ctx.translate(size * 0.22, 0);

    // 2. メニューSVGの上（-Y）をスネーク進行方向（+X）へ正対させるため90度時計回り回転
    ctx.rotate(Math.PI / 2);

    // 3. メニューSVGのViewBox (40x40) を頭部円いっぱいに広がるパッチリ比率（約1.5倍）へスケーリング
    const scale = (size * 2.30) / 40;
    ctx.scale(scale, scale);

    // 4. SVGの中心 (20, 20) を原点へ合わせる
    ctx.translate(-20, -20);

    // ★ メニュー（dom.js）のSVGタグに定義されているパス・座標・ストロークと1ピクセルも違わず完全一致
    switch (face) {
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