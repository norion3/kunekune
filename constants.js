/**
 * ==============================================================================
 * 『くねくねバトル オンライン』システム共通定数定義 (constants.js)
 * v16.0.0 改訂:
 * ・8人マルチプレイ完全対応 8色カラーパレット (SNAKE_COLORS)
 * ・セーフエリア・ワールド・物理定数の統一管理
 * ==============================================================================
 */

// ワールド・空間サイズ
export const MAP_SIZE = 60000;
export const GRID_SIZE = 250;

// プレイヤー・AI定数
export const TOTAL_SNAKES = 50;
export const MAX_PLAYERS = 8;
export const MAX_AIS = 42;

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

// 8人マルチプレイ対応 8色カラーパレット
export const SNAKE_COLORS = [
    '#00e5ff', // 1. シアン
    '#ff3366', // 2. ローズレッド
    '#ccff33', // 3. ライムイエロー
    '#ff9933', // 4. ネオンオレンジ
    '#cc66ff', // 5. パープル
    '#10b981', // 6. エメラルドグリーン
    '#ffff33', // 7. イエロー
    '#f472b6'  // 8. キャンディピンク
];

// 環境餌カラー
export const FOOD_COLORS = ['#ffff99', '#99ffff', '#b3ff99', '#ffb3d9'];