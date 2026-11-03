// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v29.3.0 メニューSVG完全準拠＆「ω口」マスコットフェイス刷新版:
// ・【メニューSVGと1:1完全一致】メニューの顔アイコンを「唯一の正」とし、
// 　眉毛の角度・長さ・目の位置・口の弧を寸分違わずCanvasへ忠実に直写
// 　（怒り眉が飛び出たり角度が不自然に歪むバグを座標変換の適正化で完全根絶）
// ・【4番目の舌を完全撤廃＆「ω口」へ刷新】不自然だった舌出しを廃止し、
// 　他にはないキュッと上がった波型リップ「ω口（ネコ口／マスコット口）」を新設。
// 　1番目（上品な微笑み）と明確に差別化された、愛くるしく見やすい新表情を確立
// ・【頭部比率の黄金比】scale: 1.68/40 により頭部円からのはみ出しを完全防止
// ==============================================================================

/**
 * スネーク頭部ベース円の上にメニューSVGと1:1完全一致する愛らしい表情パーツを描画
 * @param {CanvasRenderingContext2D} ctx 描画対象の2Dコンテキスト（頭部ローカル座標系）
 * @param {string} face 表情タイプ ('normal' | 'cool' | 'smile' | 'angry' | 'happy' | 'cute')
 * @param {number} size スネークの頭部半径
 */
export function drawSnakeFace(ctx, face, size) {
    ctx.save();

    // メニューSVG (40x40) をスネーク頭部へジャストフィットさせる黄金スケール
    const scale = (size * 1.68) / 40;

    // メニューSVGの向き（上:額、下:口、左:左目、右:右目）を
    // スネーク頭部ローカル（+X:進行方向先端、±Y:左右）へ寸分狂わず写像する変換
    // x_local = (y_svg - 20) * scale + (size * 0.14)
    // y_local = (x_svg - 20) * scale
    ctx.transform(0, scale, scale, 0, size * 0.14, 0);
    ctx.translate(-20, -20);

    switch (face) {
        case 'angry': {
            // =================================================================
            // 2. いかり（メニューSVGと1:1完全一致）
            // =================================================================
            // 白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14, 21, 5.5, 0, Math.PI * 2);
            ctx.arc(26, 21, 5.5, 0, Math.PI * 2);
            ctx.fill();

            // 瞳
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15.5, 21, 2.6, 0, Math.PI * 2);
            ctx.arc(27.5, 21, 2.6, 0, Math.PI * 2);
            ctx.fill();

            // メニューSVGと寸分違わぬキリッとした怒り眉
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(9, 13);
            ctx.lineTo(19, 18);
            ctx.moveTo(31, 13);
            ctx.lineTo(21, 18);
            ctx.stroke();

            // への字口
            ctx.beginPath();
            ctx.arc(20, 31, 3.0, -Math.PI * 0.8, -Math.PI * 0.2);
            ctx.stroke();
            break;
        }

        case 'happy': {
            // =================================================================
            // 3. にこにこ（メニューSVGと1:1完全一致）
            // =================================================================
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';

            // 笑顔目アーチ
            ctx.beginPath();
            ctx.arc(14, 21, 4.5, Math.PI, 0);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(26, 21, 4.5, Math.PI, 0);
            ctx.stroke();

            // ピンクのほっぺチーク
            ctx.fillStyle = 'rgba(255, 99, 132, 0.75)';
            ctx.beginPath();
            ctx.arc(9, 25, 3.0, 0, Math.PI * 2);
            ctx.arc(31, 25, 3.0, 0, Math.PI * 2);
            ctx.fill();

            // にっこり口元
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(20, 23.5, 3.0, 0.15 * Math.PI, 0.85 * Math.PI);
            ctx.stroke();
            break;
        }

        case 'cool':
        case 'smile': {
            // =================================================================
            // 4. ★ 新設「ω口（ネコ口／マスコット口）」（舌出し完全撤廃版）
            // 舌をなくし、キュッと上がった波型リップ「ω」で最高に愛嬌ある表情
            // =================================================================
            // 大きなパッチリ白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14, 20, 5.8, 0, Math.PI * 2);
            ctx.arc(26, 20, 5.8, 0, Math.PI * 2);
            ctx.fill();

            // 前方を見つめる黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15, 19, 2.7, 0, Math.PI * 2);
            ctx.arc(25, 19, 2.7, 0, Math.PI * 2);
            ctx.fill();

            // ハイライト光彩
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.2, 18.2, 1.0, 0, Math.PI * 2);
            ctx.arc(24.2, 18.2, 1.0, 0, Math.PI * 2);
            ctx.fill();

            // ★ キュートな「ω口」（ネコ口・マスコットリップ）
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            // 左側のふくらみ
            ctx.arc(17.8, 27.2, 2.3, -Math.PI * 0.1, Math.PI * 0.85);
            // 右側のふくらみ
            ctx.arc(22.2, 27.2, 2.3, 0.15 * Math.PI, Math.PI * 1.1);
            ctx.stroke();
            break;
        }

        case 'cute': {
            // =================================================================
            // 5. キュート（うるうる瞳・メニューSVGと1:1完全一致）
            // =================================================================
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

            // うるうる瞳のハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16.5, 18.5, 1.3, 0, Math.PI * 2);
            ctx.arc(28.5, 18.5, 1.3, 0, Math.PI * 2);
            ctx.fill();

            // 控えめなおちょぼ口
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 1.8;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20, 25.5, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
            ctx.stroke();
            break;
        }

        case 'normal':
        default: {
            // =================================================================
            // 1. ノーマル（王道微笑み顔・メニューSVGと1:1完全一致）
            // =================================================================
            // 白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14, 20, 5.5, 0, Math.PI * 2);
            ctx.arc(26, 20, 5.5, 0, Math.PI * 2);
            ctx.fill();

            // 黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15, 19, 2.6, 0, Math.PI * 2);
            ctx.arc(25, 19, 2.6, 0, Math.PI * 2);
            ctx.fill();

            // ハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.2, 18.2, 0.9, 0, Math.PI * 2);
            ctx.arc(24.2, 18.2, 0.9, 0, Math.PI * 2);
            ctx.fill();

            // 上品な微笑みスマイルライン
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.0;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20, 24.5, 3.5, 0.15 * Math.PI, 0.85 * Math.PI);
            ctx.stroke();
            break;
        }
    }

    ctx.restore();
}