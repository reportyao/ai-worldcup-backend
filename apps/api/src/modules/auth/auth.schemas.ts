import { z } from 'zod';

const LocaleSchema = z.enum(['zh_CN', 'zh-CN', 'en']).transform((value) =>
  value === 'zh-CN' ? 'zh_CN' : value,
);

export const GuestIdentifySchema = z.object({
  fingerprint: z.string().trim().min(8).max(128),
  userAgent: z.string().trim().max(512).optional(),
  locale: LocaleSchema.optional().default('zh_CN'),
});
export type GuestIdentifyDto = z.infer<typeof GuestIdentifySchema>;

export const WechatLoginSchema = z.object({
  code: z.string().trim().min(1).max(256),
  guestToken: z.string().trim().optional(),
  nickname: z.string().trim().max(80).optional(),
  avatarUrl: z.string().url().optional(),
  locale: LocaleSchema.optional().default('zh_CN'),
});
export type WechatLoginDto = z.infer<typeof WechatLoginSchema>;
