// ============================================================
// 模块 B: 低耦合圣遗物评分引擎 (ArtifactEvaluator)
//
// 评分算法:
// 1. 读取 artis-mark.js 的 usefulAttr 权重表
// 2. 对每条副词条: 有效分 = (实际值 / 基础值) × (权重 / 100)
// 3. 单件总分归一化到 0-100
// 4. 评级: ACE(≥80) / SS(≥65) / S(≥50) / A(≥35) / B(≥20) / C(<20)
// ============================================================

import { EnkaArtifact, EnkaSubStat, ArtifactWeight, ArtifactScoreResult, ArtifactSetScore, SubStatScore } from '../types';

// ============ 副词条映射表 ============

/**
 * Enka statType → { 中文标签, 每次强化基础值 }
 *
 * 注意: enka-network-api 使用:
 *   FIGHT_PROP_CRITICAL        (暴击率, 不是 CRITICAL_RATE)
 *   FIGHT_PROP_ELEMENT_MASTERY (元素精通, 不是 ELEM_MASTERY)
 * 同时兼容两种命名
 */
const SUB_STAT_TABLE: Record<string, { label: string; baseValue: number }> = {
  'FIGHT_PROP_HP':                  { label: '生命值',   baseValue: 298.75 },
  'FIGHT_PROP_HP_PERCENT':          { label: '生命值%',  baseValue: 5.1 },
  'FIGHT_PROP_ATTACK':              { label: '攻击力',   baseValue: 19.45 },
  'FIGHT_PROP_ATTACK_PERCENT':      { label: '攻击力%',  baseValue: 5.1 },
  'FIGHT_PROP_DEFENSE':             { label: '防御力',   baseValue: 23.15 },
  'FIGHT_PROP_DEFENSE_PERCENT':     { label: '防御力%',  baseValue: 6.6 },
  'FIGHT_PROP_CRITICAL_RATE':       { label: '暴击率',   baseValue: 3.3 },
  'FIGHT_PROP_CRITICAL':            { label: '暴击率',   baseValue: 3.3 },
  'FIGHT_PROP_CRITICAL_HURT':       { label: '暴击伤害', baseValue: 6.6 },
  'FIGHT_PROP_CHARGE_EFFICIENCY':   { label: '充能效率', baseValue: 6.5 },
  'FIGHT_PROP_ELEM_MASTERY':        { label: '元素精通', baseValue: 23.31 },
  'FIGHT_PROP_ELEMENT_MASTERY':     { label: '元素精通', baseValue: 23.31 },
  'FIGHT_PROP_HEAL_ADD':            { label: '治疗加成', baseValue: 0 },
  'FIGHT_PROP_PHYSICAL_ADD_HURT':   { label: '物伤加成', baseValue: 0 },
  'FIGHT_PROP_FIRE_ADD_HURT':       { label: '火伤加成', baseValue: 0 },
  'FIGHT_PROP_ELEC_ADD_HURT':       { label: '雷伤加成', baseValue: 0 },
  'FIGHT_PROP_WATER_ADD_HURT':      { label: '水伤加成', baseValue: 0 },
  'FIGHT_PROP_WIND_ADD_HURT':       { label: '风伤加成', baseValue: 0 },
  'FIGHT_PROP_ROCK_ADD_HURT':       { label: '岩伤加成', baseValue: 0 },
  'FIGHT_PROP_ICE_ADD_HURT':        { label: '冰伤加成', baseValue: 0 },
  'FIGHT_PROP_GRASS_ADD_HURT':      { label: '草伤加成', baseValue: 0 },
};

/** Enka statType → ArtifactWeight key (兼容两种命名) */
const STAT_TO_WEIGHT_KEY: Record<string, keyof ArtifactWeight> = {
  'FIGHT_PROP_HP':                  'hp',
  'FIGHT_PROP_HP_PERCENT':          'hp',
  'FIGHT_PROP_ATTACK':              'atk',
  'FIGHT_PROP_ATTACK_PERCENT':      'atk',
  'FIGHT_PROP_DEFENSE':             'def',
  'FIGHT_PROP_DEFENSE_PERCENT':     'def',
  'FIGHT_PROP_CRITICAL_RATE':       'cpct',
  'FIGHT_PROP_CRITICAL':            'cpct',
  'FIGHT_PROP_CRITICAL_HURT':       'cdmg',
  'FIGHT_PROP_ELEM_MASTERY':        'mastery',
  'FIGHT_PROP_ELEMENT_MASTERY':     'mastery',
  'FIGHT_PROP_CHARGE_EFFICIENCY':   'recharge',
  'FIGHT_PROP_HEAL_ADD':            'heal',
  'FIGHT_PROP_PHYSICAL_ADD_HURT':   'phy',
  'FIGHT_PROP_FIRE_ADD_HURT':       'dmg',
  'FIGHT_PROP_ELEC_ADD_HURT':       'dmg',
  'FIGHT_PROP_WATER_ADD_HURT':      'dmg',
  'FIGHT_PROP_WIND_ADD_HURT':       'dmg',
  'FIGHT_PROP_ROCK_ADD_HURT':       'dmg',
  'FIGHT_PROP_ICE_ADD_HURT':        'dmg',
  'FIGHT_PROP_GRASS_ADD_HURT':      'dmg',
};

// ============ 评分引擎 ============

export class ArtifactEvaluator {

  /** 评估一套圣遗物 (5件) */
  evaluateSet(artifacts: EnkaArtifact[], weights: ArtifactWeight): ArtifactSetScore {
    const details = artifacts.map(a => this.evaluateSingle(a, weights));
    const totalScore = details.reduce((sum, d) => sum + d.totalScore, 0);
    const averageScore = details.length > 0 ? totalScore / details.length : 0;

    return {
      totalScore: Math.round(totalScore * 10) / 10,
      averageScore: Math.round(averageScore * 10) / 10,
      grade: getGrade(averageScore),
      details,
    };
  }

  /** 评估单件圣遗物 */
  evaluateSingle(artifact: EnkaArtifact, weights: ArtifactWeight): ArtifactScoreResult {
    const subStatScores: SubStatScore[] = [];
    let totalScore = 0;

    for (const sub of artifact.subStats) {
      const weightKey = STAT_TO_WEIGHT_KEY[sub.statType];
      const weight = weightKey ? (weights[weightKey] || 0) : 0;
      const meta = SUB_STAT_TABLE[sub.statType];
      const label = meta?.label || sub.statType;
      const baseValue = meta?.baseValue || 1;

      // 有效词条分 = (实际值 / 每次强化基础值) × (权重 / 100)
      // 权重=100 时, 一次满强化 (baseValue) 得 1 分
      const effectiveValue = weight > 0
        ? (sub.statValue / baseValue) * (weight / 100)
        : 0;

      totalScore += effectiveValue;

      subStatScores.push({
        statType: sub.statType,
        statValue: sub.statValue,
        weight,
        score: Math.round(effectiveValue * 100) / 100,
        label,
      });
    }

    // 归一化到 0-100
    // 理论最高: 4条副词条全部命中同一条, 5次强化全中, 权重100
    // 大约 = 4 × (5 × 1) × 1 = 20, 但实际中不可能
    // 取 6 为满分数值基准 (实际中约 4-5 已是极品)
    const normalizedScore = Math.min(100, (totalScore / 6) * 100);

    const sortedScores = [...subStatScores].sort((a, b) => b.score - a.score);

    return {
      totalScore: Math.round(normalizedScore * 10) / 10,
      grade: getGrade(normalizedScore),
      subStatScores: sortedScores,
      effectiveStats: sortedScores
        .filter(s => s.weight > 0)
        .map(s => `${s.label}+${formatStatValue(s.statType, s.statValue)}`),
    };
  }

  /** 获取中文标签 (外部可用) */
  getStatLabel(statType: string): string {
    return SUB_STAT_TABLE[statType]?.label || statType;
  }
}

// ============ 辅助函数 ============

function getGrade(score: number): ArtifactScoreResult['grade'] {
  if (score >= 80) return 'ACE';
  if (score >= 65) return 'SS';
  if (score >= 50) return 'S';
  if (score >= 35) return 'A';
  if (score >= 20) return 'B';
  return 'C';
}

/** 格式化副词条数值 (百分比型带 %) */
function formatStatValue(statType: string, value: number): string {
  const isPercent = statType.endsWith('_PERCENT')
    || statType === 'FIGHT_PROP_CRITICAL_RATE'
    || statType === 'FIGHT_PROP_CRITICAL'        // enka-network-api 命名
    || statType === 'FIGHT_PROP_CRITICAL_HURT'
    || statType === 'FIGHT_PROP_CHARGE_EFFICIENCY';
  if (isPercent) {
    return `${value.toFixed(1)}%`;
  }
  return String(Math.round(value));
}
