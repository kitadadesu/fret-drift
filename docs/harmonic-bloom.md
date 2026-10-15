# Harmonic Bloom

「倍音の漂流」タブの **Bloom** を上げる。Harmonics=0、Reverb=0、Delay=0でも、透明な基音の奥から約12秒かけて倍音が開く。おすすめはBloom 0.5–0.8。BloomとHarmonicsが両方0なら従来のサイン波音色。Harmonicsが有効なら既存の非調和性・独立したDriftも共存する。

## 音とライフサイクル

- 既存Driftの2/3/4/6次の4部分音を共有し、最大36発振器を維持。第6倍音は既存音色との互換性を優先して保持した。Bloom単独では整数倍・基音と同じGlideを使う。
- 開始遅延0.3/1.8/3.8/6秒、開花時間3/4/5/6秒。smoothstepを250msごとの連続GainNodeランプへ変換。タイマーや継続的なJavaScript更新は不要。完成後は穏やかな静的スペクトルを保つ。
- 振幅比は最大0.20/0.12/0.07/0.035。Drift分との合計とCoreを同時に正規化し、全振幅の絶対値合計を元の2基音分以内に保つ。各ランプ終点の上限とその線形補間により、途中も上限を維持。設定変更・再開花は現在のゲインをholdし80msで新しい軌道へ接続する。
- 初回発音、音高変更、ミュート復帰、Bloomの0からの有効化で開花時計を更新。同じ音高の共通音は開花を継続する。試聴・復帰・採用・Undoは同じmove経路を使用し、基音や発振器は再起動しない。Bloom量だけの変更はDriftの周波数軌道を再開しない。
- 周波数上限sampleRate×0.45、同×0.40–0.45でのフェード、既存コンプレッサー・Delay帰還制限を維持。0/ミュート時の部分音は無音で保持し、Stop/onended、Resume時のretiring回収、disposeで停止・切断する。
- スライダー1個だけ追加。開花時間や装飾アニメーションは増やさず、音と安定性を優先。

## 検証

`npm test`相当（同梱Nodeでpackage scriptを実行）: 26件成功。`npm run build`相当、`git diff --check`成功。追加依存なし。

- Bloomゼロ、部分音の出現順序、両スペクトル最大値の振幅上限、整数倍のPortamento、量変更時のDrift軌道保持、300回の操作、ユニゾン、ミュート復帰、Stop/Resume/disposeを検証。
- 実Chromeの`TEST_BLOOM=1 node tests/browser.mjs`: PC 1440×1000・タッチ模擬390×844。150回の切替、外でrelease、キーhold、cancel/blur/hidden、採用、Undo、停止再開、編集を通過。発振器数不変、ページエラー0、横はみ出しなし。
- `node tests/browser-bloom.mjs`: OfflineAudioContextで15秒を実レンダリング。空間効果なし。13秒時点の基音/第2/第3/第4/第6成分は約0.03016/0.00603/0.00362/0.00211/0.00106。0設定の第2成分は約8.36e-9。Bloom最大のpeak約0.04298、隣接サンプル差最大約0.00391。演奏中の0→1→0.4→1変更でも各測定窓で基音を維持。
- `node tests/browser-drift.mjs`: 既存Driftの別々のグライドとUIを通過。空間効果最大の測定peak約0.1951、隣接差約0.00740、停止後0、retiring残留0、再開後非ゼロ。

ブラウザ用に`BASE_URL`、`PLAYWRIGHT_MODULE`、`CHROME_PATH`を指定可能。音声回路の出力はハードウェア手前で無音化して測定している。**人の耳による美的A/B試聴、Safari/iOS/Android実機、低性能端末のCPU計測は未実施**。ノード数とcleanupの検査はブラウザ全体のヒープ測定ではない。

## ベース

main `07d96bc`から作成。PR #1/#2/#3はマージ済み。Harmonic Driftを再実装せず統合。Fret Atlas (`kitadadesu/chord-atlas`)は変更していない。マージ・デプロイは行わない。
