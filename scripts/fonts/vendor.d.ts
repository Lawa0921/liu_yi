// 沒有自帶型別的相依套件的最小宣告（只寫我們用到的部分）。

declare module 'subset-font' {
  interface SubsetFontOptions {
    targetFormat?: 'sfnt' | 'truetype' | 'woff' | 'woff2';
    noLayoutClosure?: boolean;
    noHinting?: boolean;
    keepFeatures?: string[];
  }
  /** 依 `text` 內的字元做子集，回傳新的字型檔。 */
  function subsetFont(font: Uint8Array, text: string, options?: SubsetFontOptions): Promise<Buffer>;
  export = subsetFont;
}

declare module 'wawoff2' {
  const wawoff2: {
    compress(font: Uint8Array): Promise<Uint8Array>;
    decompress(woff2: Uint8Array): Promise<Uint8Array>;
  };
  export = wawoff2;
}
