/**
 * 裝置能力（WebGL2 的 render target 格式）。模擬與光暈都靠「畫到浮點貼圖」：
 *   - 32 位元浮點（`EXT_color_buffer_float`）：模擬的首選，精度夠。
 *   - 半精度（`EXT_color_buffer_half_float` 或上面那個）：沒有 32 位元時模擬退回它（例如部分 iOS，精度較差，仍能跑）；
 *     光暈的場景 RT 是半精度，兩個擴充都沒有就不能開光暈。
 * 兩個都沒有時模擬無法運作，`createSim` 會丟錯，由呼叫端退回靜態圖。
 * 注意：會被打進引擎 chunk，所以字串只用英文。
 */

import type { WebGLRenderer } from 'three';

export const floatTargets = (renderer: WebGLRenderer): boolean => renderer.extensions.has('EXT_color_buffer_float');

export const halfFloatTargets = (renderer: WebGLRenderer): boolean => floatTargets(renderer) || renderer.extensions.has('EXT_color_buffer_half_float');
