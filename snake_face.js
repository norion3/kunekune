// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v33.0.0 4番目「ω口」髭化完全根絶＆目元リフトアップ・繊細リップ調律版:
// ・【目元リフトアップ（y: 16.5）】白目・黒目・ハイライトを頭頂部方向へ引き上げ、
// 　広すぎたおでこの余白を適正化。目と口の間にクッキリとしたシアン地の抜け感を確保
// ・【口の線の繊細化（lineWidth: 1.35）】線の太さを2.0から1.35へ大幅スリム化し、
// 　縮小表示時に黒い塊（剛毛なヒゲ）として潰れる現象を完全根絶
// ・【ωリップの適正スケール】半径1.45、Y座標25.2で配置し、中央の谷を緩やかにすることで
// 　カイゼル髭のシルエットを脱却し、メニュー通りのあざと可愛いマスコット口を再現
// ・【他表情完全保持】ノーマル、怒り、笑顔、クール、キュートの黄金比を100%維持
// ==============================================================================

/**
 * スネーク頭部ベース円の上にメニューSVGと1:1調和する愛らしい表情パーツを描画
 * @param {CanvasRenderingContext2D} ctx 描画対象の2Dコンテキスト（頭部ローカル座標系）
 * @param {string} face 表情タイプ ('normal' | 'cool' | 'smile' | 'angry' | 'happy' | 'cute')
 * @param {number} size スネークの頭部半径
 */
export function drawSnakeFace(ctx, face, size) {
    ctx.save();

    // メニューアイコンの愛嬌を完全再現する黄金スケール
    const scale = (size * 2.32) / 40;

    // スネーク頭部ローカル（+X: 進行方向先端、±Y: 左右）への射影変換
    ctx.transform(0, scale, scale, 0, size * 0.16, 0);
    ctx.translate(-20, -20);

    switch (face) {
        case 'angry': {
            // =================================================================
            // 2. いかり（生意気キュートなマスコット怒り顔）
            // =================================================================
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 20.5, 6.2, 0, Math.PI * 2);
            ctx.arc(26.5, 20.5, 6.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15.2, 20.5, 3.2, 0, Math.PI * 2);
            ctx.arc(27.2, 20.5, 3.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.2, 19.2, 1.2, 0, Math.PI * 2);
            ctx.arc(26.2, 19.2, 1.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(8.5, 12.5);
            ctx.lineTo(19.0, 17.5);
            ctx.moveTo(31.5, 12.5);
            ctx.lineTo(21.0, 17.5);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(20, 28.5, 3.2, -Math.PI * 0.8, -Math.PI * 0.2);
            ctx.stroke();
            break;
        }

        case 'happy': {
            // =================================================================
            // 3. にこにこ（ふんわりチーク＆愛され笑顔）
            // =================================================================
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.6;
            ctx.lineCap = 'round';

            ctx.beginPath();
            ctx.arc(13.5, 20.5, 5.5, Math.PI, 0);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(26.5, 20.5, 5.5, Math.PI, 0);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255, 99, 132, 0.82)';
            ctx.beginPath();
            ctx.arc(8.5, 24.5, 3.6, 0, Math.PI * 2);
            ctx.arc(31.5, 24.5, 3.6, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(20, 24.0, 3.8, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
            break;
        }

        case 'cool': {
            // =================================================================
            // 5. クール（あざと流し目＆斜めアヒル口スマイル）
            // =================================================================
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15.2, 18.2, 3.2, 0, Math.PI * 2);
            ctx.arc(28.2, 18.2, 3.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16.0, 16.9, 1.35, 0, Math.PI * 2);
            ctx.arc(29.0, 16.9, 1.35, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.1;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(21.2, 24.4, 3.2, 0.10 * Math.PI, 0.78 * Math.PI);
            ctx.stroke();
            break;
        }

        case 'smile': {
            // =================================================================
            // 4. ★ 改良型「ω口（マスコットリップ）」
            // 目を上（y: 16.5）へ引き上げ、口の線を1.35へ繊細化。
            // 目と口の間に十分なシアン地の余白を作り、髭に見える現象を完全根絶！
            // =================================================================
            // ★ 白目を上（y: 16.5）へシフトしておでこを詰め、口との距離を確保
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 16.5, 6.0, 0, Math.PI * 2);
            ctx.arc(26.5, 16.5, 6.0, 0, Math.PI * 2);
            ctx.fill();

            // 前方を見つめる黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(14.8, 15.8, 3.0, 0, Math.PI * 2);
            ctx.arc(25.2, 15.8, 3.0, 0, Math.PI * 2);
            ctx.fill();

            // クリアな右上ハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.0, 14.8, 1.25, 0, Math.PI * 2);
            ctx.arc(24.4, 14.8, 1.25, 0, Math.PI * 2);
            ctx.fill();

            // ★ 繊細な細線（lineWidth: 1.35）で描く愛らしい「ω口」
            // 剛毛な髭感をなくし、ぷっくりとしたネコリップを再現
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 1.35;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            // 左側のふくらみ
            ctx.arc(18.2, 25.2, 1.45, -Math.PI * 0.08, Math.PI * 0.88);
            // 右側のふくらみ
            ctx.arc(21.8, 25.2, 1.45, 0.12 * Math.PI, Math.PI * 1.08);
            ctx.stroke();
            break;
        }

        case 'cute': {
            // =================================================================
            // キュート（超巨大うるうる瞳＆おちょぼ口）
            // =================================================================
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 7.2, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 7.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(14.5, 19.5, 4.4, 0, Math.PI * 2);
            ctx.arc(27.5, 19.5, 4.4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16.5, 17.5, 1.8, 0, Math.PI * 2);
            ctx.arc(29.5, 17.5, 1.8, 0, Math.PI * 2);
            ctx.arc(13.2, 21.0, 1.0, 0, Math.PI * 2);
            ctx.arc(26.2, 21.0, 1.0, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.0;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20, 26.0, 2.4, 0.15 * Math.PI, 0.85 * Math.PI);
            ctx.stroke();
            break;
        }

        case 'normal':
        default: {
            // =================================================================
            // 1. ノーマル（王道パッチリ微笑みマスコット）
            // =================================================================
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(14.8, 18.5, 3.2, 0, Math.PI * 2);
            ctx.arc(25.8, 18.5, 3.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.8, 17.5, 1.4, 0, Math.PI * 2);
            ctx.arc(24.8, 17.5, 1.4, 0, Math.PI * 2);
            ctx.arc(15.8, 19.5, 0.8, 0, Math.PI * 2);
            ctx.arc(26.8, 19.5, 0.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20, 24.8, 3.6, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
            break;
        }
    }

    ctx.restore();
}