// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v31.0.0 メニューSVG完全準拠＆4番目「極小ω口」＆5番目「あざと流し目」調律版:
// ・【4番目：極小ω口のあざとマスコット化】口の半径を2.5から1.45へ劇的縮小し、
// 　人中（目と口の距離）をゼロ化（y: 22.4）。両目の下端にちょこんと挟まる配置にし、
// 　「カイゼル髭」のような錯覚を完全根絶。濁りの原因だったサブ光を廃止し、
// 　メニューSVGと同一のピュアな右上ハイライトへ統合
// ・【5番目：あざと流し目の完全再現】両目の黒目を揃えて右上（x+1.4, y-0.9）へ寄せ、
// 　ハイライトも瞳の右上エッジに密着させた【完全同調視線ベクトル】を確立。
// 　さらに口を右寄りのアヒル口（斜めスマイル）にシフトさせ、メニュー特有のいたずら感を再現
// ・【1〜3番目完全維持】ノーマル微笑み、怒りキリリ眉、笑顔ピンクチークの愛嬌を死守
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
            // 大きな白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 20.5, 6.2, 0, Math.PI * 2);
            ctx.arc(26.5, 20.5, 6.2, 0, Math.PI * 2);
            ctx.fill();

            // 内寄りのキリッとした黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15.2, 20.5, 3.2, 0, Math.PI * 2);
            ctx.arc(27.2, 20.5, 3.2, 0, Math.PI * 2);
            ctx.fill();

            // 瞳のハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.2, 19.2, 1.2, 0, Math.PI * 2);
            ctx.arc(26.2, 19.2, 1.2, 0, Math.PI * 2);
            ctx.fill();

            // キリッとした怒り眉
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(8.5, 12.5);
            ctx.lineTo(19.0, 17.5);
            ctx.moveTo(31.5, 12.5);
            ctx.lineTo(21.0, 17.5);
            ctx.stroke();

            // キュートなへの字口
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

            // ふっくら太めの笑顔目アーチ
            ctx.beginPath();
            ctx.arc(13.5, 20.5, 5.5, Math.PI, 0);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(26.5, 20.5, 5.5, Math.PI, 0);
            ctx.stroke();

            // 鮮やかで可愛いピンクのほっぺチーク
            ctx.fillStyle = 'rgba(255, 99, 132, 0.82)';
            ctx.beginPath();
            ctx.arc(8.5, 24.5, 3.6, 0, Math.PI * 2);
            ctx.arc(31.5, 24.5, 3.6, 0, Math.PI * 2);
            ctx.fill();

            // 目元にキュッと近づけたにっこり口
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(20, 24.0, 3.8, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
            break;
        }

        case 'cool': {
            // =================================================================
            // 5. ★ クール（あざと流し目＆斜めアヒル口スマイル）
            // 両目の瞳を右上（x+1.4, y-0.9）へ揃え、いたずらっぽい視線と斜め口を完全再現
            // =================================================================
            // 大きな白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.fill();

            // ★ 右上を見つめる流し目黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15.2, 18.2, 3.2, 0, Math.PI * 2);
            ctx.arc(28.2, 18.2, 3.2, 0, Math.PI * 2);
            ctx.fill();

            // ★ 瞳の右上エッジに寄り添う輝くハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16.0, 16.9, 1.35, 0, Math.PI * 2);
            ctx.arc(29.0, 16.9, 1.35, 0, Math.PI * 2);
            ctx.fill();

            // ★ 右寄りのあざといアヒル口（斜めスマイル）
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
            // 4. ★ 新設「極小ω口（マスコットリップ）」
            // 口の横幅・高さをギュッと縮小し、目の直下（人中ゼロ）へ密着。
            // ヒゲ感を完全根絶し、サンリオ・ちいかわ的な愛嬌を100%再現
            // =================================================================
            // パッチリ白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.fill();

            // まっすぐ前を見つめる黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(14.8, 18.5, 3.2, 0, Math.PI * 2);
            ctx.arc(25.2, 18.5, 3.2, 0, Math.PI * 2);
            ctx.fill();

            // ★ メニュー準拠：クリアな右上ハイライト（濁りを生むサブ光を廃止）
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.0, 17.2, 1.35, 0, Math.PI * 2);
            ctx.arc(24.4, 17.2, 1.35, 0, Math.PI * 2);
            ctx.fill();

            // ★ 極小サイズ「ω口」（目と目の真下にぴったり挟み込み）
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 1.9;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            // 左のふくらみ（幅をギュッと縮小）
            ctx.arc(18.4, 22.6, 1.45, -Math.PI * 0.10, Math.PI * 0.90);
            // 右のふくらみ
            ctx.arc(21.6, 22.6, 1.45, 0.10 * Math.PI, Math.PI * 1.10);
            ctx.stroke();
            break;
        }

        case 'cute': {
            // =================================================================
            // キュート（超巨大うるうる瞳＆おちょぼ口）
            // =================================================================
            // 特大白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 7.2, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 7.2, 0, Math.PI * 2);
            ctx.fill();

            // 大きな黒目
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(14.5, 19.5, 4.4, 0, Math.PI * 2);
            ctx.arc(27.5, 19.5, 4.4, 0, Math.PI * 2);
            ctx.fill();

            // うるうるダブルハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16.5, 17.5, 1.8, 0, Math.PI * 2);
            ctx.arc(29.5, 17.5, 1.8, 0, Math.PI * 2);
            ctx.arc(13.2, 21.0, 1.0, 0, Math.PI * 2);
            ctx.arc(26.2, 21.0, 1.0, 0, Math.PI * 2);
            ctx.fill();

            // 小さなおちょぼ口
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
            // 大きな白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.fill();

            // 前方を見つめる黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(14.8, 18.5, 3.2, 0, Math.PI * 2);
            ctx.arc(25.8, 18.5, 3.2, 0, Math.PI * 2);
            ctx.fill();

            // ダブルハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.8, 17.5, 1.4, 0, Math.PI * 2);
            ctx.arc(24.8, 17.5, 1.4, 0, Math.PI * 2);
            ctx.arc(15.8, 19.5, 0.8, 0, Math.PI * 2);
            ctx.arc(26.8, 19.5, 0.8, 0, Math.PI * 2);
            ctx.fill();

            // 微笑み口
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