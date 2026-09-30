// ============================================================
// LiangshiService — Enka 数据转换 + 简化伤害计算
//
// 将 Enka API 的 Character 对象转换为面板渲染所需的 PanelData
// ============================================================

import { EnkaCharacterShowcase, EnkaArtifact, PanelData, PanelArtifact, DamageResult, ArtifactScoreResult, ArtifactWeight } from '../types';
import { ArtifactEvaluator } from './ArtifactEvaluator';
import { MiaoGuideService } from './MiaoGuideService';

/** Enka statType → 中文标签 */
const STAT_LABELS: Record<string, string> = {
  'FIGHT_PROP_HP': '生命值', 'FIGHT_PROP_HP_PERCENT': '生命值%',
  'FIGHT_PROP_ATTACK': '攻击力', 'FIGHT_PROP_ATTACK_PERCENT': '攻击力%',
  'FIGHT_PROP_DEFENSE': '防御力', 'FIGHT_PROP_DEFENSE_PERCENT': '防御力%',
  'FIGHT_PROP_CRITICAL': '暴击率', 'FIGHT_PROP_CRITICAL_RATE': '暴击率',
  'FIGHT_PROP_CRITICAL_HURT': '暴击伤害',
  'FIGHT_PROP_ELEMENT_MASTERY': '元素精通', 'FIGHT_PROP_ELEM_MASTERY': '元素精通',
  'FIGHT_PROP_CHARGE_EFFICIENCY': '充能效率',
  'FIGHT_PROP_HEAL_ADD': '治疗加成',
  'FIGHT_PROP_PHYSICAL_ADD_HURT': '物伤加成',
  'FIGHT_PROP_FIRE_ADD_HURT': '火伤加成', 'FIGHT_PROP_ELEC_ADD_HURT': '雷伤加成',
  'FIGHT_PROP_WATER_ADD_HURT': '水伤加成', 'FIGHT_PROP_WIND_ADD_HURT': '风伤加成',
  'FIGHT_PROP_ROCK_ADD_HURT': '岩伤加成', 'FIGHT_PROP_ICE_ADD_HURT': '冰伤加成',
  'FIGHT_PROP_GRASS_ADD_HURT': '草伤加成',
};

/** 圣遗物槽位中文名 */
const SLOT_NAMES: Record<string, string> = {
  flower: '生之花', plume: '死之羽', sands: '时之沙', goblet: '空之杯', circlet: '理之冠',
};

const evaluator = new ArtifactEvaluator();

export class LiangshiService {

  /**
   * 将 Enka 角色数据转换为面板渲染数据
   */
  convertToPanelData(
    showcase: EnkaCharacterShowcase,
    uid: string,
    miaoService: MiaoGuideService
  ): PanelData | null {
    // 角色元数据
    const charName = (showcase as any).characterName || '';
    const meta = this.findCharacterMeta(charName, miaoService);
    const weights = miaoService.getArtifactWeights(charName);

    // 天赋
    const talents = {
      a: showcase.talents?.[0] || 1,
      e: showcase.talents?.[1] || 1,
      q: showcase.talents?.[2] || 1,
    };

    // 属性计算 (从 Enka stats 或圣遗物推算)
    const stats = this.extractStats(showcase);

    // 圣遗物
    const artifacts = this.convertArtifacts(showcase.artifacts, weights);

    // 圣遗物评分
    const score = weights
      ? evaluator.evaluateSet(showcase.artifacts, weights)
      : { totalScore: 0, averageScore: 0, grade: 'C' as const, details: [] };

    // 简化伤害计算
    const damages = this.calcSimpleDamages(stats, talents, showcase);

    return {
      uid,
      characterName: charName,
      characterId: showcase.characterId,
      level: showcase.level,
      constellation: showcase.constellation,
      star: meta?.star || 5,
      elem: meta?.elem || 'pyro',
      talents,
      weapon: showcase.weapon ? {
        name: showcase.weapon.name,
        level: showcase.weapon.level,
        star: 5,
        affix: showcase.weapon.refinement,
      } : { name: '未知', level: 1, star: 3, affix: 1 },
      stats,
      artifacts,
      score,
      damages,
    };
  }

  /** 查找角色元数据 */
  private findCharacterMeta(name: string, miaoService: MiaoGuideService): any {
    // 通过别名解析后的名字查找
    const allNames = miaoService.getAllCharacterNames();
    if (allNames.includes(name)) return { name };
    return null;
  }

  /** 从 Enka 数据提取属性 */
  private extractStats(showcase: EnkaCharacterShowcase): PanelData['stats'] {
    const stats = showcase.stats || {};

    // Enka stats 使用 FIGHT_PROP_* 作为 key
    const get = (key: string, fallback = 0) => stats[key] || fallback;

    // 基础属性 (从武器和角色基础值估算)
    const baseAtk = 100; // 简化: 实际应从角色基础值 + 武器基础值计算
    const baseHp = 1000;
    const baseDef = 100;

    // 百分比属性转换为实际值
    const hpFlat = get('FIGHT_PROP_HP');
    const hpPct = get('FIGHT_PROP_HP_PERCENT');
    const atkFlat = get('FIGHT_PROP_ATTACK');
    const atkPct = get('FIGHT_PROP_ATTACK_PERCENT');
    const defFlat = get('FIGHT_PROP_DEFENSE');
    const defPct = get('FIGHT_PROP_DEFENSE_PERCENT');

    return {
      hp: {
        base: Math.round(baseHp),
        bonus: Math.round(hpFlat + baseHp * hpPct),
        total: Math.round(baseHp + hpFlat + baseHp * hpPct),
      },
      atk: {
        base: Math.round(baseAtk),
        bonus: Math.round(atkFlat + baseAtk * atkPct),
        total: Math.round(baseAtk + atkFlat + baseAtk * atkPct),
      },
      def: {
        base: Math.round(baseDef),
        bonus: Math.round(defFlat + baseDef * defPct),
        total: Math.round(baseDef + defFlat + baseDef * defPct),
      },
      mastery: {
        base: 0,
        bonus: Math.round(get('FIGHT_PROP_ELEMENT_MASTERY') || get('FIGHT_PROP_ELEM_MASTERY')),
        total: Math.round(get('FIGHT_PROP_ELEMENT_MASTERY') || get('FIGHT_PROP_ELEM_MASTERY')),
      },
      cpct: {
        base: 5,
        bonus: Math.round((get('FIGHT_PROP_CRITICAL') || get('FIGHT_PROP_CRITICAL_RATE')) * 10) / 10,
        total: Math.round((5 + (get('FIGHT_PROP_CRITICAL') || get('FIGHT_PROP_CRITICAL_RATE'))) * 10) / 10,
      },
      cdmg: {
        base: 50,
        bonus: Math.round(get('FIGHT_PROP_CRITICAL_HURT') * 10) / 10,
        total: Math.round((50 + get('FIGHT_PROP_CRITICAL_HURT')) * 10) / 10,
      },
      recharge: {
        base: 100,
        bonus: Math.round(get('FIGHT_PROP_CHARGE_EFFICIENCY') * 10) / 10,
        total: Math.round((100 + get('FIGHT_PROP_CHARGE_EFFICIENCY')) * 10) / 10,
      },
      dmgBonus: {
        base: 0,
        bonus: Math.round(
          (get('FIGHT_PROP_FIRE_ADD_HURT') + get('FIGHT_PROP_ELEC_ADD_HURT') +
           get('FIGHT_PROP_WATER_ADD_HURT') + get('FIGHT_PROP_WIND_ADD_HURT') +
           get('FIGHT_PROP_ROCK_ADD_HURT') + get('FIGHT_PROP_ICE_ADD_HURT') +
           get('FIGHT_PROP_GRASS_ADD_HURT') + get('FIGHT_PROP_PHYSICAL_ADD_HURT'))
          * 10
        ) / 10,
        total: Math.round(
          (get('FIGHT_PROP_FIRE_ADD_HURT') + get('FIGHT_PROP_ELEC_ADD_HURT') +
           get('FIGHT_PROP_WATER_ADD_HURT') + get('FIGHT_PROP_WIND_ADD_HURT') +
           get('FIGHT_PROP_ROCK_ADD_HURT') + get('FIGHT_PROP_ICE_ADD_HURT') +
           get('FIGHT_PROP_GRASS_ADD_HURT') + get('FIGHT_PROP_PHYSICAL_ADD_HURT'))
          * 10
        ) / 10,
      },
    };
  }

  /** 转换圣遗物数据 */
  private convertArtifacts(artifacts: EnkaArtifact[], weights: ArtifactWeight | null): PanelArtifact[] {
    return artifacts.map(art => {
      const score = weights
        ? evaluator.evaluateSingle(art, weights)
        : { totalScore: 0, grade: 'C' as const, subStatScores: [], effectiveStats: [] };

      return {
        slotKey: art.slotKey,
        setName: art.setName,
        level: art.level,
        rarity: art.rarity,
        mainStat: {
          type: art.statType,
          value: art.statValue,
          label: STAT_LABELS[art.statType] || art.statType,
        },
        subStats: art.subStats.map(sub => ({
          type: sub.statType,
          value: sub.statValue,
          label: STAT_LABELS[sub.statType] || sub.statType,
          weight: weights ? ((weights as any)[this.statToWeightKey(sub.statType)] || 0) : 0,
        })),
        score,
      };
    });
  }

  /** statType → weight key */
  private statToWeightKey(statType: string): string {
    const map: Record<string, string> = {
      'FIGHT_PROP_HP': 'hp', 'FIGHT_PROP_HP_PERCENT': 'hp',
      'FIGHT_PROP_ATTACK': 'atk', 'FIGHT_PROP_ATTACK_PERCENT': 'atk',
      'FIGHT_PROP_DEFENSE': 'def', 'FIGHT_PROP_DEFENSE_PERCENT': 'def',
      'FIGHT_PROP_CRITICAL': 'cpct', 'FIGHT_PROP_CRITICAL_RATE': 'cpct',
      'FIGHT_PROP_CRITICAL_HURT': 'cdmg',
      'FIGHT_PROP_ELEMENT_MASTERY': 'mastery', 'FIGHT_PROP_ELEM_MASTERY': 'mastery',
      'FIGHT_PROP_CHARGE_EFFICIENCY': 'recharge',
      'FIGHT_PROP_HEAL_ADD': 'heal',
      'FIGHT_PROP_PHYSICAL_ADD_HURT': 'phy',
    };
    return map[statType] || '';
  }

  /** 简化伤害计算 (基于属性面板估算) */
  private calcSimpleDamages(
    stats: PanelData['stats'],
    talents: { a: number; e: number; q: number },
    showcase: EnkaCharacterShowcase
  ): DamageResult[] {
    const atk = stats.atk.total;
    const cpct = stats.cpct.total / 100;
    const cdmg = stats.cdmg.total / 100;
    const dmgBonus = stats.dmgBonus.total / 100;

    // 简化倍率 (实际应从天赋数据读取)
    const talentMultipliers = {
      a: 0.5 + talents.a * 0.05,   // 约 50%-100% based on talent level
      e: 0.8 + talents.e * 0.08,   // 约 80%-160%
      q: 1.2 + talents.q * 0.1,    // 约 120%-220%
    };

    const results: DamageResult[] = [];

    // 普攻伤害
    const aBase = atk * talentMultipliers.a * (1 + dmgBonus);
    results.push({
      title: '普攻伤害',
      critDamage: Math.round(aBase * (1 + cdmg)),
      expectedDamage: Math.round(aBase * (1 + cpct * cdmg)),
    });

    // E 技能伤害
    const eBase = atk * talentMultipliers.e * (1 + dmgBonus);
    results.push({
      title: 'E技能伤害',
      critDamage: Math.round(eBase * (1 + cdmg)),
      expectedDamage: Math.round(eBase * (1 + cpct * cdmg)),
    });

    // Q 技能伤害
    const qBase = atk * talentMultipliers.q * (1 + dmgBonus);
    results.push({
      title: 'Q技能伤害',
      critDamage: Math.round(qBase * (1 + cdmg)),
      expectedDamage: Math.round(qBase * (1 + cpct * cdmg)),
    });

    return results;
  }
}
