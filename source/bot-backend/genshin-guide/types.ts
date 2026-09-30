// ============================================================
// 原神角色攻略与圣遗物评分系统 — 类型定义
// ============================================================

// ============ 云崽元数据类型 ============

/** 全局圣遗物评分权重 (来自 artis-mark.js 的 usefulAttr) */
export interface ArtifactWeight {
  hp: number;
  atk: number;
  def: number;
  cpct: number;    // 暴击率
  cdmg: number;    // 暴击伤害
  mastery: number; // 元素精通
  dmg: number;      // 元素伤害加成
  phy: number;      // 物理伤害加成
  recharge: number; // 充能效率
  heal: number;     // 治疗加成
}

/** 云崽角色元数据 (从顶层 data.json 读取) */
export interface MiaoCharacterMeta {
  id: number;
  name: string;
  abbr: string;
  star: number;
  elem: string;
  weapon: string;
  talentId?: Record<string, number>;
  talentCons?: Record<string, number>;
  eta?: number;
}

/** 云崽单角色完整数据 (从角色目录 data.json 读取) */
export interface MiaoCharacterData extends MiaoCharacterMeta {
  title?: string;
  birth?: string;
  astro?: string;
  desc?: string;
  cncv?: string;
  jpcv?: string;
  costume?: string[];
  ver?: string;
  allegiance?: string;
  baseAttr?: { hp: number; atk: number; def: number };
  growAttr?: { key: string; value: number };
  talent?: Record<string, MiaoTalent>;
  materials?: string[];
}

/** 角色天赋数据 */
export interface MiaoTalent {
  id: number;
  name: string;
  desc?: string;
  tables?: MiaoTalentTable[];
}

export interface MiaoTalentTable {
  name: string;
  values: number[];
}

// ============ 云崽 calc.js 导出类型 ============

export interface MiaoCalcExport {
  details: MiaoCalcDetail[];
  defDmgIdx?: number;
  mainAttr?: string;
  buffs: (MiaoCalcBuff | string)[];
}

export interface MiaoCalcDetail {
  title: string;
  params?: Record<string, any>;
  dmgKey?: string;
}

export interface MiaoCalcBuff {
  title: string;
  sort?: number;
  cons?: number;
  data: Record<string, number | string>;
}

// ============ Enka 网络类型 ============

export interface EnkaArtifact {
  artifactId: number;
  setName: string;
  statType: string;
  statValue: number;
  subStats: EnkaSubStat[];
  level: number;
  rarity: number;
  slotKey: string; // flower | plume | sands | goblet | circlet
}

export interface EnkaSubStat {
  statType: string;
  statValue: number;
  appendPropId?: number;
}

export interface EnkaCharacterShowcase {
  characterId: number;
  characterName?: string;
  level: number;
  constellation: number;
  talents: number[];
  artifacts: EnkaArtifact[];
  weapon?: {
    id: number;
    name: string;
    level: number;
    refinement: number;
  };
  stats?: Record<string, number>;
}

export interface EnkaUIDData {
  uid: number;
  showcase: EnkaCharacterShowcase[];
}

// ============ 评分结果 ============

export interface ArtifactScoreResult {
  totalScore: number;        // 0-100
  grade: 'ACE' | 'SS' | 'S' | 'A' | 'B' | 'C';
  subStatScores: SubStatScore[];
  effectiveStats: string[];  // 有效词条描述
}

export interface SubStatScore {
  statType: string;
  statValue: number;
  weight: number;
  score: number;
  label: string;
}

/** 一套圣遗物 (5件) 的综合评分 */
export interface ArtifactSetScore {
  totalScore: number;
  averageScore: number;
  grade: ArtifactScoreResult['grade'];
  details: ArtifactScoreResult[];
}

// ============ 面板渲染类型 ============

/** 面板渲染所需的角色完整数据 */
export interface PanelData {
  // 基础信息
  uid: string;
  characterName: string;
  characterId: number;
  level: number;
  constellation: number;
  star: number;
  elem: string;

  // 天赋
  talents: { a: number; e: number; q: number };

  // 武器
  weapon: {
    name: string;
    level: number;
    star: number;
    affix: number;
  };

  // 属性 (含基础 + 加成)
  stats: {
    hp: { base: number; bonus: number; total: number };
    atk: { base: number; bonus: number; total: number };
    def: { base: number; bonus: number; total: number };
    mastery: { base: number; bonus: number; total: number };
    cpct: { base: number; bonus: number; total: number };
    cdmg: { base: number; bonus: number; total: number };
    recharge: { base: number; bonus: number; total: number };
    dmgBonus: { base: number; bonus: number; total: number };
  };

  // 圣遗物
  artifacts: PanelArtifact[];

  // 圣遗物评分
  score: ArtifactSetScore;

  // 伤害计算结果 (简化版)
  damages: DamageResult[];
}

/** 面板中的单件圣遗物 */
export interface PanelArtifact {
  slotKey: string;
  setName: string;
  level: number;
  rarity: number;
  mainStat: { type: string; value: number; label: string };
  subStats: Array<{ type: string; value: number; label: string; weight: number }>;
  score: ArtifactScoreResult;
}

/** 伤害计算结果 */
export interface DamageResult {
  title: string;
  critDamage: number;
  expectedDamage: number;
  isHeal?: boolean;
}

// ============ 攻略数据聚合 ============

export interface GuideData {
  character: MiaoCharacterData;
  weights: ArtifactWeight;
  buildName?: string;
  recommendedWeapons?: string[];
  recommendedArtifacts?: string[];
  scoreResults?: ArtifactScoreResult[];
  enkaData?: EnkaCharacterShowcase;
}

// ============ UID 绑定类型 ============

export interface UIDBinding {
  platform: string;   // 'gs'
  accountId: string;  // UID
  label: string;
  boundAt: string;
}

// ============ Facade 接口 ============

export interface GuideCommandResult {
  type: 'text' | 'image';
  data: string | Buffer;
}
