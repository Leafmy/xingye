// ============================================================
// Enka 网络数据服务 (EnkaService)
//
// 直接调用 Enka REST API，不依赖第三方库
// API: GET https://enka.network/api/uid/{uid}
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { EnkaArtifact, EnkaSubStat, EnkaCharacterShowcase, EnkaUIDData } from '../types';

const ENKA_API = 'https://enka.network/api/uid/';
const CHAR_DATA_PATH = path.join(__dirname, '..', 'miao-data', 'meta-gs', 'character', 'data.json');

// FightProp ID → statType 字符串
const FIGHT_PROPS: Record<number, string> = {
  1: 'FIGHT_PROP_BASE_HP', 3: 'FIGHT_PROP_HP_PERCENT', 4: 'FIGHT_PROP_HP',
  5: 'FIGHT_PROP_BASE_ATTACK', 6: 'FIGHT_PROP_ATTACK_PERCENT', 7: 'FIGHT_PROP_ATTACK',
  8: 'FIGHT_PROP_BASE_DEFENSE', 9: 'FIGHT_PROP_DEFENSE_PERCENT', 10: 'FIGHT_PROP_DEFENSE',
  20: 'FIGHT_PROP_CRITICAL', 22: 'FIGHT_PROP_CRITICAL_HURT',
  28: 'FIGHT_PROP_ELEMENT_MASTERY', 30: 'FIGHT_PROP_CHARGE_EFFICIENCY',
  40: 'FIGHT_PROP_FIRE_ADD_HURT', 41: 'FIGHT_PROP_ELEC_ADD_HURT',
  42: 'FIGHT_PROP_WATER_ADD_HURT', 43: 'FIGHT_PROP_WIND_ADD_HURT',
  44: 'FIGHT_PROP_ROCK_ADD_HURT', 45: 'FIGHT_PROP_GRASS_ADD_HURT',
  46: 'FIGHT_PROP_ICE_ADD_HURT', 50: 'FIGHT_PROP_PHYSICAL_ADD_HURT',
  51: 'FIGHT_PROP_HEAL_ADD',
};

const EQUIP_TYPE_MAP: Record<string, string> = {
  'EQUIP_BRACER': 'flower', 'EQUIP_NECKLACE': 'plume',
  'EQUIP_SHOES': 'sands', 'EQUIP_RING': 'goblet', 'EQUIP_DRESS': 'circlet',
};

// ID → 名字映射表
const idToName: Record<number, string> = {};

export class EnkaService {

  isAvailable(): boolean { return true; }

  async init(): Promise<void> {
    // 加载 ID → 名字映射
    if (Object.keys(idToName).length === 0 && fs.existsSync(CHAR_DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(CHAR_DATA_PATH, 'utf8'));
      for (const [id, meta] of Object.entries(data)) {
        idToName[Number(id)] = (meta as any).name;
      }
      console.log(`[EnkaService] 加载 ${Object.keys(idToName).length} 个角色 ID 映射`);
    }
  }

  shutdown(): void {}

  async fetchUIDData(uid: string): Promise<EnkaUIDData | null> {
    const resp = await fetch(`${ENKA_API}${uid}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      if (resp.status === 404) throw new Error(`UID ${uid} 不存在或未开启展柜`);
      if (resp.status === 429) throw new Error('Enka API 限流，请稍后再试');
      throw new Error(`Enka API 错误: ${resp.status}`);
    }

    const raw: any = await resp.json();
    if (!raw?.avatarInfoList) return null;

    const showcase: EnkaCharacterShowcase[] = [];
    for (const info of raw.avatarInfoList) {
      try {
        showcase.push(this.parseAvatar(info));
      } catch {}
    }
    return { uid: Number(uid), showcase };
  }

  private parseAvatar(info: any): EnkaCharacterShowcase {
    const id = info.avatarId;
    const charName = idToName[id] || `角色${id}`;
    const props = info.propMap || {};

    // 天赋等级 (E/Q)
    const talents = [1, 1, 1];
    if (info.skillLevelMap) {
      const skills = Object.values(info.skillLevelMap) as number[];
      if (skills.length >= 2) { talents[1] = skills[0]; talents[2] = skills[1]; }
    }

    // 圣遗物
    const artifacts: EnkaArtifact[] = [];
    for (const item of (info.equipList || [])) {
      const flat = item.flat;
      if (!flat?.equipType || !EQUIP_TYPE_MAP[flat.equipType]) continue;

      const sub: EnkaSubStat[] = (flat.reliquarySubstats || []).map((s: any) => ({
        statType: FIGHT_PROPS[s.appendPropId] || `PROP_${s.appendPropId}`,
        statValue: s.statValue,
      }));

      artifacts.push({
        artifactId: flat.itemId,
        setName: flat.setNameText || '未知套装',
        statType: FIGHT_PROPS[flat.mainstatData?.appendPropId] || 'FIGHT_PROP_HP',
        statValue: flat.mainstatData?.statValue || 0,
        subStats: sub,
        level: flat.level || 0,
        rarity: flat.rarity || 5,
        slotKey: EQUIP_TYPE_MAP[flat.equipType] || flat.equipType,
      });
    }

    // 武器
    let weapon: any = undefined;
    for (const item of (info.equipList || [])) {
      if (item.flat?.weaponStats) {
        weapon = {
          id: item.itemId,
          name: item.flat.nameText || '未知武器',
          level: props['1001']?.val || 1,
          refinement: info.refinement || 1,
        };
        break;
      }
    }

    return {
      characterId: id,
      characterName: charName,
      level: props['4001']?.val || 1,
      constellation: Object.keys(info.proudSkillExtraLevelMap || {}).length,
      talents,
      artifacts,
      weapon,
      stats: {},
    } as any;
  }
}
