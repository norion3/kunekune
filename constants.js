/**
 * ==============================================================================
 * 『くねくねバトル オンライン』システム共通定数定義 (constants.js)
 * v24.3.0 カラー判別性向上＆最大6人マルチプレイ対応版:
 * ・3番目（#84cc16: 鮮やかなライムグリーン）と7番目（#eab308: 濃厚な山吹色ゴールド）の黄色被りを完全解消
 * ・広大で自由度の高い MAP_SIZE = 60000 を厳格固定
 * ・人間プレイヤー最大6名（MAX_PLAYERS = 6）＋ 自律生態系AI 94体 ＝ 合計100体スネーク
 * ・8色カラーパレット (SNAKE_COLORS) の視認性・個別識別性を完全最適化
 * ・セーフエリア・ワールド・物理定数の統一管理
 * ==============================================================================
 */

// ワールド・空間サイズ（広大な世界観を厳格維持）
export const MAP_SIZE = 60000;
export const GRID_SIZE = 250;

// プレイヤー・AI定数
// ★ GRAVITY AgentSDK 最大6名（ホスト＋ゲスト5名）＋ 自律AI 94体 ＝ 合計100体スネーク
export const TOTAL_SNAKES = 100;
export const MAX_PLAYERS = 6;
export const MAX_AIS = 94;

// 移動速度（黄金比減衰モデル基盤）
export const BASE_SPEED = 4.2;
export const BOOST_SPEED_MULT = 1.8;
export const TURN_SPEED_PLAYER = 0.16;

// セーフエリア規定値（ピクセル）
export const SAFE_INSET_TOP_GRAVITY = 104; // GRAVITYネイティブバー直下
export const SAFE_INSET_TOP_WEB = 20;      // 一般Webブラウザプレビュー用
export const SAFE_INSET_BOTTOM = 24;

// GRAVITY公式製作者 内部user_id定数（真の内部ID）
export const CREATOR_MAIN_INTERNAL_UID = '1540889251'; // norion (メイン窓口)
export const CREATOR_SUB_INTERNAL_UID  = '1542253108'; // のりおん (ゲーム開発・告知)

// ★ 8色カラーパレット（黄色の同色感を解消し、8色すべてが一瞬で判別できるよう最適化）
export const SNAKE_COLORS = [
    '#00e5ff', // 1. シアン（鮮烈な水色）
    '#ff3366', // 2. ローズレッド（鮮やかな赤）
    '#84cc16', // 3. ライムグリーン（ハッキリとした若草・黄緑）※旧#ccff33から変更
    '#ff9933', // 4. ネオンオレンジ（明るい橙色）
    '#cc66ff', // 5. パープル（明るい紫色）
    '#10b981', // 6. エメラルドグリーン（深みのある青緑）
    '#eab308', // 7. 山吹色ゴールド（温かみのある純金イエロー）※旧#ffff33から変更
    '#f472b6'  // 8. キャンディピンク（鮮やかな桃色）
];

// 環境餌カラー
export const FOOD_COLORS = ['#ffff99', '#99ffff', '#b3ff99', '#ffb3d9'];