// ==============================================================================
// 『くねくねバトル オンライン』スネーク表情ベクター描画モジュール (snake_face.js)
// v30.0.0 メニューアイコン黄金比率＆愛嬌最大化マスコットフェイス版:
// ・【頭部比率の黄金比スケールアップ】顔の基準スケールを (size * 1.68)/40 から
// 　(size * 2.32)/40 へ大幅拡大。頭部円の中央に豆粒化していた顔パーツを頭部いっぱいに展開し、
// 　メニューアイコンが持つ「ぽてっとしたマスコットの愛らしさ」を完全再現
// ・【パッチリ瞳＆ダブルハイライト】白目を1.3倍に拡大し、黒目の中にメイン光＋サブ光の
// 　ダブルハイライト（うるうる光彩）を常時焼き付け。遠景ズームでも瞳の輝きを死守
// ・【目と口のディスタンス最適化】胴体側に離れて面長化していた口の位置を目元の直下へ引き上げ、
// 　ゆるキャラ・アニメマスコット特有の「顎上がりベビーフェイス比率」を確立
// ・【各表情の完全調律】
// 　- normal: パッチリ潤んだ瞳＋上品な微笑み
// 　- angry: 大きいまん丸瞳＋生意気キュートなキリリ眉＋への字口
// 　- happy: 優しいアーチ糸目＋ふんわりピンクチーク＋にっこり口
// 　- cool/smile: 前を見つめる大きな瞳＋キュッと上がった波型「ω口（ネコ口）」
// 　- cute: 溢れんばかりの超巨大瞳＋キラキラ光彩＋ちょこんとおちょぼ口
// ==============================================================================

/**
 * スネーク頭部ベース円の上にメニューSVGと1:1調和する愛らしい表情パーツを描画
 * @param {CanvasRenderingContext2D} ctx 描画対象の2Dコンテキスト（頭部ローカル座標系）
 * @param {string} face 表情タイプ ('normal' | 'cool' | 'smile' | 'angry' | 'happy' | 'cute')
 * @param {number} size スネークの頭部半径
 */
export function drawSnakeFace(ctx, face, size) {
    ctx.save();

    // ★ メニューアイコンの愛嬌を完全再現する新・黄金スケール（顔の豆粒化を解消）
    const scale = (size * 2.32) / 40;

    // スネーク頭部ローカル（+X: 進行方向先端、±Y: 左右）への最適射影変換
    // 進行方向の先端寄りにオフセットを配置し、前を見つめる自然なキャラクター感を演出
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

            // キュートなへの字口（目に近づけて幼さをキープ）
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

            // ふっくら太めの笑顔目アーチ（潰れ防止）
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

        case 'cool':
        case 'smile': {
            // =================================================================
            // 4. ★ 新設「ω口（ネコ口／マスコットリップ）」
            // キュッと上がった波型リップとパッチリ瞳の最強コンビ
            // =================================================================
            // 大きなパッチリ白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 6.4, 0, Math.PI * 2);
            ctx.fill();

            // 前方を見つめる黒目
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(14.5, 18.5, 3.3, 0, Math.PI * 2);
            ctx.arc(25.5, 18.5, 3.3, 0, Math.PI * 2);
            ctx.fill();

            // うるうるダブルハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            // メイン光
            ctx.arc(13.6, 17.5, 1.4, 0, Math.PI * 2);
            ctx.arc(24.6, 17.5, 1.4, 0, Math.PI * 2);
            // サブ光
            ctx.arc(15.6, 19.6, 0.8, 0, Math.PI * 2);
            ctx.arc(26.6, 19.6, 0.8, 0, Math.PI * 2);
            ctx.fill();

            // ★ キュートな「ω口」（目元のすぐ下にバランス良く配置）
            ctx.strokeStyle = '#111827';
            ctx.lineWidth = 2.3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            // 左のふくらみ
            ctx.arc(17.6, 26.2, 2.5, -Math.PI * 0.15, Math.PI * 0.85);
            // 右のふくらみ
            ctx.arc(22.4, 26.2, 2.5, 0.15 * Math.PI, Math.PI * 1.15);
            ctx.stroke();
            break;
        }

        case 'cute': {
            // =================================================================
            // 5. キュート（超巨大うるうる瞳＆おちょぼ口）
            // =================================================================
            // 顔いっぱいに広がる特大白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.5, 19.5, 7.2, 0, Math.PI * 2);
            ctx.arc(26.5, 19.5, 7.2, 0, Math.PI * 2);
            ctx.fill();

            // 吸い込まれそうな大きな黒目
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(14.5, 19.5, 4.4, 0, Math.PI * 2);
            ctx.arc(27.5, 19.5, 4.4, 0, Math.PI * 2);
            ctx.fill();

            // うるうる輝く大小のダブルハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            // メインハイライト
            ctx.arc(16.5, 17.5, 1.8, 0, Math.PI * 2);
            ctx.arc(29.5, 17.5, 1.8, 0, Math.PI * 2);
            // サブハイライト
            ctx.arc(13.2, 21.0, 1.0, 0, Math.PI * 2);
            ctx.arc(26.2, 21.0, 1.0, 0, Math.PI * 2);
            ctx.fill();

            // ちょこんと愛らしい小さなおちょぼ口
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

            // 瞳をきらめかせるダブルハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(13.8, 17.5, 1.4, 0, Math.PI * 2);
            ctx.arc(24.8, 17.5, 1.4, 0, Math.PI * 2);
            ctx.arc(15.8, 19.5, 0.8, 0, Math.PI * 2);
            ctx.arc(26.8, 19.5, 0.8, 0, Math.PI * 2);
            ctx.fill();

            // 目元のすぐ下にある上品でキュートな微笑み口
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