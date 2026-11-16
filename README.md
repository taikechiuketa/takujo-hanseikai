# 卓上反省会

グループごとの麻雀成績を記録・共有するWebアプリ。個人版たけチャートとはリポジトリ・DB・認証・保存キーを分離しています。

- [ログイン・マイグループ](https://taikechiuketa.github.io/takujo-hanseikai/account.html)
- [参加募集・通知](https://taikechiuketa.github.io/takujo-hanseikai/community.html)（各卓の閲覧共有をオンにして利用）
- [画面説明](docs/screen-guide.md)
- [仕様書](docs/specification.md)
- [たけチャートUI改善の適用・ロールバック](docs/ui-port-20261116.md)

開発時は `python3 -m http.server 8000` で配信し、`index.html?local=1` を開くと明示的な端末内試用ができます。クラウドの卓にはgroupパラメーターとログインが必要です。

テストはNode 22以降で `npm ci && npm test`。テストは擬似アカウント・卓・RPCを使用します。
