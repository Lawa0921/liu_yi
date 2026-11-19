// 全站共用的文字與連結。
// 聯絡資訊在 2026-11-18 依 Facebook 粉專（「關於」頁與貼文末的固定資訊）核對，來源見 docs/fb-sync-2026-11-18.md。
// 電話粉專沒有公開，所以不放。

export const SITE = {
  name: '六藝武術工作室',
  shortName: '六藝武術',
  tagline: '傳承武術精神',
  description: '六藝武術工作室：兵器、拳術、格鬥，大人與小孩的武術課程。',
  lang: 'zh-Hant-TW',
  ogLocale: 'zh_TW',
  facebookUrl: 'https://www.facebook.com/ourLucal',
  // LINE 官方帳號：粉專每篇貼文末寫的網址與 ID（2026-11-18）。舊站 QR 指向的 lin.ee/CIOGR8n 已不用。
  // src/assets/images/line.png 是用這個網址產生的 QR code，換網址時圖要一起換（tests/unit/fb-sync.test.ts 會解碼比對）。
  // 手機使用者沒辦法掃自己的螢幕，所以另外給一個可點的連結。
  lineUrl: 'https://lin.ee/kUCPTbo',
  /** LINE 搜尋用的 ID；粉專提醒「一定要加 @ 才找得到」。 */
  lineId: '@713oinxb',
  address: '103 臺北市大同區伊寧街43號2樓',
  transit: '捷運大橋頭站 1 號出口，步行兩分鐘',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=%E8%87%BA%E5%8C%97%E5%B8%82%E5%A4%A7%E5%90%8C%E5%8D%80%E4%BC%8A%E5%AF%A7%E8%A1%9743%E8%99%9F',
  email: 'samartialart@gmail.com',
  /** 粉專貼文裡「歡迎預約體驗」的 Google 表單。 */
  trialFormUrl: 'https://forms.gle/FHZ6zVtpS2r76y5b7',
} as const;

/** 導覽列項目（path 不含 base，渲染時經過 url()）。 */
export const NAV_ITEMS = [
  { label: '課程', path: '/courses/' },
  { label: '師資', path: '/coaches/' },
  { label: '場地', path: '/facility/' },
  { label: '課表', path: '/schedule/' },
] as const;

/** 「預約體驗」按鈕的目標：頁尾的 LINE 區塊。有 JS 時改開 LINE QR 視窗。 */
export const BOOKING_ANCHOR = '#line';
export const BOOKING_LABEL = '預約體驗';
