export interface SkillDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export function convertMcpToolToA2aSkill(tool: Record<string, unknown>): SkillDef;
export function getSkillCategories(): string[];
export function searchSkills(queryOrOpts?: string | Record<string, unknown>, tagsArg?: string[]): SkillDef[];
export function getSkillById(skillId: string): SkillDef | null;
export function getAllSkills(): SkillDef[];
export function refreshSkills(): Promise<number>;
declare const _default: unknown;
export default _default;
