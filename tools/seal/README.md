# 朱印「六藝」遮罩（tools/seal）

首頁「氣聚成人」的朱印來源：`render-seal.py` 用崇羲篆體把「六」「藝」畫成 512×512 的 alpha 遮罩，輸出 `src/assets/seal/seal-liuyi.png`。
**入庫的只有這張遮罩 PNG；字型檔不入庫。** 這是開發者本機工具，CI 與建置都不跑它，也不需要字型。

## 重新產生

```
uv run --no-project --python 3.11 --with pillow --with numpy --with fonttools python tools/seal/render-seal.py \
    --font C:/Users/bag57/.cache/liu_yi-fonts/chongxi_seal.otf --out src/assets/seal/seal-liuyi.png
```

- 字型預設位置 `~/.cache/liu_yi-fonts/chongxi_seal.otf`（repo 外）。字型不存在，或 cmap 缺「六」「藝」任一字，腳本直接失敗、不寫檔。
- 輸出是確定性的（同字型、同參數得到同一份位元組）。腳本最後印出字型與遮罩的 sha256，更新 `src/assets/silhouettes/provenance.json` 的 `seal-liuyi` 時照抄。
- 版面（朱文、方框、右「六」左「藝」）與粗細參數寫在腳本開頭的常數；`--embolden` 可臨時覆寫字的加粗量。
- 閘門：`npx vitest run tests/unit/seal-asset.test.ts`（尺寸、無半透明霧、外框、留白、兩字位置、墨量、來源紀錄、repo 內無字型檔）。

## 字型授權與姓名標示

- 字型：**崇羲篆體**（Chong Xi Small Seal），Version 1.00。
- 授權：**創用 CC 姓名標示-禁止改作 3.0 台灣及其後版本**（CC BY-ND 3.0 TW or later）。使用時須表彰原作者姓名；不得修改字型本身。
- 姓名標示：
  - 字型內嵌著作權聲明：`(C)CopyRight Academia Sinica`（中央研究院）。
  - 官方頁面 <https://xiaoxue.iis.sinica.edu.tw/chongxi/> 載明的參與者：計畫發起與領導 謝清俊教授、字形製作 王心怡、參與 莊德明、序文 季旭昇；頁尾著作權年份 © 2022。
  - 授權頁 <https://xiaoxue.iis.sinica.edu.tw/chongxi/copyright.htm>。
- 我們怎麼用：本機以 PIL 把字型畫成點陣遮罩（等比例縮放、筆畫每側加粗 2 px 以便取樣），**不改字型、不散布字型**；網站只出現遮罩衍生的光點與朱印圖樣。
- 待確認（交付清單）：簡報沒有給標示的確切文字，上列內容是照字型內嵌聲明與官方頁面整理的；官方頁面沒有寫出「中央研究院」，也沒有列出完整的製作單位名單。網站是否需要在頁尾或致謝頁附上上述標示，請業主／控制者確認後再補，並確認「加粗、輸出成點陣遮罩」是否在 ND 條款的容許範圍內。

## 不要這樣做

- 不要把 `.otf`／`.ttf` 或任何檔名含 `chongxi` 的檔案放進 repo（單元測試會擋）。
- 不要手畫或手修遮罩像素；要改版面就改腳本常數重跑。
