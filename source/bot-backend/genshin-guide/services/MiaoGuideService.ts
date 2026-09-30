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
import { GenshinDataProvider } from './GenshinDataProvider';
import {
  MiaoCharacterMeta,
  MiaoCharacterData,
  ArtifactWeight,
  MiaoCalcExport,
} from '../types';

/** 元数据根目录：优先随包资源，其次按需下载缓存（见 GenshinDataProvider） */
function miaoDataDir(): string {
  return GenshinDataProvider.miaoRoot();
}

/**
 * 读取并解析 JSON 文件。
 * 上游（含 Windows 下的各种工具）写出的 UTF-8 文件可能带 BOM，
 * `JSON.parse` 遇到 BOM 会直接抛错——这里统一剥掉，避免整个注册表加载失败。
 */
function readJsonFile(file: string): any {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

export class MiaoGuideService {
  // ---- 内部缓存 ----
  private characterRegistry: Map<number, MiaoCharacterMeta> = new Map();
  private characterDataCache: Map<string, MiaoCharacterData> = new Map();
  private artifactWeights: Map<string, ArtifactWeight> = new Map();
  private aliasMap: Map<string, string> = new Map(); // alias → officialName
  private loaded = false;

  // ==================== 初始化 ====================

  /**
   * 启动期初始化：**只读本地已有数据，不联网**。
   * 元数据改为按需下载后，启动不再产生任何网络请求；
   * 首次真正用到攻略指令时由 ensureReady() 拉取（约 70KB）。
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    await this.loadFromDisk();
  }

  /**
   * 按需就绪：确保元数据已下载并建立索引。
   * @returns 是否可用
   */
  async ensureReady(): Promise<boolean> {
    if (this.isReady()) return true;
    await GenshinDataProvider.ensureMiaoBase();
    this.loaded = false;
    await this.loadFromDisk();
    return this.isReady();
  }

  /** 数据是否已经就绪（用于给用户更准确的提示） */
  isReady(): boolean {
    return this.loaded && this.characterRegistry.size > 0;
  }

  /** 从磁盘加载全部元数据并建立索引 */
  private async loadFromDisk(): Promise<void> {
    if (!GenshinDataProvider.hasBase()) {
      // 尚未下载过：保持未就绪状态，等指令触发 ensureReady()
      return;
    }

    this.characterRegistry.clear();
    this.artifactWeights.clear();
    this.aliasMap.clear();

    await this.loadCharacterRegistry();
    await this.loadArtifactWeights();
    await this.loadAliases();

    this.loaded = true;
    if (this.characterRegistry.size === 0) {
      // 文件已下载但解析不出角色：属于数据格式问题，而不是网络问题，
      // 单独报出来避免被误判为「没联网」。
      console.error(
        '[MiaoGuide] 元数据文件已存在但角色注册表为空，请检查 character/data.json 的格式' +
        `（路径: ${path.join(miaoDataDir(), 'character', 'data.json')}）`
      );
    }
    console.log(
      `[MiaoGuide] 元数据就绪: ` +
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

  /** 获取角色完整数据 (按需下载 + 缓存) */
  async getCharacterData(name: string): Promise<MiaoCharacterData | null> {
    if (this.characterDataCache.has(name)) {
      return this.characterDataCache.get(name)!;
    }

    // 该角色数据可能还没下载过：先按需拉取（已缓存则立即返回）
    await GenshinDataProvider.ensureCharacter(name);

    const dataPath = path.join(miaoDataDir(), 'character', name, 'data.json');

    if (!fs.existsSync(dataPath)) {
      console.warn(`[MiaoGuide] 角色数据不存在: ${name}/data.json`);
      return null;
    }

    try {
      const raw = readJsonFile(dataPath);
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
    await GenshinDataProvider.ensureCharacter(charName);
    const calcPath = path.join(miaoDataDir(), 'character', charName, 'calc.js');
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

  // ==================== 私有加载方法 ====================

  /** 加载角色注册表 (顶层 data.json) */
  private async loadCharacterRegistry(): Promise<void> {
    const dataPath = path.join(miaoDataDir(), 'character', 'data.json');
    if (!fs.existsSync(dataPath)) {
      console.warn('[MiaoGuide] 角色注册表不存在，按需下载未成功');
      return;
    }

    try {
      const raw = readJsonFile(dataPath);
      for (const [id, data] of Object.entries(raw)) {
        this.characterRegistry.set(Number(id), data as MiaoCharacterMeta);
      }
    } catch (err: any) {
      console.error('[MiaoGuide] 加载角色注册表失败:', err.message);
    }
  }

  /** 加载全局圣遗物评分权重 (artis-mark.js) */
  private async loadArtifactWeights(): Promise<void> {
    const weightPath = path.join(miaoDataDir(), 'artifact', 'artis-mark.js');
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
    const aliasPath = path.join(miaoDataDir(), 'character', 'alias.js');
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
