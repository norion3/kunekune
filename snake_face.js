// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v28.9.0 サングラス撤廃＆オリジナル愛され笑顔・デフォルト完全統合版:
// ・【サングラス顔の完全撤廃＆笑顔への刷新】異質だったサングラス(cool)を完全撤廃し、
// 　添付画像(image_6.png)およびオリジナル版で大好評だった「パッチリ白目＋前向き黒目＋
// 　先端で可愛らしく微笑むスマイル口元」の極上ベクター描画を新設
// ・【デフォルト顔への昇格】normal、cool、および default（未指定時・初期生成時）の
// 　すべてにおいて、この愛嬌ある微笑み顔をメインフェイスとして完全統合
// ・【頭部進行方向正対】頭部ローカル座標系（+X進行方向）への精密な回転・配置により、
// 　旋回時やブースト時も一切の歪みやズレなく愛らしい表情を維持
// ==============================================================================

/**
 * スネーク頭部ベース円の上にパッチリ愛らしい表情パーツを描画
 * @param {CanvasRenderingContext2D} ctx 描画対象の2Dコンテキスト（頭部ローカル座標系）
 * @param {string} face 表情タイプ ('normal' | 'cool' | 'smile' | 'angry' | 'happy' | 'cute')
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

            // 怒り口元
            ctx.beginPath();
            ctx.arc(20, 26, 3.0, Math.PI, 0, true);
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

            // 笑顔の口
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(20, 16, 2.5, 0, Math.PI, true);
            ctx.stroke();
            break;
        }

        case 'cute': {
            // メニューSVG：キュート（うるうる瞳）
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

            // 控えめな口
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 1.8;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20, 15, 2.2, 0, Math.PI, true);
            ctx.stroke();
            break;
        }

        // ★ サングラス(cool)を完全撤廃し、画像(image_6.png)の愛らしい笑顔へ置換！
        // normal、cool、smile、および default のすべてでこの可愛い微笑み顔を基本とする
        case 'cool':
        case 'smile':
        case 'normal':
        default: {
            // 1. 白目（左右の大きなパッチリ瞳）
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14, 21, 6.0, 0, Math.PI * 2);
            ctx.arc(26, 21, 6.0, 0, Math.PI * 2);
            ctx.fill();

            // 2. 黒目（前方をまっすぐ見つめる瞳）
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15, 19, 2.8, 0, Math.PI * 2);
            ctx.arc(25, 19, 2.8, 0, Math.PI * 2);
            ctx.fill();

            // 3. ハイライト（愛くるしいツヤ光彩）
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.2, 18.2, 0.9, 0, Math.PI * 2);
            ctx.arc(24.2, 18.2, 0.9, 0, Math.PI * 2);
            ctx.fill();

            // 4. 微笑み口元（オリジナル完全準拠：先端のキュートなスマイルライン）
            // -Y 方向（鼻先・進行方向）に向かって綺麗に微笑む弧
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20, 13.5, 3.6, 0, Math.PI, true);
            ctx.stroke();
            break;
        }
    }

    ctx.restore();
}