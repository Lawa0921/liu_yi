/**
 * 試作的四項補強（純函式與常數；著色器參數與單元測試共用，不碰 three／DOM）：
 *
 *   ① 換招拖尾：點沿速度方向拉長（`streakLength`），爆開時看得出往哪裡打出去。
 *   ② 落地衝擊波：雙圈＋白閃＋鏡頭震（`shockwave`、`shockwaveSecond`、`cameraShake`），時序都以「落地後的秒數 t」為準。
 *   ③ 開場吸氣：往中心的流線（`inhaleAcc`，速度著色器裡有同一條公式），吸氣中點也沿流向拉長（`inhaleStreak`）。
 *   ④ 大槍桿與紅纓：資料在 Task 10、著色器在 `shaders/points.ts`，這裡只放點徑倍率。
 *
 * 注意：會被打進引擎 chunk，所以錯誤訊息與字串只用英文（註解可用中文）。
 */

export interface Ring {
  /** 圈的半徑（地面上的世界單位）。 */
  radius: number;
  /** 圈的寬度（高斯的特徵寬）。 */
  width: number;
  /** 亮度（加在地面光點的透明度上）。 */
  amp: number;
  /** 落地瞬間腳下的白閃強度。 */
  flash: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

// ── ② 落地衝擊波 ────────────────────────────────────────────────────

/** 第一圈：半徑 0.25 + 3.6t − 0.35t²、寬 0.12 + 0.2t、振幅 3.5·e^(−1.5t)；白閃 0.6·e^(−6t)（試作的圈，振幅由 1.6 拉到 3.5）。 */
export const SHOCK = { radius0: 0.25, speed: 3.6, decel: 0.35, width0: 0.12, widthGrow: 0.2, amp0: 3.5, ampDecay: 1.5, flash0: 0.6, flashDecay: 6 } as const;
/** 第二圈：比第一圈晚 0.12 s、振幅 ×0.6，沒有白閃。 */
export const SECOND_RING = { delay: 0.12, gain: 0.6 } as const;
/**
 * 落地的「啪」：彈簧 ×2.2 的那 0.5 s（`forcesFor` 的 `snap`），阻尼同步 ×√2.2（阻尼比不變）。只加彈簧不加阻尼，
 * 從抬腳落回站姿時光點會衝過目標再彈回來（腳陷進地面、人形被拉長），不是「定住」。
 */
export const SNAP_DAMP_GAIN = Math.sqrt(2.2);
/** 鏡頭震：試作 0.05、落地要更強所以 0.08；`decay` 是指數衰減率，`duration` 秒後歸零（之後不再震）。 */
export const CAMERA_SHAKE = { amplitude: 0.08, decay: 9, duration: 0.8 } as const;

/** 第一圈在落地後 `t` 秒的狀態。`t < 0`（還沒落地）或非有限：振幅與白閃為 0，半徑與寬度停在起點。 */
export function shockwave(t: number): Ring {
  const landed = Number.isFinite(t) && t >= 0;
  const s = landed ? t : 0;
  return {
    radius: SHOCK.radius0 + SHOCK.speed * s - SHOCK.decel * s * s,
    width: SHOCK.width0 + SHOCK.widthGrow * s,
    amp: landed ? SHOCK.amp0 * Math.exp(-SHOCK.ampDecay * s) : 0,
    flash: landed ? SHOCK.flash0 * Math.exp(-SHOCK.flashDecay * s) : 0,
  };
}

/** 第二圈在落地後 `t` 秒的狀態：就是第一圈在 `t − 0.12` 的狀態，振幅 ×0.6，沒有白閃。 */
export function shockwaveSecond(t: number): Ring {
  const ring = shockwave(t - SECOND_RING.delay);
  return { ...ring, amp: ring.amp * SECOND_RING.gain, flash: 0 };
}

/** 落地後 `t` 秒的鏡頭震幅（世界單位）；還沒落地、已過 `duration` 或非有限都是 0。 */
export function cameraShake(t: number): number {
  if (!Number.isFinite(t) || t < 0 || t >= CAMERA_SHAKE.duration) return 0;
  return CAMERA_SHAKE.amplitude * Math.exp(-CAMERA_SHAKE.decay * t);
}

// ── ① 換招拖尾 ──────────────────────────────────────────────────────

/**
 * 速度 → 拉長倍數：`speed × 0.25` 夾在 0–1（與點著色器的 `speed` 同一把尺），最多再加 2.6 倍。
 * `aspect`：橢圓的長寬比隨拉長倍數增加的比例（比例 = 1 + (倍數 − 1) × aspect），只影響畫出來的形狀，不是速度的函數。
 */
export const STREAK = { speedScale: 0.25, gain: 2.6, aspect: 2 } as const;

/** 沿速度方向拉長的倍數：`1 + clamp(speed·0.25, 0, 1)·2.6`。不動 = 1，速度 ≥ 4 封頂 3.6；負值與非有限不拉長。 */
export function streakLength(speed: number): number {
  if (!(speed > 0)) return 1;
  return 1 + clamp(speed * STREAK.speedScale, 0, 1) * STREAK.gain;
}

/**
 * 換招衝量之後光點速度的估計（世界單位／秒）：衝量的初速約 `power × kick`，之後照模擬的阻尼指數衰減。
 * 只用來決定 `uStreak`（拖尾倍數的上限），GPU 不必讀回；真正每顆的拉長仍由它自己的速度決定。
 */
export const BURST = { kick: 2, damp: 5.5 } as const;

export function burstSpeed(power: number, sinceBurst: number): number {
  if (!Number.isFinite(power) || !Number.isFinite(sinceBurst) || power <= 0 || sinceBurst < 0) return 0;
  return power * BURST.kick * Math.exp(-BURST.damp * sinceBurst);
}

// ── ③ 開場吸氣 ──────────────────────────────────────────────────────

/**
 * 吐氣（開場的「散開」）：用 `BURSTS.lift` 的方向與模式，力道乘上 `gain`。試作的吸氣是從 3–9 個單位外的亂雲開始，
 * 這裡只有 0.4 s 的吐氣，散得太近就沒有一段可以流回來的路，吸氣看不出流線。
 */
export const EXHALE = { gain: 2.2 } as const;

/**
 * 吸氣：`pull` 向心加速度的基準（世界單位／秒²）、`floor` 離中心很近時的保底比例、`reach` 到這個距離才算「很遠」、
 * `swirl` 繞 y 軸的切向加速度（少量，讓流線帶一點旋轉）、`softening` 切向分母的軟化量（避免中心附近發散）、
 * `streak` 吸氣中點拖尾倍數的上限增量、`dampEnd` 吸氣結束時的阻尼（見 `inhaleDamp`）、
 * `peak` 吸氣強度的包絡在進度的哪裡最強（見 `inhaleEnvelope`）。
 */
export const INHALE = { pull: 11, floor: 0.35, reach: 3, swirl: 2.2, softening: 0.3, streak: 2, dampEnd: 6, peak: 0.3 } as const;
/** 包絡的進度指數：讓 `t = peak` 剛好是 `sin` 的頂點（`peak ^ exponent = 0.5`）。 */
export const INHALE_EXPONENT = Math.log(0.5) / Math.log(INHALE.peak);

/**
 * 吸氣進度的包絡：頭尾 0（與前後階段接得上），在 `INHALE.peak`（前段）最強。強度不能留到後段：
 * 後段彈簧已經很強，再往中心拉會把光點拉過它們在人形上的位置（人形有寬度），然後被彈簧推回去，徑向速度轉負。
 */
const inhaleEnvelope = (t: number): number =>
  Number.isFinite(t) && t > 0 && t < 1 ? Math.sin(Math.PI * Math.pow(t, INHALE_EXPONENT)) : 0;

/**
 * 吸氣加速度：`p` 是光點相對於中心的位置，`t` 是吸氣進度 0–1。往中心（`|p|` 越遠越強），加一點繞 y 軸的旋轉。
 * 速度著色器（`shaders/velocity.ts`）有同一條公式；改這裡要連同著色器一起改。
 */
export function inhaleAcc(p: [number, number, number], t: number): [number, number, number] {
  const env = inhaleEnvelope(t);
  const r = Math.hypot(p[0], p[1], p[2]);
  const pull = INHALE.pull * (INHALE.floor + (1 - INHALE.floor) * smoothstep(0, INHALE.reach, r)) * env;
  const toward = pull / (r + 1e-3);
  const swirl = (INHALE.swirl * env) / (r + INHALE.softening);
  // 切向 = up × p = (p.z, 0, −p.x)
  return [-p[0] * toward + p[2] * swirl, -p[1] * toward, -p[2] * toward - p[0] * swirl];
}

/**
 * 吸氣階段的阻尼：從 `base`（開場期間 3，讓光點飄得開）隨進度升到 `INHALE.dampEnd`。吸氣後段彈簧漸強，
 * 阻尼不跟著加，光點會衝過目標再彈回去（徑向速度轉負）；加大阻尼才是一路往中心流到定位。
 */
export function inhaleDamp(base: number, t: number): number {
  const u = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  return base + (INHALE.dampEnd - base) * (u * u * (3 - 2 * u));
}

/** 吸氣中點拖尾倍數的上限（`uStreak`）：頭尾 1 倍、`peak` 處最長（`1 + streak`）。 */
export function inhaleStreak(t: number): number {
  return 1 + INHALE.streak * inhaleEnvelope(t);
}

// ── ④ 大槍桿與紅纓 ──────────────────────────────────────────────────

/** 紅纓（RED）與桿（DARK）的點徑倍率：加大 15%，讓桿看得出粗細、纓看得出是紅的。 */
export const THICK_KIND_SCALE = 1.15;
