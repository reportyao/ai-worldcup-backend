import { z } from 'zod';

export const AiPkCreateSessionSchema = z.object({
  matchId: z.string().min(1),
  pickedSide: z.enum(['HOME', 'DRAW', 'AWAY']),
  personaCode: z.enum(['BALANCED', 'TACTICIAN', 'HYPE_FAN', 'DATA_ANALYST', 'ROASTER']).default('BALANCED'),
});

export type AiPkCreateSessionDto = z.infer<typeof AiPkCreateSessionSchema>;
