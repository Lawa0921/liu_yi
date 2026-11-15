// 全站共用的文字與連結。聯絡資訊只放已確認可用的（設計文件 §5）：
// Facebook 連結與 LINE QR code。地址、電話、營業時間等業主回覆後再加，沒有就不顯示。

export const SITE = {
  name: '六藝武術工作室',
  shortName: '六藝武術',
  tagline: '傳承武術精神',
  description: '六藝武術工作室：兵器、拳術、格鬥，大人與小孩的武術課程。',
  lang: 'zh-Hant-TW',
  ogLocale: 'zh_TW',
  facebookUrl: 'https://www.facebook.com/ourLucal',
  // LINE 加好友網址：從 src/assets/images/line.png 這張 QR code 解碼出來的（2026-11-15），不是另外查的。
  // 換 QR 圖時要一起換。手機使用者沒辦法掃自己的螢幕，所以另外給一個可點的連結。
  lineUrl: 'https://lin.ee/CIOGR8n',
} as const;

/** 導覽列項目（path 不含 base，渲染時經過 url()）。 */
export const NAV_ITEMS = [
  { label: '課程', path: '/courses/' },
  { label: '師資', path: '/coaches/' },
  { label: '場地', path: '/facility/' },
  { label: '收費', path: '/pricing/' },
  { label: '課表', path: '/schedule/' },
] as const;

/** 「預約體驗」按鈕的目標：頁尾的 LINE 區塊。有 JS 時改開 LINE QR 視窗。 */
export const BOOKING_ANCHOR = '#line';
export const BOOKING_LABEL = '預約體驗';
