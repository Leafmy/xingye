// ============================================================
// 模块 A: 云崽元数据动态解析器 (MiaoGuideService)
//
// 职责:
// - 动态加载 miao-data/ 下的 JSON / JS 文件
// - 构建 角色名 → 数据 映射表
// - 别名解析 (中文名 / 英文名 / 昵称)
// - 导出圣遗物评分权重
// ============================================================

import fs from 'fs';
import path from 'path';
import {
  MiaoCharacterMeta,
  MiaoCharacterData,
  ArtifactWeight,
  MiaoCalcExport,
} from '../types';

const MIAO_DATA_DIR = path.join(__dirname, '..', 'miao-data', 'meta-gs');

export class MiaoGuideService {
  // ---- 内部缓存 ----
  private characterRegistry: Map<number, MiaoCharacterMeta> = new Map();
  private characterDataCache: Map<string, MiaoCharacterData> = new Map();
  private artifactWeights: Map<string, ArtifactWeight> = new Map();
  private aliasMap: Map<string, string> = new Map(); // alias → officialName
  private loaded = false;

  // ==================== 初始化 ====================

  /** 初始化: 加载所有元数据文件 */
  async init(): Promise<void> {
    if (this.loaded) return;

    await this.loadCharacterRegistry();
    await this.loadArtifactWeights();
    await this.loadAliases();

    this.loaded = true;
    console.log(
      `[MiaoGuide] 初始化完成: ` +
      `${this.characterRegistry.size} 个角色, ` +
      `${this.artifactWeights.size} 个评分权重, ` +
      `${this.aliasMap.size} 个别名`
    );
  }

  // ==================== 公开方法 ====================

  /** 解析角色名: 支持中文名 / 缩写 / 英文别名 / 昵称 */
  resolveCharacterName(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // 1. 精确匹配中文名
    for (const [, meta] of this.characterRegistry) {
      if (meta.name === trimmed || meta.abbr === trimmed) {
        return meta.name;
      }
    }

    // 2. 别名匹配 (大小写不敏感)
    const lower = trimmed.toLowerCase();
    const aliasResult = this.aliasMap.get(trimmed) || this.aliasMap.get(lower);
    if (aliasResult) return aliasResult;

    // 3. 模糊匹配 (包含关系)
    for (const [, meta] of this.characterRegistry) {
      if (meta.name.includes(trimmed) || trimmed.includes(meta.name)) {
        return meta.name;
      }
    }

    return null;
  }

  /** 获取角色完整数据 (带缓存) */
  async getCharacterData(name: string): Promise<MiaoCharacterData | null> {
    if (this.characterDataCache.has(name)) {
      return this.characterDataCache.get(name)!;
    }

    const charDir = path.join(MIAO_DATA_DIR, 'character', name);
    const dataPath = path.join(charDir, 'data.json');

    if (!fs.existsSync(dataPath)) {
      console.warn(`[MiaoGuide] 角色数据不存在: ${name}/data.json`);
      return null;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      // 云崽格式可能是 { data: {...} } 或直接 {...}
      const data: MiaoCharacterData = raw.data || raw;
      this.characterDataCache.set(name, data);
      return data;
    } catch (err: any) {
      console.error(`[MiaoGuide] 解析 ${name}/data.json 失败:`, err.message);
      return null;
    }
  }

  /** 获取角色的圣遗物评分权重 */
  getArtifactWeights(charName: string): ArtifactWeight | null {
    return this.artifactWeights.get(charName) || null;
  }

  /** 动态导入角色的 calc.js */
  async getCalcData(charName: string): Promise<MiaoCalcExport | null> {
    const calcPath = path.join(MIAO_DATA_DIR, 'character', charName, 'calc.js');
    if (!fs.existsSync(calcPath)) return null;

    try {
      // 动态 import 支持 ESM 格式
      const mod = await import(calcPath);
      return {
        details: mod.details || [],
        defDmgIdx: mod.defDmgIdx,
        mainAttr: mod.mainAttr,
        buffs: mod.buffs || [],
      };
    } catch (err: any) {
      console.error(`[MiaoGuide] 加载 ${charName}/calc.js 失败:`, err.message);
      return null;
    }
  }

  /** 获取所有角色名列表 */
  getAllCharacterNames(): string[] {
    return Array.from(this.characterRegistry.values()).map(m => m.name);
  }

  /** 检查数据是否已加载 */
  isReady(): boolean {
    return this.loaded;
  }

  /**
   * 通过 genshin-db 获取角色图标 URL
   * @returns { icon, card, portrait } 或 null
   */
  getCharacterImages(charName: string): { icon?: string; card?: string; portrait?: string } | null {
    try {
      // genshin-db 可选依赖
      const genshindb = require('genshin-db');
      // 尝试中文名, 失败则尝试英文名
      let data = genshindb.characters(charName, { lang: 'Chinese' });
      if (!data) {
        // 通过别名找英文名再查
        const meta = Array.from(this.characterRegistry.values()).find(m => m.name === charName);
        if (meta) {
          const aliases = Array.from(this.aliasMap.entries()).find(([, v]) => v === charName);
          if (aliases) data = genshindb.characters(aliases[0], { matchAliases: true, lang: 'Chinese' });
        }
      }
      if (!data?.images) return null;
      return {
        icon: data.images.mihoyo_icon || undefined,
        card: data.images.card || undefined,
        portrait: data.images.portrait || undefined,
      };
    } catch {
      return null;
    }
  }

  // ==================== 私有加载方法 ====================

  /** 加载角色注册表 (顶层 data.json) */
  private async loadCharacterRegistry(): Promise<void> {
    const dataPath = path.join(MIAO_DATA_DIR, 'character', 'data.json');
    if (!fs.existsSync(dataPath)) {
      console.warn('[MiaoGuide] 角色注册表不存在，请先运行 init-miao-data');
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      for (const [id, data] of Object.entries(raw)) {
        this.characterRegistry.set(Number(id), data as MiaoCharacterMeta);
      }
    } catch (err: any) {
      console.error('[MiaoGuide] 加载角色注册表失败:', err.message);
    }
  }

  /** 加载全局圣遗物评分权重 (artis-mark.js) */
  private async loadArtifactWeights(): Promise<void> {
    const weightPath = path.join(MIAO_DATA_DIR, 'artifact', 'artis-mark.js');
    if (!fs.existsSync(weightPath)) {
      console.warn('[MiaoGuide] artis-mark.js 不存在');
      return;
    }

    try {
      // artis-mark.js 是 ESM 格式, 用正则解析文本更可靠 (避免 CommonJS/ESM 兼容问题)
      const content = fs.readFileSync(weightPath, 'utf8');

      // 匹配格式: 角色名: { cpct: 100, cdmg: 100, ... }
      const regex = /(\S+):\s*\{([^}]+)\}/g;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        const charName = match[1];
        const obj: Record<string, number> = {};
        // 解析内部键值对: cpct: 100
        match[2].replace(/(\w+):\s*(\d+)/g, (_: string, key: string, val: string) => {
          obj[key] = Number(val);
          return _;
        });
        if (Object.keys(obj).length > 0) {
          this.artifactWeights.set(charName, obj as unknown as ArtifactWeight);
        }
      }

      console.log(`[MiaoGuide] 评分权重加载完成: ${this.artifactWeights.size} 个角色`);
    } catch (err: any) {
      console.error('[MiaoGuide] 加载 artis-mark.js 失败:', err.message);
    }
  }

  /** 加载别名映射 (alias.js) */
  private async loadAliases(): Promise<void> {
    const aliasPath = path.join(MIAO_DATA_DIR, 'character', 'alias.js');
    if (!fs.existsSync(aliasPath)) return;

    try {
      // alias.js 是 ESM 格式, 用正则直接解析文本更可靠 (避免 CommonJS/ESM 兼容问题)
      const content = fs.readFileSync(aliasPath, 'utf8');

      // 匹配格式: 官方名: '别名1,别名2,...'  或  官方名: "别名1,别名2,..."
      const regex = /^\s*(.+?):\s*['"](.+?)['"]/gm;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        const officialName = match[1].trim();
        const aliases = match[2].split(',').map(s => s.trim()).filter(Boolean);

        for (const alias of aliases) {
          // 每个别名 → 官方中文名
          this.aliasMap.set(alias, officialName);
          this.aliasMap.set(alias.toLowerCase(), officialName);
        }
        // 官方名自身也注册 (确保精确匹配)
        this.aliasMap.set(officialName, officialName);
      }

      console.log(`[MiaoGuide] 别名加载完成: ${this.aliasMap.size} 条映射`);
    } catch (err: any) {
      console.error('[MiaoGuide] 加载 alias.js 失败:', err.message);
    }
  }
}
