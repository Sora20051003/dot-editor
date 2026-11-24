# MediaPipe（顔の読み取り）

アバターの画面（avatar.html）がカメラで顔の向き・まばたき・口の開きを読むために使う、Google の MediaPipe の部品。
ネットがなくても動くよう、アプリと一緒に置いている。

- vision_bundle.js：npm の @mediapipe/tasks-vision 0.10.14 の vision_bundle.mjs（拡張子を .js にし、ソースマップの行だけ外した）
- vision_wasm_internal.js / .wasm：同じパッケージの wasm/ から（SIMD 版のみ。今のブラウザはすべて対応）
- face_landmarker.task：https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- ライセンス：Apache License 2.0（LICENSE）。Copyright Google LLC
