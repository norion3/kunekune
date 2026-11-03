// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v32.0.0 メニューSVG完全準拠＆4番目「ω口」黄金ディスタンス調律版:
// ・【4番目：ω口の目元めり込み完全解消】口の位置を目に近づけすぎていた（y: 22.6）
// 　設計を見直し、デザイン学適正値（y: 26.2）へ配置。白目の下端との間に
// 　美しいシアン地の抜け感を確保し、黒い塊としてのめり込み・ゲシュタルト崩壊を根絶
// ・【ωふくらみ適正スケール】半径を極小1.45から1.85へ拡大し、左右ふくらみ間隔を
// 　18.0 ↔ 22.0 に適正化。髭に見えず、ちいかわ・サンリオ的な愛らしいマスコットリップを再現
// ・【5番目：あざと流し目＆斜めアヒル口完全維持】右上を揃えて見つめる視線ベクトルと
// 　いたずらっぽい斜めスマイルを完全保持
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
            // 5. クール（あざと流し目＆斜めアヒル口スマイル）
            // =================================================================
            // 大きな白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.fill();

            // 右上を見つめる流し目黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(15.2, 18.2, 3.2, 0, Math.PI * 2);
            ctx.arc(28.2, 18.2, 3.2, 0, Math.PI * 2);
            ctx.fill();

            // 瞳の右上エッジに寄り添う輝くハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(16.0, 16.9, 1.35, 0, Math.PI * 2);
            ctx.arc(29.0, 16.9, 1.35, 0, Math.PI * 2);
            ctx.fill();

            // 右寄りのあざといアヒル口（斜めスマイル）
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
            // 4. ★ 新設「ω口（マスコットリップ）」
            // 目元へのめり込みを解消し、黄金比率（y: 26.2, r: 1.85）で配置。
            // 目と口の間に適度な抜け感を確保し、メニュー通りのあざとい可愛さを完全再現
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

            // メニュー準拠：クリアな右上ハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(14.0, 17.2, 1.35, 0, Math.PI * 2);
            ctx.arc(24.4, 17.2, 1.35, 0, Math.PI * 2);
            ctx.fill();

            // ★ 黄金ディスタンス「ω口」（目元から適度に離し、めり込みを完全解消）
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.0;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            // 左側のふくらみ
            ctx.arc(18.0, 26.2, 1.85, -Math.PI * 0.12, Math.PI * 0.88);
            // 右側のふくらみ
            ctx.arc(22.0, 26.2, 1.85, 0.12 * Math.PI, Math.PI * 1.12);
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