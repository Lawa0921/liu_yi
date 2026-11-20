import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// 內容集合。slug 就是檔名（entry.id），例如 src/content/courses/bajiquan.md -> /courses/bajiquan/。
// 欄位依設計文件 §5；內文是 Markdown 本體。

const courses = defineCollection({
  loader: glob({ base: './src/content/courses', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z.object({
      /** 課程名稱（以業主的課程表為準） */
      title: z.string().min(1),
      /** 對象：大人／小孩／不分 */
      audience: z.enum(['adult', 'kid', 'all']),
      /** 分類：兵器／拳術／格鬥／其他 */
      category: z.enum(['weapon', 'fist', 'combat', 'other']),
      /** 一句話簡介（卡片、meta description 用） */
      summary: z.string().min(1),
      /** 照片 0–5 張；第一張是封面。沒有照片就留空陣列，會顯示文字卡。
       *  cardOnly：只給課程卡（與 og 圖）用、課程內頁不顯示的照片（例如從課程影片截的一格，內頁首屏已經是那支影片）。 */
      photos: z
        .array(z.object({ src: image(), alt: z.string().min(1), cardOnly: z.boolean().default(false) }))
        .max(5)
        .default([]),
      /** 影片網址（預設假設 YouTube）；沒有就不要寫，課程頁不會出現影片區。 */
      videoUrl: z.url().optional(),
      /** 站內影片（業主提供的課程簡介片，放在 public/videos/）。有它時課程卡出現播放鈕，課程內頁首屏右側是這支影片（不輸出 videoUrl 的影片區）。
       *  src 是站內路徑（如 /videos/bajiquan.mp4，渲染時經過 url() 加 base）；poster 是原比例的一格（沒有 JS 時、與點了之後開始播放前顯示）；
       *  width／height 是影片像素尺寸。 */
      video: z
        .object({
          src: z.string().regex(/^\/videos\/[\w-]+\.mp4$/),
          poster: image(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          /** 課程內頁首屏影片格一開始顯示的封面（填滿 4:3 格，裁切置中）；點了才換成影片。沒給就用該課分類的字牌。 */
          cover: image().optional(),
        })
        .optional(),
      /** 授課教練（coaches 集合的 id） */
      coaches: z.array(reference('coaches')).default([]),
      /** 課程頁內的子項區塊（例如三種兵器）；description 等業主文案，可省略。 */
      subItems: z.array(z.object({ name: z.string().min(1), description: z.string().optional() })).default([]),
      /** 是否發布；false 的課不產生頁面、不出現在任何清單。 */
      published: z.boolean(),
      /** 排序（小的在前） */
      order: z.number().int(),
      /** true = 內文待業主補正式文案（搜尋 needsOwnerCopy: true 即可列出）。 */
      needsOwnerCopy: z.boolean().default(false),
    }),
});

const coaches = defineCollection({
  loader: glob({ base: './src/content/coaches', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z.object({
      /** 顯示名稱 */
      name: z.string().min(1),
      /** 職稱／角色 */
      role: z.string().min(1),
      /** 教練海報（燒了文字的 Canva 海報，只用於教練頁）。已發布的教練必填；
       *  不發布的教練不要引用圖片，否則圖檔會被打包進建置產物。 */
      poster: image().optional(),
      posterAlt: z.string().min(1).optional(),
      /** 資歷：只抄錄海報上看得到的文字，分組照海報的標題。 */
      credentials: z
        .array(z.object({ heading: z.string().min(1), items: z.array(z.string().min(1)).min(1) }))
        .default([]),
      /** 業主是否已逐條核對資歷；false 時僅供內部追蹤，不影響顯示。 */
      credentialsVerified: z.boolean().default(false),
      published: z.boolean(),
      order: z.number().int(),
    }).refine((coach) => !coach.published || Boolean(coach.poster && coach.posterAlt), {
      message: '已發布的教練必須有 poster 與 posterAlt',
      path: ['poster'],
    }),
});

export const collections = { courses, coaches };
