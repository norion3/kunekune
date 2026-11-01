// ==============================================================================
// 『くねくねバトル オンライン』GRAVITY内部ネイティブルーティングモジュール (gravity_router.js)
// v25.1.0 単独モジュール化＆ユニバーサルリンク誤爆完全防止版:
// ・menu.js からネイティブプロフィール起動処理を完全分離・独立化
// ・slme://internal URIスキームによる安全なアプリ内ネイティブ画面起動
// ・非表示 iframe による起動で WebKit の 404 クラッシュおよび異常ナビゲーションを 100% 根絶
// ・どこからでも単独インポートしてプロフィールジャンプを呼び出し可能
// ==============================================================================

/**
 * GRAVITYネイティブ画面安全起動ルーター（Universal Links誤爆・404クラッシュ防止）
 */
export const GravityRouter = {
    /**
     * 指定された内部 user_id のプロフィール画面をネイティブで開く
     * @param {string|number} internalUid GRAVITYシステム内部の真の user_id（表示用IDは不可）
     */
    openProfile(internalUid) {
        if (!internalUid || internalUid === 'local_user' || internalUid === 'null') return;
        const cleanId = String(internalUid).replace(/[^0-9]/g, '');
        if (!cleanId) return;

        const paramObj = {
            uid: Number(cleanId),
            selectedIndex: 0,
            web_url: 'https://www.gravity.place/user/' + cleanId,
            s: 'web',
            b: 'user'
        };
        const innerUrl = 'usercenter?0=' + encodeURIComponent(JSON.stringify(paramObj));
        const deepLink = 'slme://internal?type=5&ani=1&url=' + encodeURIComponent(innerUrl);

        // 非表示 iframe キック方式（メイン画面の URL を書き換えずに親アプリのネイティブインターセプターのみを起動）
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;display:none;';
        iframe.src = deepLink;
        document.body.appendChild(iframe);

        // ネイティブ捕捉後に安全にDOMから破棄（メモリリーク防止）
        setTimeout(() => {
            if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
            }
        }, 1000);
    }
};