/**
 * 自主发言（Self-talk）：一个 Cortico World 扩展。
 *
 * 挂上之后，一段时间没人跟 Coo 说话，它会被叫醒一次；要不要开口、用什么工具、
 * 还是继续安静，由 Coo 自己决定。时间参数在控制台「模块」页的本 World 配置里，
 * 改完立即生效。
 *
 * 叫醒事件是 internal 投递：它是「机制在跟 Coo 说话」，不是外面的人说话，
 * 落到上下文里的位置和系统提示一样，而不是外部事件帧。
 */
import { join } from 'node:path';
import type { WorldDescribe, WorldDefinition } from 'cortico/world.ts';
import { SELFTALK_DEFAULTS, SELFTALK_ID, type SelfTalkConfigSection } from './config.ts';
import { modelLanguageOfConfigFile } from './model-text.ts';
import { SelfTalkWorld } from './world.ts';

/** 自描述：没有工具，只推出叫醒事件。供扩展页与扩展市场阅读，不进提示词。 */
const DESCRIBE: WorldDescribe = {
  tools: [],
  events: [
    {
      type: 'selftalk.nudge',
      description: {
        zh: '安静了设定的时长后，应用叫醒 Coo 的一条自主发言提示：开不开口、做什么由 Coo 自己决定。',
        en: 'After the configured quiet time the app wakes the bot with a self-talk line; whether to speak or act is the bot\'s own call.',
      },
      trigger: 'flush',
    },
  ],
};

const definition: WorldDefinition<SelfTalkConfigSection> = {
  id: SELFTALK_ID,
  label: '自主发言',
  defaults: () => ({ ...SELFTALK_DEFAULTS }),
  create: (ctx) => new SelfTalkWorld({
    cfg: ctx.cfg,
    timezone: ctx.timezone,
    language: () => modelLanguageOfConfigFile(join(ctx.botDir, 'config.json')),
  }),
  describe: DESCRIBE,
};

export default definition;
