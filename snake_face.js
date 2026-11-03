// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v34.0.0 キュート瞳完全対称化＆広角口角アップ・笑顔リップ刷新版:
// ・【5番目「キュート」瞳の左右均等・完全対称化】
// 　黒目座標の右偏向（14.5, 27.5）によるロンパリ感を完全解消。
// 　白目(x: 14, 26)、黒目(x: 14.8, 25.2)、ハイライトを左右対称に完全再配置し、
// 　実機スクリーンでも愛らしく澄んだ上目遣いうるうる瞳を1:1再現
// ・【キュート口角の跳ね上げ＆広角笑顔化】
// 　短く潰れていたおちょぼ口から、半径3.5・角度0.05π〜0.95πの広角アーチへ拡張。
// 　両端の口角がキュッと上がった愛嬌満点の笑顔リップへ刷新
// ・【4番目「ω口」および他表情完全保持】
// 　ノーマル、怒り、笑顔、ω口、クールの黄金比と繊細なライン描画を100%維持
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
            // 4. 改良型「ω口（マスコットリップ）」
            // =================================================================
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 16.5, 6.0, 0, Math.PI * 2);
            ctx.arc(26.5, 16.5, 6.0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(14.8, 15.8, 3.0, 0, Math.PI * 2);
            ctx.arc(25.2, 15.8, 3.0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.0, 14.8, 1.25, 0, Math.PI * 2);
            ctx.arc(24.4, 14.8, 1.25, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 1.35;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.arc(18.2, 25.2, 1.45, -Math.PI * 0.08, Math.PI * 0.88);
            ctx.arc(21.8, 25.2, 1.45, 0.12 * Math.PI, Math.PI * 1.08);
            ctx.stroke();
            break;
        }

        case 'cute': {
            // =================================================================
            // 5. ★ キュート（完全左右対称うるうる瞳 ＆ 口角アップ笑顔リップ）
            // =================================================================
            // 白目（左右対称配置: x 14, 26）
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.0, 19.5, 6.8, 0, Math.PI * 2);
            ctx.arc(26.0, 19.5, 6.8, 0, Math.PI * 2);
            ctx.fill();

            // 黒目（左右均等対称配置: x 14.8, 25.2 で偏向・ロンパリ完全解消）
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(14.8, 19.2, 3.8, 0, Math.PI * 2);
            ctx.arc(25.2, 19.2, 3.8, 0, Math.PI * 2);
            ctx.fill();

            // 上部メインハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16.2, 17.5, 1.6, 0, Math.PI * 2);
            ctx.arc(26.6, 17.5, 1.6, 0, Math.PI * 2);
            // 側部サブハイライト（愛らしいツヤ感）
            ctx.arc(13.6, 20.4, 1.0, 0, Math.PI * 2);
            ctx.arc(24.0, 20.4, 1.0, 0, Math.PI * 2);
            ctx.fill();

            // ★ キュッと上がった広角笑顔リップ（口角アップ・半径3.5）
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(20.0, 26.2, 3.5, 0.05 * Math.PI, 0.95 * Math.PI);
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