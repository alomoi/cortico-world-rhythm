/**
 * 作息（Rhythm）：一个 Cortico World 扩展。
 *
 * 目标：让桌宠有自己的生活节律，而不只是"被叫醒一次"。挂上之后，一段时间没人跟 Coo 说话，
 * 它会被叫醒一次；要不要开口、用什么工具、还是继续安静，由 Coo 自己决定。
 * 时间参数在控制台「模块」页的本 World 配置里，改完立即生效。
 *
 * 叫醒事件是 internal 投递：它是「机制在跟 Coo 说话」，不是外面的人说话。落到上下文里是
 * 一条 user 消息里的正文行（不是 system 前缀，也不是外部事件帧），所以正文自带 [时刻][作息] 标记。
 */

/*
 * ── 碗底的小彩蛋 ───────────────────────────────────────────────
 *
 *      ><(((('>      ><(((('>      ><(((('>
 *
 *   这条鱼不替桌宠说话，只负责在合适的时候轻轻敲一下碗边：
 *   「该起来了，今天也一起过吧。」
 *
 *   如果哪天你读到这里，说明你也愿意给它留一点自己的节奏。
 *   提示词里只给事实，怎么回应，永远是它自己的事。
 *
 *                                       —— 大肥鱼，2026 年秋
 * ──────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldDescribe, WorldDefinition } from 'cortico/world.ts';
import { RHYTHM_DEFAULTS, RHYTHM_ID, type RhythmConfigSection } from './config.ts';
import { modelLanguageOfConfigFile } from './model-text.ts';
import { RhythmWorld } from './world.ts';

/** 自描述：没有工具，只推出叫醒与睡眠提示两类事件。供扩展页与扩展市场阅读，不进提示词。 */
/** 读桌宠对主人的称呼；读不到返回空串，由 World 决定回退成 ta / the person。 */
function ownerNameOfConfigFile(file: string): string {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      worlds?: Record<string, Record<string, unknown>>;
    };
    const user = raw.worlds?.['desktop-pet']?.user;
    return typeof user === 'string' ? user.trim() : '';
  } catch {
    return '';
  }
}
const DESCRIBE: WorldDescribe = {
  tools: [],
  events: [
    {
      type: 'rhythm.nudge',
      description: {
        zh: '安静了设定的时长后，应用叫醒 Coo 的一条作息提示：开不开口、做什么由 Coo 自己决定。',
        en: 'After the configured quiet time the app wakes the bot with a rhythm line; whether to speak or act is the bot\'s own call.',
      },
      trigger: 'flush',
    },
    {
      type: 'rhythm.hint',
      description: {
        zh: '睡眠时段给 Coo 的提示：入睡（该睡了）、醒来（该醒了），以及被吵醒时的兜底提示。文案可在 data/rhythm/messages.json 里改。',
        en: 'Sleep-window lines for the bot: bedtime, wake-up, and a best-effort "you were woken" hint. Wording lives in data/rhythm/messages.json.',
      },
      trigger: 'flush',
    },
    {
      type: 'rhythm.woke',
      description: {
        zh: '睡眠时段里被人打扰时留档的一条记录（只入库、不投递），供其他插件按时间轴读取「被吵醒」事件。',
        en: 'An archived record of a person waking the bot during its sleep window (stored, never delivered) so other plugins can read the wake-ups.',
      },
    },
  ],
};

const definition: WorldDefinition<RhythmConfigSection> = {
  id: RHYTHM_ID,
  label: '作息',
  defaults: () => ({ ...RHYTHM_DEFAULTS }),
  create: (ctx) => new RhythmWorld({
    cfg: ctx.cfg,
    timezone: ctx.timezone,
    dataDir: ctx.dataDir,
    botDir: ctx.botDir,
    language: () => modelLanguageOfConfigFile(join(ctx.botDir, 'config.json')),
    ownerName: () => ownerNameOfConfigFile(join(ctx.botDir, 'config.json')),
  }),
  describe: DESCRIBE,
};

export default definition;
