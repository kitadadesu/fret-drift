# Dream Texture

音色欄の **Dream Texture** タブで演奏中に変更できる。

| 操作 | 初期値 | 内容 |
|---|---:|---|
| Dry Drift | 15% | 元の音高とPortamentoに加える微細なwow/flutter・滑らかなランダム変動。最大±4セント、0で変調なし |
| Wet Drift | 35% | 通常reverb・delay・Spectral Shimmerの戻りを独立した変調ディレイで揺らす。0で直接経路に戻る |
| Spectral Shimmer | 35% | Bloomの3・4・6倍音だけの残響量。0で戻り無音 |
| Shimmer Decay | 8s | 1–12秒の名目RT60。フィルターと安全上限により周波数・経路ごとの実効減衰は短くなる |
| Diffusion | 60% | 17/23/31msのallpassによる拡散。0で拡散段を通らない |

Bloomの初期値は70%。既存の設定を更新する処理は追加しておらず、明示された0を含む値は維持する。現アプリは音色設定を永続保存していない。

## 音声経路

既存のcore・partial→Dry/通常reverb/delayを維持。既存partial oscillatorから独立send gainへ分岐し、Bloom由来の3・4・6倍音の量だけを送る。sendのADSRは弦本体に追従するため、ミュートと復帰も同期する。Bloom 0では新しいsendが80msでゼロになり、既に入った残響は自然に減衰する。

send → HPF 650Hz → LPF 6.2kHz → 拡散allpass → 4本のdamped comb reverb → Spectral wet → 共通Wet Drift → master。

reverbのfeedbackは最大0.89、拡散allpassは固定0.45。人工的な演奏フィードバック機能ではなく、減衰残響を作るDSP内部の閉ループのみ。戻りゲインは各0.08で、既存master compressorを通る。reverbから音源への再送、オクターブピッチシフト、Destination転調はない。

Dry Driftは全ての既存oscillatorのdetuneへ加算し、frequencyのGlideや既存Detuneの値を書き換えない。Wet Driftは通常・spectral残響とechoを合流した位置の8ms delayを最大±0.6ms変調する。入力音そのもののDry Driftは残響の入口にも反映されるが、Wet側の追加変調は独立。Dry/Wetで別々の97/109秒control bufferを一度だけ生成し、それぞれ異なるwow/flutter周期とランダム曲線をループする。完全に非反復の乱数ではなく、低負荷で連続する長周期の揺らぎ。

Dreamノブは35msの平滑化を使用。Dry/Wet DriftとShimmerを0にすると既存の音声経路に戻る（平滑化後）。DecayとDiffusionはShimmer専用。ノブ操作・試聴・AUTOの採用ではAudioContext、エフェクト、発振中の声を再生成しない。Bloom/Harmonicsの既存の遅延partial作成は維持。停止は従来どおりReleaseに合わせて全体をフェードアウトし、コード変更・弦ミュートではtailが続く。

## 検証

`npm test`、`npm run build`。lint scriptはないためJS構文検査と`git diff --check`も実行。

`PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-dream.mjs` はChromeの実WebAudioで、35秒×複数条件をofflineレンダリングする。6声、ミュートと復帰、連続コード変更、演奏中のDecay/Diffusion/Drift変更、Bloom 0、tail、有限値、peak、隣接sample差、独立したDry/Wet変更による信号差、および390/1440pxでUIの横はみ出しを確認する。ユニットテストは反復変更時のvoice/source再利用・ADSR・send・cleanupも確認する。

自動レンダリングの数値比較は人による聴感評価の代替ではない。Safari・実機モバイルでの音質と長時間の実時間負荷は、レビュー時にも確認する。

変更前main (`284be36`) との5秒・240,000 sample比較では、同じBloom/Harmonics/空間設定かつDream効果0で最大差0.00001284、RMS差0.00000333。変調AudioParamが接続されたままのためビット単位の一致は保証しないが、微小な差に収まることを確認した。追加control bufferは合計約6.6MBで固定、ノブやコード変更ごとには増えない。
