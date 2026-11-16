// 一段文字實際占到的最右緣：兵器的左界（引擎端 `textRight`）。
//
// 為什麼不用 `.beat__text` 的盒子：它是文字欄（35rem／44vw 寬），欄比字寬，用它當界線兵器會被縮短太多；
// 區塊元素（h2、p）的盒子也一樣是欄寬。要的是「字真的排到哪裡」，所以逐個文字節點用 Range 量行框的矩形，取最大 right。
// 只算可見的文字：display:none 的面板（另一個對象那一組）量不到矩形，自然不算。
// 這個檔案會被打進首頁的腳本：程式字串只用英文（字型守門會掃 JS 裡的中文字）。

/** `root` 底下所有文字節點的最大 right（視窗座標，CSS 像素）；沒有任何可見文字回 `undefined`。 */
export function textInkRight(root: ParentNode): number | undefined {
  let right = -Infinity;
  const range = document.createRange();
  for (const column of root.querySelectorAll('.beat__text')) {
    const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0) right = Math.max(right, rect.right);
      }
    }
  }
  return right === -Infinity ? undefined : right;
}
