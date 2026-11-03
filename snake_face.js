// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v29.0.0 4番目表情「舌ペロスマイル」差別化＆デフォルト微笑み両立版:
// ・【4番目の口元を舌ペロスマイルへ刷新】1番目（ノーマル微笑み顔）との重複を解消。
// 　パッチリした大きな瞳はそのままに、先端からピンクの小さな舌が「ちょこん」と出た
// 　おちゃめで愛らしい「舌ペロ口元（tongue/smile）」を新設し、明確に差別化
// ・【1番目ノーマル顔の保護】オリジナル版で大好評だった上品な微笑みスマイルラインを
// 　1番目（normal/default）の王道デフォルト顔として確実に維持
// ・【精密ベクター配置】頭部ローカル座標系（+X進行方向）への精密なアライメントにより、
// 　旋回・急カーブ・ブースト時でも舌や瞳がズレることなく最高にキュートな描画を維持
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

        // ★ 4番目専用：舌ペロスマイル（cool / smile キー対応）
        // 1番目との重複を解消し、ピンクの舌をちょこんと出したおちゃめで最高に可愛い表情
        case 'cool':
        case 'smile': {
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

            // 3. ハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.2, 18.2, 0.9, 0, Math.PI * 2);
            ctx.arc(24.2, 18.2, 0.9, 0, Math.PI * 2);
            ctx.fill();

            // 4. ちょこんと出たピンクの舌（進行方向 -Y 先端）
            ctx.fillStyle = '#ff6b8b';
            ctx.beginPath();
            ctx.arc(20, 10.8, 2.3, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(20, 10.8, 2.3, 0, Math.PI * 2);
            ctx.stroke();

            // 5. スマイル口元ライン
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20, 13.8, 4.0, 0, Math.PI, true);
            ctx.stroke();
            break;
        }

        // ★ 1番目：ノーマル（王道の微笑みスマイル顔・デフォルト）
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